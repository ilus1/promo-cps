import type { DueListing, DuePage, ListingPage, ListingUpsert } from '@/db/watch-listings'
import { WATCH_REFRESH_BATCH } from '@/lib/constants'
import type { ListingQuote, ML_RETAILER, WatchRetailer } from '@/lib/watch/types'
import type { ChromePool } from './chrome-pool'
import { isSkipped } from './site-gate'
import type { Quote, WatchSources } from './sources'

type QuotedRetailer = Extract<WatchRetailer, 'americanas' | 'kabum' | 'amazon'>

export interface RefreshDeps {
  sources: WatchSources
  chrome: Pick<ChromePool, 'during'>
  dueListings: (retailer: WatchRetailer, now: Date, limit: number) => Promise<DueListing[]>
  duePages: (retailer: WatchRetailer, now: Date, limit: number) => Promise<DuePage[]>
  recordQuote: (listingId: string, quote: ListingQuote, now: Date) => Promise<void>
  recordPageQuotes: (productId: string, page: ListingPage, quotes: readonly ListingQuote[], now: Date) => Promise<ListingUpsert[]>
  recordError: (listingId: string, error: string, now: Date) => Promise<void>
  recordPageError: (productId: string, retailer: WatchRetailer, ref: string, error: string, now: Date) => Promise<void>
  productNames: (productIds: string[]) => Promise<Map<string, string>>
  alerts: (productId: string, now: Date) => Promise<number>
  now: () => Date
}

export interface SiteRefresh { checked: number; failed: number }

export type RefreshPass = Record<Exclude<WatchRetailer, typeof ML_RETAILER>, SiteRefresh>

const QUOTE: Record<QuotedRetailer, (sources: WatchSources, ref: string) => Promise<Quote>> = {
  americanas: (sources, ref) => sources.americanasQuote(ref),
  kabum: (sources, ref) => sources.kabumQuote(ref),
  amazon: (sources, ref) => sources.amazonQuote(ref),
}

async function refreshListings(retailer: QuotedRetailer, deps: RefreshDeps): Promise<SiteRefresh> {
  const tally: SiteRefresh = { checked: 0, failed: 0 }
  for (const listing of await deps.dueListings(retailer, deps.now(), WATCH_REFRESH_BATCH)) {
    const result = await QUOTE[retailer](deps.sources, listing.ref)
    if (isSkipped(result)) break
    const now = deps.now()
    tally.checked += 1
    if (result.kind !== 'ok') {
      tally.failed += 1
      await deps.recordError(listing.id, result.reason, now)
      continue
    }
    await deps.recordQuote(listing.id, result.value, now)
    await deps.alerts(listing.productId, now)
  }
  return tally
}

async function refreshBuscape(deps: RefreshDeps): Promise<SiteRefresh> {
  const tally: SiteRefresh = { checked: 0, failed: 0 }
  const pages = await deps.duePages('buscape', deps.now(), WATCH_REFRESH_BATCH)
  const names = await deps.productNames([...new Set(pages.map((page) => page.productId))])
  for (const page of pages) {
    const result = await deps.sources.buscapeQuotes(page.ref, names.get(page.productId) ?? null)
    if (isSkipped(result)) break
    const now = deps.now()
    tally.checked += 1
    if (result.kind !== 'ok' && result.kind !== 'empty') {
      tally.failed += 1
      await deps.recordPageError(page.productId, page.retailer, page.ref, result.reason, now)
      continue
    }
    await deps.recordPageQuotes(page.productId, page, result.kind === 'ok' ? result.value : [], now)
    await deps.alerts(page.productId, now)
  }
  return tally
}

function settled(results: PromiseSettledResult<SiteRefresh>[]): SiteRefresh[] {
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
  return results.map((result) => (result as PromiseFulfilledResult<SiteRefresh>).value)
}

export async function refreshPass(deps: RefreshDeps): Promise<RefreshPass> {
  const [americanas, kabum, buscape, amazon] = settled(await Promise.allSettled([
    refreshListings('americanas', deps),
    refreshListings('kabum', deps),
    refreshBuscape(deps),
    deps.chrome.during(() => refreshListings('amazon', deps)),
  ]))
  return { americanas, kabum, buscape, amazon }
}
