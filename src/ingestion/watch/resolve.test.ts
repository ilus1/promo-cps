import { beforeEach, describe, expect, test, vi } from 'vitest'
import { removedKey } from '@/db/removed-refs'
import type { ListingPage, ListingUpsert, NewListing } from '@/db/watch-listings'
import type { ProductToResolve } from '@/db/watch-products'
import type { ListingCandidate, ListingQuote, WatchRetailer } from '@/lib/watch/types'
import type { GateResult } from './site-gate'
import type { Candidates, Quote, WatchSources } from './sources'
import { resolvePass, resolveProduct, searchText, sharedHighEan, type ResolveDeps, type ResolveProgress, type ResolveStep } from './resolve'

const NOW = new Date('2026-11-06T12:00:00Z')
const ID = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const EAN = '7891234567895'
const OTHER_EAN = '7891234567888'
const NAME = 'Fone de Ouvido JBL Tune 520BT Bluetooth Preto'
const SKIPPED: GateResult<never> = { kind: 'skipped', reason: 'blocked' }
const EMPTY: GateResult<never> = { kind: 'empty', reason: 'nenhum resultado' }
const WALL: GateResult<never> = { kind: 'wall', reason: 'captcha' }

function candidate(retailer: WatchRetailer, ref: string, patch: Partial<ListingCandidate> = {}): ListingCandidate {
  return {
    retailer, ref, url: `https://${retailer}.example/${ref}`, title: NAME, ean: null, merchant: null,
    priceCents: 30_000, listPriceCents: null, inStock: true, ...patch,
  }
}

function quote(ref: string, patch: Partial<ListingQuote> = {}): ListingQuote {
  return { ref, merchant: null, title: NAME, priceCents: 30_000, listPriceCents: null, finalCents: 30_000, inStock: true, ...patch }
}

const ok = <T>(value: T): GateResult<T> => ({ kind: 'ok', value })

function product(patch: Partial<ProductToResolve> = {}): ProductToResolve {
  return { id: ID, name: NAME, query: NAME, ean: null, eanSource: null, resolvedAt: null, ...patch }
}

type Fn<T> = T extends (...args: infer A) => infer R ? ReturnType<typeof vi.fn<(...args: A) => R>> : never
type FakeSources = { [K in keyof WatchSources]: Fn<WatchSources[K]> }

let sources: FakeSources
let upsert: Fn<ResolveDeps['upsert']>
let recordQuote: Fn<ResolveDeps['recordQuote']>
let recordPageQuotes: Fn<ResolveDeps['recordPageQuotes']>
let recordError: Fn<ResolveDeps['recordError']>
let recordPageError: Fn<ResolveDeps['recordPageError']>
let update: Fn<ResolveDeps['update']>
let markResolved: Fn<ResolveDeps['markResolved']>
let removedRefs: Fn<ResolveDeps['removedRefs']>
let mlLinksGone: Fn<ResolveDeps['mlLinksGone']>
let alerts: Fn<ResolveDeps['alerts']>
let due: Fn<ResolveDeps['due']>
let logLine: Fn<ResolveDeps['log']>
let deps: ResolveDeps

const searchOf = (result: Candidates) => vi.fn(async () => result)

beforeEach(() => {
  sources = {
    americanasByEan: searchOf(EMPTY),
    americanasByText: searchOf(EMPTY),
    americanasLink: searchOf(EMPTY),
    americanasQuote: vi.fn(async (): Promise<Quote> => EMPTY),
    amazonSearch: searchOf(EMPTY),
    amazonQuote: vi.fn(async (): Promise<Quote> => EMPTY),
    kabumSearch: searchOf(EMPTY),
    kabumQuote: vi.fn(async (): Promise<Quote> => EMPTY),
    buscapeSearch: searchOf(EMPTY),
    buscapeQuotes: vi.fn(async (): Promise<GateResult<ListingQuote[]>> => EMPTY),
  }
  upsert = vi.fn(async (): Promise<ListingUpsert> => ({ id: 'listing-1', status: 'inserted' }))
  recordQuote = vi.fn(async () => undefined)
  recordPageQuotes = vi.fn(async (): Promise<ListingUpsert[]> => [])
  recordError = vi.fn(async () => undefined)
  recordPageError = vi.fn(async () => undefined)
  update = vi.fn(async () => true)
  markResolved = vi.fn(async () => undefined)
  removedRefs = vi.fn(async () => new Map())
  mlLinksGone = vi.fn(async () => new Set<string>())
  alerts = vi.fn(async () => 0)
  due = vi.fn(async () => [product()])
  logLine = vi.fn()
  deps = {
    sources, chrome: { during: (work) => work() }, due, upsert, recordQuote, recordPageQuotes, recordError, recordPageError, update, markResolved, removedRefs, mlLinksGone, alerts,
    now: () => NOW, log: logLine,
  }
})

async function resolve(
  target: ProductToResolve = product(), done = new Set<ResolveStep>(), removed: ReadonlySet<string> = new Set(), mlLinkGone = false,
) {
  return { resolved: await resolveProduct(target, done, deps, { removed, mlLinkGone }), done }
}

const upserted = (): NewListing[] => upsert.mock.calls.map(([, listing]) => listing)

describe('searchText', () => {
  test('a typed name searches, a pasted link does not', () => {
    expect(searchText({ query: ' fone jbl ' })).toBe('fone jbl')
    expect(searchText({ query: 'https://www.kabum.com.br/produto/1' })).toBeNull()
    expect(searchText({ query: '  ' })).toBeNull()
  })
})

describe('sharedHighEan', () => {
  test('adopts the EAN only when every high-confidence title match carries the same one', () => {
    const same = [candidate('americanas', '1:1', { ean: EAN }), candidate('americanas', '1:2', { ean: `0${EAN}` })]
    expect(sharedHighEan(NAME, same)).toBe(EAN)
    expect(sharedHighEan(NAME, [...same, candidate('americanas', '2:1', { ean: OTHER_EAN })])).toBeNull()
    expect(sharedHighEan(NAME, [...same, candidate('americanas', '3:1', { ean: null })])).toBeNull()
  })

  test('candidates that do not match the name do not count, and no high match gives no EAN', () => {
    const unrelated = candidate('americanas', '9:9', { title: 'Geladeira Brastemp Frost Free 375 Litros', ean: OTHER_EAN })
    expect(sharedHighEan(NAME, [candidate('americanas', '1:1', { ean: EAN }), unrelated])).toBe(EAN)
    expect(sharedHighEan(NAME, [unrelated])).toBeNull()
  })
})

describe('store search', () => {
  test('a typed name searches each store by text, and a match becomes a single-store listing', async () => {
    sources.kabumSearch.mockResolvedValue(ok([candidate('kabum', '925350', { merchant: 'KaBuM!' })]))
    const { resolved, done } = await resolve()
    expect(resolved).toBe('resolved')
    expect([...done].sort()).toEqual(['amazon', 'americanas', 'buscape', 'kabum'])
    expect(sources.americanasByText).toHaveBeenCalledWith(NAME)
    expect(sources.amazonSearch).toHaveBeenCalledWith(NAME)
    expect(sources.kabumSearch).toHaveBeenCalledWith(NAME)
    expect(sources.buscapeSearch).toHaveBeenCalledWith(NAME)
    expect(upserted()).toEqual([{
      retailer: 'kabum', ref: '925350', url: 'https://kabum.example/925350', title: NAME, merchant: null, match: 'auto',
    }])
    expect(recordQuote).not.toHaveBeenCalled()
  })

  test('a known EAN searches Americanas and Amazon by barcode first', async () => {
    sources.americanasByEan.mockResolvedValue(ok([candidate('americanas', '1:1', { ean: EAN })]))
    sources.amazonSearch.mockImplementation(async (query) => (query === EAN ? ok([candidate('amazon', 'B0C1234567')]) : EMPTY))
    await resolve(product({ ean: EAN }))
    expect(sources.americanasByEan).toHaveBeenCalledWith(EAN)
    expect(sources.americanasByText).not.toHaveBeenCalled()
    expect(sources.amazonSearch).toHaveBeenCalledTimes(1)
    expect(upserted().map((listing) => [listing.retailer, listing.match])).toEqual([['americanas', 'barcode'], ['amazon', 'barcode']])
  })

  test('a barcode search that finds nothing falls back to the text search', async () => {
    sources.amazonSearch.mockImplementation(async (query) => (query === EAN ? EMPTY : ok([candidate('amazon', 'B0C1234567')])))
    await resolve(product({ ean: EAN }))
    expect(sources.amazonSearch.mock.calls).toEqual([[EAN], [NAME]])
    expect(sources.americanasByText).toHaveBeenCalledWith(NAME)
    expect(upserted()).toEqual([expect.objectContaining({ retailer: 'amazon', match: 'auto' })])
  })

  test('without an EAN, a shared Americanas barcode is adopted and makes the match a barcode one', async () => {
    sources.americanasByText.mockResolvedValue(ok([candidate('americanas', '1:1', { ean: EAN })]))
    await resolve()
    expect(update).toHaveBeenCalledWith(ID, { ean: EAN, eanSource: 'americanas' })
    expect(upserted()[0]).toMatchObject({ retailer: 'americanas', match: 'barcode' })
    expect(sources.amazonSearch).toHaveBeenCalledWith(EAN)
  })

  test('a held, blocked or walled store stays pending while the others finish, and a wall counts as a failure', async () => {
    sources.amazonSearch.mockResolvedValue(SKIPPED)
    sources.kabumSearch.mockResolvedValue(WALL)
    const { resolved, done } = await resolve()
    expect(resolved).toBe('failed')
    expect([...done].sort()).toEqual(['americanas', 'buscape'])
    sources.amazonSearch.mockResolvedValue(EMPTY)
    sources.kabumSearch.mockResolvedValue(EMPTY)
    const again = await resolve(product(), done)
    expect(again.resolved).toBe('resolved')
    expect(sources.americanasByText).toHaveBeenCalledTimes(1)
  })

  test('a store that is only held or blocked leaves the product pending, not failed', async () => {
    sources.amazonSearch.mockResolvedValue(SKIPPED)
    expect((await resolve()).resolved).toBe('pending')
  })

  test('a Buscapé match reads the product page and records every merchant on it', async () => {
    const card = candidate('buscape', 'fone-de-ouvido/jbl-tune-520bt', { merchant: 'Magazine Luiza' })
    const merchants = [quote(card.ref, { merchant: 'KaBuM!' }), quote(card.ref, { merchant: 'Magazine Luiza', finalCents: 29_000 })]
    sources.buscapeSearch.mockResolvedValue(ok([card]))
    sources.buscapeQuotes.mockResolvedValue(ok(merchants))
    await resolve()
    expect(sources.buscapeQuotes).toHaveBeenCalledWith(card.ref, NAME)
    const page: ListingPage = { retailer: 'buscape', ref: card.ref, url: card.url, title: NAME, match: 'auto' }
    expect(recordPageQuotes).toHaveBeenCalledWith(ID, page, merchants, NOW)
    expect(alerts).toHaveBeenCalledWith(ID, NOW)
    expect(upsert).not.toHaveBeenCalled()
  })

  test('a Buscapé page with no offer of the product records no merchant and finishes the step', async () => {
    const card = candidate('buscape', 'fone/jbl')
    sources.buscapeSearch.mockResolvedValue(ok([card]))
    sources.buscapeQuotes.mockResolvedValue({ kind: 'empty', reason: 'nenhuma oferta do produto' })
    const { done } = await resolve()
    expect(recordPageQuotes).toHaveBeenCalledWith(ID, expect.objectContaining({ ref: card.ref }), [], NOW)
    expect(done.has('buscape')).toBe(true)
  })

  test('a Buscapé page that is gone records the error on its merchants and finishes the step', async () => {
    const card = candidate('buscape', 'fone/jbl')
    sources.buscapeSearch.mockResolvedValue(ok([card]))
    sources.buscapeQuotes.mockResolvedValue({ kind: 'missing', reason: 'HTTP 404' })
    const { done } = await resolve()
    expect(recordPageError).toHaveBeenCalledWith(ID, 'buscape', card.ref, 'HTTP 404', NOW)
    expect(recordPageQuotes).not.toHaveBeenCalled()
    expect(done.has('buscape')).toBe(true)
  })

  test('a Buscapé page that is held keeps the step pending', async () => {
    sources.buscapeSearch.mockResolvedValue(ok([candidate('buscape', 'fone/jbl')]))
    sources.buscapeQuotes.mockResolvedValue(SKIPPED)
    const { done } = await resolve()
    expect(done.has('buscape')).toBe(false)
  })

  test('an unrelated result is not adopted', async () => {
    sources.kabumSearch.mockResolvedValue(ok([candidate('kabum', '1', { title: 'Geladeira Brastemp Frost Free 375 Litros' })]))
    const { resolved } = await resolve()
    expect(resolved).toBe('resolved')
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('pasted links', () => {
  const KABUM_LINK = 'https://www.kabum.com.br/produto/925350'

  test('a Kabum link reads the product page, names the product from its title, then searches the other stores', async () => {
    sources.kabumQuote.mockResolvedValue(ok(quote('925350')))
    const { resolved, done } = await resolve(product({ name: KABUM_LINK, query: KABUM_LINK }))
    expect(sources.kabumQuote).toHaveBeenCalledWith('925350')
    expect(upserted()[0]).toEqual({ retailer: 'kabum', ref: '925350', url: KABUM_LINK, title: NAME, merchant: null, match: 'link' })
    expect(recordQuote).toHaveBeenCalledWith('listing-1', quote('925350'), NOW)
    expect(update).toHaveBeenCalledWith(ID, { name: NAME, query: 'fone ouvido jbl tune 520bt bluetooth preto' })
    expect(sources.kabumSearch).not.toHaveBeenCalled()
    expect(sources.americanasByText).toHaveBeenCalledWith('fone ouvido jbl tune 520bt bluetooth preto')
    expect(resolved).toBe('resolved')
    expect(done.has('link')).toBe(true)
  })

  test('an Amazon link that is held is retried before anything else', async () => {
    sources.amazonQuote.mockResolvedValue(SKIPPED)
    const link = 'https://www.amazon.com.br/dp/B0C1234567'
    const { resolved, done } = await resolve(product({ name: link, query: link }))
    expect(resolved).toBe('pending')
    expect(done.size).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
    expect(sources.americanasByText).not.toHaveBeenCalled()
  })

  test('a broken link keeps its listing with the error shown, and the unnamed product is resolved without any text search', async () => {
    sources.kabumQuote.mockResolvedValue({ kind: 'missing', reason: 'HTTP 404' })
    const { resolved } = await resolve(product({ name: KABUM_LINK, query: KABUM_LINK }))
    expect(upserted()[0]).toMatchObject({ retailer: 'kabum', title: KABUM_LINK, match: 'link' })
    expect(recordQuote).not.toHaveBeenCalled()
    expect(recordError).toHaveBeenCalledWith('listing-1', 'HTTP 404', NOW)
    expect(update).not.toHaveBeenCalled()
    expect(resolved).toBe('resolved')
    for (const search of [sources.americanasByText, sources.americanasByEan, sources.amazonSearch, sources.kabumSearch, sources.buscapeSearch]) {
      expect(search).not.toHaveBeenCalled()
    }
  })

  test('an unnamed product with an EAN runs only the barcode searches, and a barcode miss is done with no text fallback', async () => {
    sources.kabumQuote.mockResolvedValue({ kind: 'missing', reason: 'HTTP 404' })
    sources.amazonSearch.mockResolvedValue(EMPTY)
    const { resolved } = await resolve(product({ name: KABUM_LINK, query: KABUM_LINK, ean: EAN }))
    expect(sources.americanasByEan).toHaveBeenCalledWith(EAN)
    expect(sources.amazonSearch.mock.calls).toEqual([[EAN]])
    expect(sources.americanasByText).not.toHaveBeenCalled()
    expect(sources.buscapeSearch).not.toHaveBeenCalled()
    expect(resolved).toBe('resolved')
  })

  test('a product whose query is any URL is never text-searched', async () => {
    const url = 'https://www.exemplo.com.br/fone'
    await resolve(product({ name: url, query: url }))
    expect(sources.americanasByText).not.toHaveBeenCalled()
    expect(sources.kabumSearch).not.toHaveBeenCalled()
  })

  test('a link page without a quotable offer still names the product from its title, then the stores are searched', async () => {
    sources.amazonQuote.mockResolvedValue({ kind: 'empty', reason: 'sem estoque', title: NAME })
    const link = 'https://www.amazon.com.br/dp/B0C1234567'
    const { resolved } = await resolve(product({ name: link, query: link }))
    expect(upserted()[0]).toMatchObject({ retailer: 'amazon', title: NAME, match: 'link' })
    expect(recordError).toHaveBeenCalledWith('listing-1', 'sem estoque', NOW)
    expect(update).toHaveBeenCalledWith(ID, { name: NAME, query: 'fone ouvido jbl tune 520bt bluetooth preto' })
    expect(sources.americanasByText).toHaveBeenCalledWith('fone ouvido jbl tune 520bt bluetooth preto')
    expect(resolved).toBe('resolved')
  })

  test('a walled link page without a title fails, so the product backs off', async () => {
    sources.kabumQuote.mockResolvedValue(WALL)
    const { resolved } = await resolve(product({ name: KABUM_LINK, query: KABUM_LINK }))
    expect(resolved).toBe('failed')
    expect(upsert).not.toHaveBeenCalled()
  })

  test('a Buscapé link page with only direct stores names the product from the page title', async () => {
    const ref = 'fone-de-ouvido/jbl-tune-520bt'
    sources.buscapeQuotes.mockResolvedValue({ kind: 'empty', reason: 'só ofertas de lojas lidas direto', title: NAME })
    const link = `https://www.buscape.com.br/${ref}`
    await resolve(product({ name: link, query: link }))
    expect(update).toHaveBeenCalledWith(ID, expect.objectContaining({ name: NAME }))
    expect(sources.buscapeSearch).not.toHaveBeenCalled()
    expect(sources.kabumSearch).toHaveBeenCalled()
  })

  test('an Americanas link gives the SKU, its EAN and the title', async () => {
    sources.americanasLink.mockResolvedValue(ok([candidate('americanas', '123:456', { ean: EAN })]))
    const link = 'https://www.americanas.com.br/fone-jbl-tune-520bt/p'
    await resolve(product({ name: link, query: link }))
    expect(sources.americanasLink).toHaveBeenCalledWith('fone-jbl-tune-520bt')
    expect(upserted()[0]).toEqual({
      retailer: 'americanas', ref: '123:456', url: 'https://americanas.example/123:456', title: NAME, merchant: null, match: 'link',
    })
    expect(update).toHaveBeenCalledWith(ID, { ean: EAN, eanSource: 'link' })
    expect(sources.americanasByEan).not.toHaveBeenCalled()
    expect(sources.amazonSearch).toHaveBeenCalledWith(EAN)
  })

  test('an Americanas link whose product has no SKU names the product and searches the other stores, with no listing', async () => {
    sources.americanasLink.mockResolvedValue({ kind: 'unknown', reason: 'produtos ilegíveis', title: NAME })
    const link = 'https://www.americanas.com.br/fone-jbl-tune-520bt/p'
    const { resolved, done } = await resolve(product({ name: link, query: link }))
    expect(update).toHaveBeenCalledWith(ID, { name: NAME, query: 'fone ouvido jbl tune 520bt bluetooth preto' })
    expect(upsert).not.toHaveBeenCalled()
    expect(sources.americanasByText).not.toHaveBeenCalled()
    expect(sources.amazonSearch).toHaveBeenCalledWith('fone ouvido jbl tune 520bt bluetooth preto')
    expect(resolved).toBe('resolved')
    expect(done.has('americanas')).toBe(true)
  })

  test('an Americanas link to an unknown product is resolved unnamed; a wall without a title fails', async () => {
    const link = 'https://www.americanas.com.br/fone-jbl-tune-520bt/p'
    sources.americanasLink.mockResolvedValue({ kind: 'empty', reason: 'nenhum produto' })
    expect((await resolve(product({ name: link, query: link }))).resolved).toBe('resolved')
    expect(update).not.toHaveBeenCalled()
    sources.americanasLink.mockResolvedValue(WALL)
    expect((await resolve(product({ name: link, query: link }))).resolved).toBe('failed')
  })

  test('a Buscapé link records its merchants as link listings', async () => {
    const ref = 'fone-de-ouvido/jbl-tune-520bt'
    sources.buscapeQuotes.mockResolvedValue(ok([quote(ref, { merchant: 'KaBuM!' })]))
    const link = `https://www.buscape.com.br/${ref}`
    await resolve(product({ name: link, query: link }))
    expect(sources.buscapeQuotes).toHaveBeenCalledWith(ref, null)
    expect(recordPageQuotes).toHaveBeenCalledWith(ID, { retailer: 'buscape', ref, url: link, title: NAME, match: 'link' }, [quote(ref, { merchant: 'KaBuM!' })], NOW)
    expect(sources.buscapeSearch).not.toHaveBeenCalled()
  })

  test('an ML link becomes the ML listing and waits for the ML cycle to read its title', async () => {
    const link = 'https://www.mercadolivre.com.br/fone-jbl/p/MLB123456'
    const { resolved, done } = await resolve(product({ name: link, query: link }))
    expect(upserted()[0]).toEqual({
      retailer: 'ml', ref: 'MLB123456', url: 'https://www.mercadolivre.com.br/p/MLB123456', title: 'https://www.mercadolivre.com.br/p/MLB123456', merchant: null, match: 'link',
    })
    expect(resolved).toBe('pending')
    expect([...done]).toEqual(['link'])
    expect(sources.americanasByText).not.toHaveBeenCalled()
  })
})

describe('resolvePass', () => {
  test('a fully resolved product is marked and forgotten; a pending one keeps its progress', async () => {
    const pending = product({ id: 'pending' })
    due.mockResolvedValue([product(), pending])
    sources.amazonSearch.mockImplementation(async () => (sources.amazonSearch.mock.calls.length === 2 ? SKIPPED : EMPTY))
    const progress: ResolveProgress = new Map()
    expect(await resolvePass(deps, progress)).toEqual({ due: 2, resolved: 1 })
    expect(markResolved).toHaveBeenCalledWith(ID, NOW)
    expect([...progress.keys()]).toEqual(['pending'])
  })

  test('progress of products no longer due is dropped', async () => {
    const progress: ResolveProgress = new Map([['gone', { done: new Set<ResolveStep>(['americanas']), failures: 0, retryAt: null }]])
    due.mockResolvedValue([])
    await resolvePass(deps, progress)
    expect(progress.size).toBe(0)
  })

  test('one failing product is logged and does not stop the others', async () => {
    due.mockResolvedValue([product({ id: 'broken' }), product()])
    upsert.mockRejectedValueOnce(new Error('db down'))
    sources.kabumSearch.mockResolvedValue(ok([candidate('kabum', '1')]))
    expect(await resolvePass(deps, new Map())).toEqual({ due: 2, resolved: 1 })
    expect(logLine).toHaveBeenCalledWith(expect.stringContaining('resolve broken failed: db down'))
  })

  test('the whole pass runs inside one Chrome scope', async () => {
    const during = vi.fn((work: () => Promise<unknown>) => work())
    await resolvePass({ ...deps, chrome: { during: during as ResolveDeps['chrome']['during'] } }, new Map())
    expect(during).toHaveBeenCalledTimes(1)
  })
})

describe('resolve backoff', () => {
  test('a failed product waits out a growing backoff before its next try, and a success clears it', async () => {
    let clock = NOW.getTime()
    deps.now = () => new Date(clock)
    sources.kabumSearch.mockResolvedValue(WALL)
    const progress: ResolveProgress = new Map()
    await resolvePass(deps, progress)
    expect(progress.get(ID)).toMatchObject({ failures: 1, retryAt: clock + 60_000 })
    await resolvePass(deps, progress)
    expect(sources.kabumSearch).toHaveBeenCalledTimes(1)
    clock += 60_000
    await resolvePass(deps, progress)
    expect(sources.kabumSearch).toHaveBeenCalledTimes(2)
    expect(progress.get(ID)).toMatchObject({ failures: 2, retryAt: clock + 120_000 })
    clock += 120_000
    sources.kabumSearch.mockResolvedValue(EMPTY)
    expect(await resolvePass(deps, progress)).toEqual({ due: 1, resolved: 1 })
    expect(progress.has(ID)).toBe(false)
  })

  test('a product only held keeps no backoff and is tried again on the next pass', async () => {
    sources.amazonSearch.mockResolvedValue(SKIPPED)
    const progress: ResolveProgress = new Map()
    await resolvePass(deps, progress)
    await resolvePass(deps, progress)
    expect(sources.amazonSearch).toHaveBeenCalledTimes(2)
    expect(progress.get(ID)).toMatchObject({ failures: 0, retryAt: null })
  })

  test('a product whose resolve throws backs off too', async () => {
    upsert.mockRejectedValue(new Error('db down'))
    sources.kabumSearch.mockResolvedValue(ok([candidate('kabum', '1')]))
    const progress: ResolveProgress = new Map()
    await resolvePass(deps, progress)
    expect(progress.get(ID)?.failures).toBe(1)
  })
})

describe('removed listings', () => {
  const cheap = candidate('kabum', 'removed-one', { priceCents: 20_000 })
  const next = candidate('kabum', 'next-best', { priceCents: 25_000 })

  test('a ref Fernando removed is left out, so the next-best candidate of that store is adopted', async () => {
    sources.kabumSearch.mockResolvedValue(ok([cheap, next]))
    await resolve(product(), new Set(), new Set([removedKey('kabum', 'removed-one')]))
    expect(upserted()).toEqual([expect.objectContaining({ retailer: 'kabum', ref: 'next-best' })])
  })

  test('when only removed refs match, the store has no match', async () => {
    sources.kabumSearch.mockResolvedValue(ok([cheap]))
    const { done } = await resolve(product(), new Set(), new Set([removedKey('kabum', 'removed-one')]))
    expect(upsert).not.toHaveBeenCalled()
    expect(done.has('kabum')).toBe(true)
  })

  test('a removed ref at another store changes nothing, and so does an empty set', async () => {
    sources.kabumSearch.mockResolvedValue(ok([cheap, next]))
    await resolve(product(), new Set(), new Set([removedKey('amazon', 'removed-one')]))
    expect(upserted()).toEqual([expect.objectContaining({ ref: 'removed-one' })])
  })

  test('the pass loads the removed refs of the due products once and hands each product its own', async () => {
    due.mockResolvedValue([product(), product({ id: 'other' })])
    removedRefs.mockResolvedValue(new Map([[ID, new Set([removedKey('kabum', 'removed-one')])]]))
    sources.kabumSearch.mockResolvedValue(ok([cheap, next]))
    await resolvePass(deps, new Map())
    expect(removedRefs).toHaveBeenCalledTimes(1)
    expect(removedRefs).toHaveBeenCalledWith([ID, 'other'])
    expect(upsert.mock.calls.map(([productId, listing]) => [productId, listing.ref])).toEqual([[ID, 'next-best'], ['other', 'removed-one']])
  })
})

describe('ML links in the resolver', () => {
  const ML_LINK = 'https://www.mercadolivre.com.br/fone-jbl/p/MLB123456'

  test('stays pending until the ML cycle names it, then every store is searched on the next tick', async () => {
    const progress: ResolveProgress = new Map()
    due.mockResolvedValue([product({ name: ML_LINK, query: ML_LINK })])
    expect(await resolvePass(deps, progress)).toEqual({ due: 1, resolved: 0 })
    expect(sources.americanasByText).not.toHaveBeenCalled()
    due.mockResolvedValue([product({ name: NAME, query: 'fone ouvido jbl tune 520bt bluetooth preto' })])
    expect(await resolvePass(deps, progress)).toEqual({ due: 1, resolved: 1 })
    expect(sources.americanasByText).toHaveBeenCalledWith('fone ouvido jbl tune 520bt bluetooth preto')
    expect(sources.kabumSearch).toHaveBeenCalled()
    expect(sources.buscapeSearch).toHaveBeenCalled()
  })

  test('a dead ML link ends unnamed and resolved, with no text search anywhere', async () => {
    due.mockResolvedValue([product({ name: ML_LINK, query: ML_LINK })])
    mlLinksGone.mockResolvedValue(new Set([ID]))
    expect(await resolvePass(deps, new Map())).toEqual({ due: 1, resolved: 1 })
    expect(markResolved).toHaveBeenCalledWith(ID, NOW)
    for (const search of [sources.americanasByText, sources.amazonSearch, sources.kabumSearch, sources.buscapeSearch]) {
      expect(search).not.toHaveBeenCalled()
    }
  })
})
