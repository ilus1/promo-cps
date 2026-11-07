import { ML_LINK_GONE, takesQuote } from '@/db/listing-outcome'
import { NO_REMOVED_REFS, withoutRemoved, type RemovedRefs } from '@/db/removed-refs'
import type { ListingUpsert, NewListing } from '@/db/watch-listings'
import type { ProductToResolve, WatchProductPatch } from '@/db/watch-products'
import { SEARCH_HOST, searchSlug } from '@/lib/ml-url'
import { chooseMatch } from '@/lib/watch/choose-match'
import { validEan } from '@/lib/watch/ean'
import { mlCandidate, mlQuote } from '@/lib/watch/ml-final'
import { ML_RETAILER, type ChosenMatch, type ListingQuote, type MatchKind } from '@/lib/watch/types'
import { errorText } from '../errors'
import type { ObservedCard } from '../ml/observed-card'
import type { LoadedPage } from '../ml/page-state'
import { SearchResultsMissing, type SearchPage } from '../ml/search-page'
import { namedPatch, searchText } from '../watch/resolve'
import { MAX_UNPARSED_PAGES_IN_ROW, type Loaded } from './breaker'

export interface MlListingRow {
  id: string
  productId: string
  ref: string
  url: string
  match: MatchKind
  lastError: string | null
  checkedAt: Date | null
}

declare global {
  var __promoMlEanMisses: Set<string> | undefined
  var __promoMlLinkFailures: Map<string, number> | undefined
}

export interface WatchMlIo {
  eanMisses: Set<string>
  linkFailures: Map<string, number>
  paused(): Promise<boolean>
  products(): Promise<ProductToResolve[]>
  mlListings(productIds: string[]): Promise<MlListingRow[]>
  removedRefs(productIds: string[]): Promise<Map<string, RemovedRefs>>
  load(url: string): Promise<Loaded<LoadedPage>>
  loadLink(url: string): Promise<Loaded<LoadedPage>>
  readSearch(pageProps: LoadedPage['pageProps'], searchUrl: string): SearchPage
  readProduct(pageProps: LoadedPage['pageProps'], url: string): ObservedCard
  upsert(productId: string, listing: NewListing, now: Date): Promise<ListingUpsert>
  recordQuote(listingId: string, quote: ListingQuote, now: Date): Promise<void>
  recordError(listingId: string, error: string, now: Date): Promise<void>
  recordGone(listingId: string, error: string, now: Date): Promise<void>
  update(id: string, patch: WatchProductPatch): Promise<boolean>
  alerts(productId: string, now: Date): Promise<number>
  now(): Date
}

export interface WatchMlResult {
  products: number
  matched: number
  failed: number
  pages: number
  empty: number
  cards: number
  dropped: number
  skipped: number
  lastError: string | null
}

export const ML_LISTING_GONE = 'O anúncio não apareceu na busca do Mercado Livre'
export const LINK_GONE_CYCLES = 3
export const LINK_FAILURES_IN_ROW_MAX = 3
export const SEARCH_UNPARSED = 'Produtos da busca não reconhecidos'

type Read<T> = { ok: true; value: T } | { ok: false; error: string; reader: boolean }

interface SearchRead { cards: ObservedCard[]; found: number; dropped: number; missing: boolean }

interface FailedLink { productId: string; listingId: string }

interface Tally extends WatchMlResult { readerFailuresInRow: number; linkFailuresInRow: number; linkRead: boolean; failedLinks: FailedLink[] }

const LINK: MatchKind = 'link'
const BARCODE: MatchKind = 'barcode'
const NO_RESULTS: SearchRead = { cards: [], found: 0, dropped: 0, missing: true }

export function mlEanMisses(): Set<string> {
  globalThis.__promoMlEanMisses ??= new Set()
  return globalThis.__promoMlEanMisses
}

export function mlLinkFailures(): Map<string, number> {
  globalThis.__promoMlLinkFailures ??= new Map()
  return globalThis.__promoMlLinkFailures
}

export function mlSearchUrl(text: string): string | null {
  const slug = searchSlug(text)
  return slug ? `https://${SEARCH_HOST}/${slug}` : null
}

type PageLoad = (url: string) => Promise<Loaded<LoadedPage>>

async function readPage<T>(load: PageLoad, url: string, read: (pageProps: LoadedPage['pageProps']) => T): Promise<Read<T>> {
  const loaded = await load(url)
  if (!loaded.ok) return { ok: false, error: loaded.error, reader: false }
  try {
    return { ok: true, value: read(loaded.value.pageProps) }
  } catch (e) {
    return { ok: false, error: errorText(e), reader: true }
  }
}

function searchCards(io: WatchMlIo, url: string): Promise<Read<SearchRead>> {
  return readPage(io.load, url, (pageProps) => {
    let page: SearchPage
    try {
      page = io.readSearch(pageProps, url)
    } catch (e) {
      if (e instanceof SearchResultsMissing) return NO_RESULTS
      throw e
    }
    if (page.found > 0 && page.cards.length === 0) throw new Error(SEARCH_UNPARSED)
    return { cards: page.cards, found: page.found, dropped: page.dropped, missing: false }
  })
}

async function settleFailedLinks(io: WatchMlIo, tally: Tally): Promise<void> {
  if (!tally.linkRead) return
  for (const { productId, listingId } of tally.failedLinks) {
    const failures = (io.linkFailures.get(productId) ?? 0) + 1
    if (failures < LINK_GONE_CYCLES) {
      io.linkFailures.set(productId, failures)
      continue
    }
    io.linkFailures.delete(productId)
    await io.recordGone(listingId, ML_LINK_GONE, io.now())
  }
}

function failed(tally: Tally, read: Extract<Read<unknown>, { ok: false }>): void {
  tally.failed += 1
  tally.lastError = read.error
  tally.readerFailuresInRow = read.reader ? tally.readerFailuresInRow + 1 : 0
}

async function quoted(io: WatchMlIo, productId: string, listingId: string, card: ObservedCard, tally: Tally): Promise<void> {
  const now = io.now()
  await io.recordQuote(listingId, mlQuote(card), now)
  await io.alerts(productId, now)
  tally.matched += 1
}

async function readLinked(io: WatchMlIo, product: ProductToResolve, listing: MlListingRow, tally: Tally): Promise<void> {
  if (listing.lastError === ML_LINK_GONE || tally.linkFailuresInRow >= LINK_FAILURES_IN_ROW_MAX) {
    tally.skipped += 1
    return
  }
  tally.pages += 1
  const read = await readPage(io.loadLink, listing.url, (pageProps) => io.readProduct(pageProps, listing.url))
  if (!read.ok) {
    tally.failed += 1
    tally.lastError = read.error
    tally.linkFailuresInRow += 1
    tally.failedLinks.push({ productId: product.id, listingId: listing.id })
    await io.recordError(listing.id, read.error, io.now())
    return
  }
  tally.linkRead = true
  tally.linkFailuresInRow = 0
  io.linkFailures.delete(product.id)
  if (searchText(product) === null) await io.update(product.id, namedPatch(read.value.title))
  await quoted(io, product.id, listing.id, read.value, tally)
}

async function adopt(io: WatchMlIo, product: ProductToResolve, choice: ChosenMatch, card: ObservedCard, tally: Tally): Promise<boolean> {
  const { candidate, match } = choice
  const listing = await io.upsert(product.id, { retailer: ML_RETAILER, ref: candidate.ref, url: candidate.url, title: candidate.title, merchant: null, match }, io.now())
  if (!takesQuote(listing)) return false
  await quoted(io, product.id, listing.id, card, tally)
  return true
}

function searchByEan(io: WatchMlIo, product: ProductToResolve, listing: MlListingRow | undefined, ean: string | null): boolean {
  if (ean === null) return false
  if (searchText(product) === null) return true
  return listing ? listing.match === BARCODE : !io.eanMisses.has(product.id)
}

function counted(tally: Tally, read: SearchRead): void {
  tally.cards += read.found
  tally.dropped += read.dropped
  if (read.missing) tally.empty += 1
}

async function searchProduct(
  io: WatchMlIo, product: ProductToResolve, listing: MlListingRow | undefined, removed: RemovedRefs, tally: Tally,
): Promise<void> {
  const ean = validEan(product.ean)
  const byEan = searchByEan(io, product, listing, ean)
  const term = byEan && ean !== null ? ean : searchText(product)
  const url = term === null ? null : mlSearchUrl(term)
  if (!url) {
    tally.skipped += 1
    return
  }
  tally.pages += 1
  const read = await searchCards(io, url)
  if (!read.ok) {
    failed(tally, read)
    return
  }
  tally.readerFailuresInRow = 0
  tally.linkFailuresInRow = 0
  counted(tally, read.value)
  const { cards } = read.value
  const known = listing && cards.find((card) => card.id === listing.ref)
  if (listing && known) {
    await quoted(io, product.id, listing.id, known, tally)
    return
  }
  const candidates = withoutRemoved(cards.map(mlCandidate), removed)
  const choice = chooseMatch({ name: product.name, ean: product.ean }, candidates, { searchedByEan: byEan })
  const card = choice && cards.find((candidate) => candidate.id === choice.candidate.ref)
  const adopted = choice && card ? await adopt(io, product, choice, card, tally) : false
  if (byEan && !listing) {
    if (adopted) io.eanMisses.delete(product.id)
    else io.eanMisses.add(product.id)
  }
  if (!adopted && listing) await io.recordError(listing.id, ML_LISTING_GONE, io.now())
}

function checkedTime(listing: MlListingRow | undefined): number {
  return listing?.checkedAt?.getTime() ?? Number.NEGATIVE_INFINITY
}

export function oldestCheckFirst(products: readonly ProductToResolve[], listings: readonly MlListingRow[]): ProductToResolve[] {
  const byProduct = new Map(listings.map((listing) => [listing.productId, listing]))
  return [...products].sort((left, right) => {
    const a = checkedTime(byProduct.get(left.id))
    const b = checkedTime(byProduct.get(right.id))
    return a === b ? 0 : a < b ? -1 : 1
  })
}

export async function watchMlProducts(io: WatchMlIo): Promise<WatchMlResult> {
  const products = await io.products()
  const tally: Tally = {
    products: products.length, matched: 0, failed: 0, pages: 0, empty: 0, cards: 0, dropped: 0, skipped: 0, lastError: null,
    readerFailuresInRow: 0, linkFailuresInRow: 0, linkRead: false, failedLinks: [],
  }
  const ids = products.map((product) => product.id)
  const [listings, removed] = await Promise.all([io.mlListings(ids), io.removedRefs(ids)])
  for (const product of oldestCheckFirst(products, listings)) {
    if (tally.readerFailuresInRow >= MAX_UNPARSED_PAGES_IN_ROW || await io.paused()) break
    const listing = listings.find((row) => row.productId === product.id)
    if (listing?.match === LINK) await readLinked(io, product, listing, tally)
    else await searchProduct(io, product, listing, removed.get(product.id) ?? NO_REMOVED_REFS, tally)
  }
  await settleFailedLinks(io, tally)
  const { products: watched, matched, failed: failures, pages, empty, cards, dropped, skipped, lastError } = tally
  return { products: watched, matched, failed: failures, pages, empty, cards, dropped, skipped, lastError }
}
