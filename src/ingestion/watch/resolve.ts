import { takesQuote } from '@/db/listing-outcome'
import { NO_REMOVED_REFS, withoutRemoved, type RemovedRefs } from '@/db/removed-refs'
import type { ListingPage, ListingUpsert, NewListing } from '@/db/watch-listings'
import type { ProductToResolve, WatchProductPatch } from '@/db/watch-products'
import { compareQuery } from '@/lib/price-compare/clean-title'
import { candidateConfidence, chooseMatch } from '@/lib/watch/choose-match'
import { sameGtin, validEan } from '@/lib/watch/ean'
import { URL_LIKE } from '@/lib/watch/input-rules'
import { parseProductLink } from '@/lib/watch/links'
import {
  ML_RETAILER, type ChosenMatch, type ListingCandidate, type ListingQuote, type ProductLink, type SourcePage, type WatchRetailer,
} from '@/lib/watch/types'
import { errorText } from '../errors'
import type { ChromePool } from './chrome-pool'
import { errorBackoffMs } from './retry-backoff'
import { WATCH_LOG_TAG, type GateResult, type Skipped } from './site-gate'
import type { Candidates, WatchSources } from './sources'

export const RESOLVE_STEPS = ['link', 'americanas', 'amazon', 'kabum', 'buscape'] as const
export type ResolveStep = (typeof RESOLVE_STEPS)[number]
type StoreStep = Exclude<ResolveStep, 'link'>
type StepOutcome = 'done' | 'pending' | 'failed'
export type ResolveOutcome = 'resolved' | 'pending' | 'failed'

export interface ProductProgress { done: Set<ResolveStep>; failures: number; retryAt: number | null }

export type ResolveProgress = Map<string, ProductProgress>

export interface ResolveDeps {
  sources: WatchSources
  chrome: Pick<ChromePool, 'during'>
  due: (now: Date) => Promise<ProductToResolve[]>
  upsert: (productId: string, listing: NewListing, now: Date) => Promise<ListingUpsert>
  recordQuote: (listingId: string, quote: ListingQuote, now: Date) => Promise<void>
  recordPageQuotes: (productId: string, page: ListingPage, quotes: readonly ListingQuote[], now: Date) => Promise<ListingUpsert[]>
  recordError: (listingId: string, error: string, now: Date) => Promise<void>
  recordPageError: (productId: string, retailer: WatchRetailer, ref: string, error: string, now: Date) => Promise<void>
  update: (id: string, patch: WatchProductPatch) => Promise<boolean>
  markResolved: (id: string, now: Date) => Promise<void>
  removedRefs: (productIds: string[]) => Promise<Map<string, RemovedRefs>>
  mlLinksGone: (productIds: string[]) => Promise<Set<string>>
  alerts: (productId: string, now: Date) => Promise<number>
  now: () => Date
  log: (line: string) => void
}

export interface ResolvePass { due: number; resolved: number }

export interface ResolveContext { removed: RemovedRefs; mlLinkGone: boolean }

const NO_CONTEXT: ResolveContext = { removed: NO_REMOVED_REFS, mlLinkGone: false }

interface Resolving { id: string; name: string; query: string; ean: string | null; removed: RemovedRefs }

interface StoreSearch {
  byEan?: (ean: string) => Promise<Candidates>
  byText: (query: string) => Promise<Candidates>
  learn?: (product: Resolving, candidates: ListingCandidate[]) => Promise<void>
  adopt?: (product: Resolving, choice: ChosenMatch) => Promise<StepOutcome>
}

const STORE_STEPS: readonly StoreStep[] = ['americanas', 'amazon', 'kabum', 'buscape']
const HIGH = 'high'
const BUSCAPE = 'buscape' satisfies WatchRetailer

type Stopped = Skipped | (Exclude<SourcePage<never>, { kind: 'ok' }> & { kind: 'wall' | 'unknown' })

function isStopped<Value>(result: GateResult<Value>): result is Stopped {
  return result.kind === 'skipped' || result.kind === 'wall' || result.kind === 'unknown'
}

function stopOutcome(result: Stopped): StepOutcome {
  return result.kind === 'skipped' ? 'pending' : 'failed'
}

function visible(result: Candidates, removed: RemovedRefs): Candidates {
  return result.kind === 'ok' ? { kind: 'ok', value: withoutRemoved(result.value, removed) } : result
}

export function searchText(product: Pick<Resolving, 'query'>): string | null {
  const query = product.query.trim()
  return query === '' || URL_LIKE.test(query) || parseProductLink(query) !== null ? null : query
}

export function sharedHighEan(name: string, candidates: readonly ListingCandidate[]): string | null {
  const high = candidates.filter((candidate) => candidateConfidence(name, candidate) === HIGH)
  const eans = high.map((candidate) => validEan(candidate.ean))
  const [first] = eans
  if (!first || eans.some((ean) => ean === null || !sameGtin(ean, first))) return null
  return first
}

export function namedPatch(title: string): { name: string; query: string } {
  return { name: title, query: compareQuery(title) || title }
}

async function named(product: Resolving, title: string, deps: ResolveDeps): Promise<void> {
  const patch = namedPatch(title)
  await deps.update(product.id, patch)
  Object.assign(product, patch)
}

async function adoptEan(product: Resolving, ean: string | null, source: 'link' | 'americanas', deps: ResolveDeps): Promise<void> {
  if (product.ean !== null || ean === null) return
  await deps.update(product.id, { ean, eanSource: source })
  product.ean = ean
}

function linkListing(link: ProductLink, title: string): NewListing {
  return { retailer: link.retailer, ref: link.ref, url: link.url, title, merchant: null, match: 'link' }
}

async function quotedLink(product: Resolving, link: ProductLink, result: GateResult<ListingQuote>, deps: ResolveDeps): Promise<StepOutcome> {
  if (result.kind === 'skipped') return 'pending'
  const quote = result.kind === 'ok' ? result.value : null
  const title = result.kind === 'ok' ? result.value.title : result.title ?? null
  if (!quote && !title && isStopped(result)) return 'failed'
  const now = deps.now()
  const listing = await deps.upsert(product.id, linkListing(link, title ?? link.url), now)
  if (takesQuote(listing)) {
    if (quote) {
      await deps.recordQuote(listing.id, quote, now)
      await deps.alerts(product.id, now)
    } else if (result.kind !== 'ok') {
      await deps.recordError(listing.id, result.reason, now)
    }
  }
  if (title) await named(product, title, deps)
  return 'done'
}

async function americanasLink(product: Resolving, link: ProductLink, deps: ResolveDeps): Promise<StepOutcome> {
  const result = await deps.sources.americanasLink(link.ref)
  if (result.kind === 'skipped') return 'pending'
  if (result.kind !== 'ok') {
    if (!result.title) return isStopped(result) ? stopOutcome(result) : 'done'
    await named(product, result.title, deps)
    return 'done'
  }
  const known = validEan(product.ean)
  const sku = result.value.find((candidate) => known !== null && candidate.ean !== null && sameGtin(candidate.ean, known)) ?? result.value[0]
  if (!sku) return 'done'
  await deps.upsert(product.id, { ...linkListing(link, sku.title), ref: sku.ref, url: sku.url }, deps.now())
  await adoptEan(product, validEan(sku.ean), 'link', deps)
  await named(product, sku.title, deps)
  return 'done'
}

async function quotedPage(productId: string, page: ListingPage, quotes: ListingQuote[], deps: ResolveDeps): Promise<void> {
  const now = deps.now()
  await deps.recordPageQuotes(productId, page, quotes, now)
  await deps.alerts(productId, now)
}

async function buscapeLink(product: Resolving, link: ProductLink, deps: ResolveDeps): Promise<StepOutcome> {
  const result = await deps.sources.buscapeQuotes(link.ref, null)
  if (isStopped(result)) return stopOutcome(result)
  if (result.kind !== 'ok') {
    if (result.title) await named(product, result.title, deps)
    return 'done'
  }
  const title = result.value.find((quote) => quote.title)?.title ?? link.url
  await quotedPage(product.id, { retailer: BUSCAPE, ref: link.ref, url: link.url, title, match: 'link' }, result.value, deps)
  await named(product, title, deps)
  return 'done'
}

async function mlLink(product: Resolving, link: ProductLink, deps: ResolveDeps): Promise<StepOutcome> {
  await deps.upsert(product.id, linkListing(link, link.url), deps.now())
  return 'done'
}

const LINK_STEPS: Record<WatchRetailer, (product: Resolving, link: ProductLink, deps: ResolveDeps) => Promise<StepOutcome>> = {
  ml: mlLink,
  amazon: async (product, link, deps) => quotedLink(product, link, await deps.sources.amazonQuote(link.ref), deps),
  kabum: async (product, link, deps) => quotedLink(product, link, await deps.sources.kabumQuote(link.ref), deps),
  americanas: americanasLink,
  buscape: buscapeLink,
}

async function adoptListing(product: Resolving, choice: ChosenMatch, deps: ResolveDeps): Promise<StepOutcome> {
  const { candidate, match } = choice
  await deps.upsert(product.id, { retailer: candidate.retailer, ref: candidate.ref, url: candidate.url, title: candidate.title, merchant: null, match }, deps.now())
  return 'done'
}

async function adoptBuscapePage(product: Resolving, { candidate, match }: ChosenMatch, deps: ResolveDeps): Promise<StepOutcome> {
  const result = await deps.sources.buscapeQuotes(candidate.ref, product.name)
  if (isStopped(result)) return stopOutcome(result)
  if (result.kind === 'missing') {
    await deps.recordPageError(product.id, BUSCAPE, candidate.ref, result.reason, deps.now())
    return 'done'
  }
  const quotes = result.kind === 'ok' ? result.value : []
  await quotedPage(product.id, { retailer: BUSCAPE, ref: candidate.ref, url: candidate.url, title: candidate.title, match }, quotes, deps)
  return 'done'
}

async function matched(
  product: Resolving, result: Candidates, searchedByEan: boolean, search: StoreSearch, deps: ResolveDeps,
): Promise<StepOutcome | null> {
  if (result.kind !== 'ok') return null
  const choice = chooseMatch({ name: product.name, ean: product.ean }, result.value, { searchedByEan })
  if (!choice) return null
  return search.adopt ? search.adopt(product, choice) : adoptListing(product, choice, deps)
}

async function searched(product: Resolving, search: StoreSearch, deps: ResolveDeps): Promise<StepOutcome> {
  const ean = validEan(product.ean)
  const text = searchText(product)
  if (ean !== null && search.byEan) {
    const byEan = await search.byEan(ean)
    if (isStopped(byEan)) return stopOutcome(byEan)
    const outcome = await matched(product, visible(byEan, product.removed), true, search, deps)
    if (outcome) return outcome
  }
  if (text === null) return 'done'
  const result = await search.byText(text)
  if (isStopped(result)) return stopOutcome(result)
  const byText = visible(result, product.removed)
  if (byText.kind === 'ok') await search.learn?.(product, byText.value)
  return (await matched(product, byText, false, search, deps)) ?? 'done'
}

function storeSearches(deps: ResolveDeps): Record<StoreStep, StoreSearch> {
  const { sources } = deps
  return {
    americanas: {
      byEan: sources.americanasByEan,
      byText: sources.americanasByText,
      learn: (product, candidates) => adoptEan(product, sharedHighEan(product.name, candidates), 'americanas', deps),
    },
    amazon: { byEan: sources.amazonSearch, byText: sources.amazonSearch },
    kabum: { byText: sources.kabumSearch },
    buscape: { byText: sources.buscapeSearch, adopt: (product, choice) => adoptBuscapePage(product, choice, deps) },
  }
}

export async function resolveProduct(
  product: ProductToResolve, done: Set<ResolveStep>, deps: ResolveDeps, context: ResolveContext = NO_CONTEXT,
): Promise<ResolveOutcome> {
  const working: Resolving = { id: product.id, name: product.name, query: product.query, ean: product.ean, removed: context.removed }
  const link = parseProductLink(working.query)
  if (link && !done.has('link')) {
    const outcome = await LINK_STEPS[link.retailer](working, link, deps)
    if (outcome !== 'done') return outcome
    done.add('link')
    if (link.retailer !== ML_RETAILER) done.add(link.retailer)
  }
  if (searchText(working) === null && link?.retailer === ML_RETAILER && !context.mlLinkGone) return 'pending'
  const searches = storeSearches(deps)
  let failed = false
  for (const step of STORE_STEPS) {
    if (done.has(step)) continue
    const outcome = await searched(working, searches[step], deps)
    if (outcome === 'done') done.add(step)
    failed ||= outcome === 'failed'
  }
  if (STORE_STEPS.every((step) => done.has(step))) return 'resolved'
  return failed ? 'failed' : 'pending'
}

function backOff(entry: ProductProgress, now: Date): void {
  entry.failures += 1
  entry.retryAt = now.getTime() + errorBackoffMs(entry.failures)
}

export async function resolvePass(deps: ResolveDeps, progress: ResolveProgress): Promise<ResolvePass> {
  const due = await deps.due(deps.now())
  const dueIds = new Set(due.map((product) => product.id))
  for (const id of progress.keys()) if (!dueIds.has(id)) progress.delete(id)
  const [removed, mlLinksGone] = await Promise.all([deps.removedRefs([...dueIds]), deps.mlLinksGone([...dueIds])])
  let resolved = 0
  await deps.chrome.during(async () => {
    for (const product of due) {
      const entry = progress.get(product.id) ?? { done: new Set<ResolveStep>(), failures: 0, retryAt: null }
      progress.set(product.id, entry)
      if (entry.retryAt !== null && entry.retryAt > deps.now().getTime()) continue
      try {
        const context = { removed: removed.get(product.id) ?? NO_REMOVED_REFS, mlLinkGone: mlLinksGone.has(product.id) }
        const outcome = await resolveProduct(product, entry.done, deps, context)
        if (outcome === 'failed') backOff(entry, deps.now())
        if (outcome === 'pending') entry.retryAt = null
        if (outcome !== 'resolved') continue
        await deps.markResolved(product.id, deps.now())
        progress.delete(product.id)
        resolved += 1
      } catch (e) {
        deps.log(`${WATCH_LOG_TAG} resolve ${product.id} failed: ${errorText(e)}`)
        backOff(entry, deps.now())
      }
    }
  })
  return { due: due.length, resolved }
}
