import { listingLandingKept } from '@/lib/ml-url'
import { errorText } from '../errors'
import { ListingResultsMissing, type ListingCards } from '../ml/cards'
import type { ObservedCard } from '../ml/observed-card'
import type { LoadedPage } from '../ml/page-state'
import {
  failureTally, MAX_LISTING_FAILURES_IN_ROW, MAX_UNPARSED_PAGES_IN_ROW, type Loaded,
} from './breaker'

export const LISTING_WITHOUT_CARDS = 'Listagem sem produtos reconhecidos'
export const LISTING_UNPARSED = 'Produtos da listagem não reconhecidos'
export const LISTING_REDIRECTED = 'Listagem redirecionada para fora do cupom'

export interface ListingTarget {
  campaignId: string
  listingUrl: string
}

export interface DiscoverIo<T extends ListingTarget> {
  load(url: string): Promise<Loaded<LoadedPage>>
  parse(pageProps: LoadedPage['pageProps']): ListingCards
  record(cards: ObservedCard[], coupons: T[]): Promise<string[]>
  linkCount(cards: ObservedCard[], coupons: T[]): number
  markAttempt(campaignIds: string[], succeeded: boolean): Promise<void>
}

export interface DiscoverResult {
  pages: number
  read: number
  items: number
  failed: number
  empty: number
  couponLinks: number
  cards: number
  basisOther: number
  droppedCards: number
  itemIds: string[]
  lastError: string | null
}

type Reading =
  | { ok: true; cards: ObservedCard[]; dropped: number }
  | { ok: false; error: string; kind: 'reader' | 'listing' | 'empty'; dropped: number }

export function groupByListing<T extends ListingTarget>(targets: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const target of targets) {
    const group = groups.get(target.listingUrl)
    if (group) group.push(target)
    else groups.set(target.listingUrl, [target])
  }
  return groups
}

function readPage<T extends ListingTarget>(io: DiscoverIo<T>, url: string, page: LoadedPage): Reading {
  if (!listingLandingKept(url, page.finalUrl)) return { ok: false, kind: 'listing', dropped: 0, error: `${LISTING_REDIRECTED}: ${url}` }
  let read: ListingCards
  try {
    read = io.parse(page.pageProps)
  } catch (e) {
    if (e instanceof ListingResultsMissing) return { ok: false, kind: 'empty', dropped: 0, error: errorText(e) }
    return { ok: false, kind: 'reader', dropped: 0, error: errorText(e) }
  }
  if (read.found === 0) return { ok: false, kind: 'listing', dropped: 0, error: `${LISTING_WITHOUT_CARDS}: ${url}` }
  if (read.cards.length === 0) return { ok: false, kind: 'reader', dropped: read.dropped, error: `${LISTING_UNPARSED}: ${url}` }
  return { ok: true, cards: read.cards, dropped: read.dropped }
}

async function recordAttempt<T extends ListingTarget>(
  io: DiscoverIo<T>, reading: Reading & { ok: true }, coupons: T[],
): Promise<string[]> {
  const ids = coupons.map((c) => c.campaignId)
  let itemIds: string[]
  try {
    itemIds = await io.record(reading.cards, coupons)
  } catch (e) {
    await io.markAttempt(ids, false)
    throw e
  }
  await io.markAttempt(ids, true)
  return itemIds
}

export async function discoverListings<T extends ListingTarget>(
  io: DiscoverIo<T>, targets: readonly T[], budgetPages: number,
): Promise<DiscoverResult> {
  const itemIds = new Set<string>()
  const tally = failureTally()
  let pages = 0
  let read = 0
  let empty = 0
  let couponLinks = 0
  let cards = 0
  let basisOther = 0
  let droppedCards = 0
  let readerFailuresInRow = 0
  let listingFailuresInRow = 0
  for (const [url, coupons] of groupByListing(targets)) {
    if (pages >= budgetPages) break
    pages += 1
    const loaded = await io.load(url)
    if (!loaded.ok) {
      tally.fail(loaded.error)
      await io.markAttempt(coupons.map((c) => c.campaignId), false)
      continue
    }
    const reading = readPage(io, url, loaded.value)
    if (reading.ok) {
      readerFailuresInRow = 0
      listingFailuresInRow = 0
      droppedCards += reading.dropped
      for (const id of await recordAttempt(io, reading, coupons)) itemIds.add(id)
      read += 1
      couponLinks += io.linkCount(reading.cards, coupons)
      cards += reading.cards.length
      basisOther += reading.cards.filter((card) => card.basis === 'other').length
      continue
    }
    droppedCards += reading.dropped
    if (reading.kind === 'empty') empty += 1
    else tally.fail(reading.error)
    await io.markAttempt(coupons.map((c) => c.campaignId), false)
    if (reading.kind !== 'listing') readerFailuresInRow += 1
    else listingFailuresInRow += 1
    if (readerFailuresInRow >= MAX_UNPARSED_PAGES_IN_ROW || listingFailuresInRow >= MAX_LISTING_FAILURES_IN_ROW) break
  }
  return {
    pages, read, items: itemIds.size, failed: tally.failed, empty, couponLinks, cards, basisOther, droppedCards,
    itemIds: [...itemIds], lastError: tally.lastError,
  }
}
