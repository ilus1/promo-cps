import { beforeEach, expect, test, vi } from 'vitest'
import type { DueListing, DuePage, ListingUpsert } from '@/db/watch-listings'
import { WATCH_REFRESH_BATCH } from '@/lib/constants'
import type { ListingQuote, WatchRetailer } from '@/lib/watch/types'
import { refreshPass, type RefreshDeps } from './refresh'
import type { GateResult } from './site-gate'
import type { Quote, WatchSources } from './sources'

const NOW = new Date('2026-11-06T12:00:00Z')
const PRODUCT = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const EMPTY: GateResult<never> = { kind: 'empty', reason: 'nenhum resultado' }

type Fn<T> = T extends (...args: infer A) => infer R ? ReturnType<typeof vi.fn<(...args: A) => R>> : never

function listing(retailer: WatchRetailer, ref: string): DueListing {
  return { id: `${retailer}-${ref}`, productId: PRODUCT, retailer, ref, merchant: null, url: `https://${retailer}.example/${ref}`, title: 't' }
}

function quote(ref: string, patch: Partial<ListingQuote> = {}): ListingQuote {
  return { ref, merchant: null, title: 't', priceCents: 10_000, listPriceCents: null, finalCents: 10_000, inStock: true, ...patch }
}

const PAGE: DuePage = { productId: PRODUCT, retailer: 'buscape', ref: 'fone/jbl', url: 'https://www.buscape.com.br/fone/jbl', title: 't', match: 'auto' }

let quotes: Record<'americanasQuote' | 'kabumQuote' | 'amazonQuote', Fn<(ref: string) => Promise<Quote>>>
let buscapeQuotes: Fn<(ref: string) => Promise<GateResult<ListingQuote[]>>>
let due: Record<string, DueListing[]>
let pages: DuePage[]
let recordQuote: Fn<RefreshDeps['recordQuote']>
let recordPageQuotes: Fn<RefreshDeps['recordPageQuotes']>
let recordError: Fn<RefreshDeps['recordError']>
let recordPageError: Fn<RefreshDeps['recordPageError']>
let productNames: Fn<RefreshDeps['productNames']>
let alerts: Fn<RefreshDeps['alerts']>
let dueListings: Fn<RefreshDeps['dueListings']>
let during: Fn<(work: () => Promise<unknown>) => Promise<unknown>>
let deps: RefreshDeps

beforeEach(() => {
  quotes = {
    americanasQuote: vi.fn(async (ref: string): Promise<Quote> => ({ kind: 'ok', value: quote(ref) })),
    kabumQuote: vi.fn(async (ref: string): Promise<Quote> => ({ kind: 'ok', value: quote(ref) })),
    amazonQuote: vi.fn(async (ref: string): Promise<Quote> => ({ kind: 'ok', value: quote(ref) })),
  }
  buscapeQuotes = vi.fn(async (): Promise<GateResult<ListingQuote[]>> => EMPTY)
  due = {}
  pages = []
  recordQuote = vi.fn(async () => undefined)
  recordPageQuotes = vi.fn(async (): Promise<ListingUpsert[]> => [])
  recordError = vi.fn(async () => undefined)
  recordPageError = vi.fn(async () => undefined)
  productNames = vi.fn(async () => new Map([[PRODUCT, 'Fone JBL Tune 520BT']]))
  alerts = vi.fn(async () => 0)
  dueListings = vi.fn(async (retailer: WatchRetailer) => due[retailer] ?? [])
  during = vi.fn((work: () => Promise<unknown>) => work())
  const sources = { ...quotes, buscapeQuotes } as unknown as WatchSources
  deps = {
    sources,
    chrome: { during: during as RefreshDeps['chrome']['during'] },
    dueListings,
    duePages: vi.fn(async () => pages),
    recordQuote,
    recordPageQuotes,
    recordError,
    recordPageError,
    productNames,
    alerts,
    now: () => NOW,
  }
})

test('each due listing is quoted from its own page, recorded, then its product is checked for alerts', async () => {
  due = { americanas: [listing('americanas', '1:2')], kabum: [listing('kabum', '925350')], amazon: [listing('amazon', 'B0C1234567')] }
  const pass = await refreshPass(deps)
  expect(quotes.americanasQuote).toHaveBeenCalledWith('1:2')
  expect(quotes.kabumQuote).toHaveBeenCalledWith('925350')
  expect(quotes.amazonQuote).toHaveBeenCalledWith('B0C1234567')
  expect(recordQuote).toHaveBeenCalledWith('kabum-925350', quote('925350'), NOW)
  expect(alerts).toHaveBeenCalledTimes(3)
  expect(alerts).toHaveBeenCalledWith(PRODUCT, NOW)
  expect(pass).toEqual({
    americanas: { checked: 1, failed: 0 }, kabum: { checked: 1, failed: 0 }, amazon: { checked: 1, failed: 0 }, buscape: { checked: 0, failed: 0 },
  })
})

test('the batch size limits each site, and only Amazon runs inside the Chrome scope', async () => {
  await refreshPass(deps)
  expect(dueListings).toHaveBeenCalledWith('kabum', NOW, WATCH_REFRESH_BATCH)
  expect(during).toHaveBeenCalledTimes(1)
})

test('a failed page records the error on the listing and moves on', async () => {
  due = { kabum: [listing('kabum', '1'), listing('kabum', '2')] }
  quotes.kabumQuote.mockResolvedValueOnce({ kind: 'missing', reason: 'HTTP 404' })
  const pass = await refreshPass(deps)
  expect(recordError).toHaveBeenCalledWith('kabum-1', 'HTTP 404', NOW)
  expect(recordQuote).toHaveBeenCalledWith('kabum-2', quote('2'), NOW)
  expect(pass.kabum).toEqual({ checked: 2, failed: 1 })
})

test('a skipped request (held, blocked or ML busy) stops the site without touching the listing', async () => {
  due = { amazon: [listing('amazon', 'A'), listing('amazon', 'B')] }
  quotes.amazonQuote.mockResolvedValue({ kind: 'skipped', reason: 'ml_busy' })
  const pass = await refreshPass(deps)
  expect(quotes.amazonQuote).toHaveBeenCalledTimes(1)
  expect(recordError).not.toHaveBeenCalled()
  expect(recordQuote).not.toHaveBeenCalled()
  expect(pass.amazon).toEqual({ checked: 0, failed: 0 })
})

test('a Buscapé page records its merchants, then the product is checked for alerts', async () => {
  pages = [PAGE]
  const merchants = [quote(PAGE.ref, { merchant: 'KaBuM!' })]
  buscapeQuotes.mockResolvedValue({ kind: 'ok', value: merchants })
  const pass = await refreshPass(deps)
  expect(productNames).toHaveBeenCalledWith([PRODUCT])
  expect(buscapeQuotes).toHaveBeenCalledWith(PAGE.ref, 'Fone JBL Tune 520BT')
  expect(recordPageQuotes).toHaveBeenCalledWith(PRODUCT, PAGE, merchants, NOW)
  expect(alerts).toHaveBeenCalledWith(PRODUCT, NOW)
  expect(pass.buscape).toEqual({ checked: 1, failed: 0 })
})

test('a failed Buscapé page records the error on every merchant of that page', async () => {
  pages = [PAGE]
  buscapeQuotes.mockResolvedValue({ kind: 'unknown', reason: 'sem __NEXT_DATA__' })
  const pass = await refreshPass(deps)
  expect(recordPageError).toHaveBeenCalledWith(PRODUCT, 'buscape', PAGE.ref, 'sem __NEXT_DATA__', NOW)
  expect(recordPageQuotes).not.toHaveBeenCalled()
  expect(alerts).not.toHaveBeenCalled()
  expect(pass.buscape).toEqual({ checked: 1, failed: 1 })
})

test('a Buscapé page left without offers of the product marks its merchants gone, not failed', async () => {
  pages = [PAGE]
  buscapeQuotes.mockResolvedValue({ kind: 'empty', reason: 'só ofertas de lojas lidas direto' })
  const pass = await refreshPass(deps)
  expect(recordPageQuotes).toHaveBeenCalledWith(PRODUCT, PAGE, [], NOW)
  expect(recordPageError).not.toHaveBeenCalled()
  expect(pass.buscape).toEqual({ checked: 1, failed: 0 })
})

test('a failing site does not cut the others short, and its error is raised after they finish', async () => {
  due = { kabum: [listing('kabum', '1')], americanas: [listing('americanas', '1:1')] }
  recordQuote.mockImplementation(async (listingId: string) => {
    if (listingId === 'kabum-1') throw new Error('db down')
  })
  await expect(refreshPass(deps)).rejects.toThrow('db down')
  expect(recordQuote).toHaveBeenCalledWith('americanas-1:1', quote('1:1'), NOW)
})
