import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ML_LINK_GONE } from '@/db/listing-outcome'
import { removedKey } from '@/db/removed-refs'
import type { ListingUpsert, NewListing } from '@/db/watch-listings'
import type { ProductToResolve } from '@/db/watch-products'
import type { CouponHint } from '@/lib/coupon-hint'
import { RunStop } from '../errors'
import type { ObservedCard } from '../ml/observed-card'
import type { LoadedPage } from '../ml/page-state'
import { SearchResultsMissing, type SearchPage } from '../ml/search-page'
import type { Loaded } from './breaker'
import {
  LINK_FAILURES_IN_ROW_MAX, LINK_GONE_CYCLES, ML_LISTING_GONE, mlSearchUrl, oldestCheckFirst, SEARCH_UNPARSED, watchMlProducts, type MlListingRow,
  type WatchMlIo,
} from './watch-ml-pages'

const NOW = new Date('2026-11-06T12:00:00Z')
const ID = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const EAN = '7891234567895'
const NAME = 'Fone de Ouvido JBL Tune 520BT Bluetooth Preto'
const NAME_URL = 'https://lista.mercadolivre.com.br/fone-de-ouvido-jbl-tune-520bt-bluetooth-preto'
const EAN_URL = `https://lista.mercadolivre.com.br/${EAN}`

function card(id: string, patch: Partial<ObservedCard> = {}): ObservedCard {
  return {
    id, productId: null, title: NAME, thumbnail: null, url: `https://produto.mercadolivre.com.br/${id}`, isPad: false, priceCents: 30_000,
    basisText: null, basis: 'none', listPriceCents: null, mlDiscountPct: null, soldQuantity: null, full: null, freeShipping: null,
    categoryId: null, domainId: null, sellerLabel: null, couponHint: null, ...patch,
  } as ObservedCard
}

function product(patch: Partial<ProductToResolve> = {}): ProductToResolve {
  return { id: ID, name: NAME, query: NAME, ean: null, eanSource: null, resolvedAt: null, ...patch }
}

type Page = ObservedCard[] | ObservedCard | 'missing' | 'throws' | { found: number; dropped: number; cards: ObservedCard[] }
type Fn<T> = T extends (...args: infer A) => infer R ? ReturnType<typeof vi.fn<(...args: A) => R>> : never

let pages: Record<string, Page | { error: string }>
let products: ProductToResolve[]
let listings: MlListingRow[]
let removed: Map<string, Set<string>>
let paused: boolean
let eanMisses: Set<string>
let linkFailures: Map<string, number>
let loads: string[]
let upsert: Fn<WatchMlIo['upsert']>
let recordQuote: Fn<WatchMlIo['recordQuote']>
let recordError: Fn<WatchMlIo['recordError']>
let recordGone: Fn<WatchMlIo['recordGone']>
let tick: number
let update: Fn<WatchMlIo['update']>
let alerts: Fn<WatchMlIo['alerts']>
let io: WatchMlIo

beforeEach(() => {
  pages = {}
  products = [product()]
  listings = []
  removed = new Map()
  paused = false
  eanMisses = new Set()
  linkFailures = new Map()
  loads = []
  upsert = vi.fn(async (): Promise<ListingUpsert> => ({ id: 'ml-listing', status: 'inserted' }))
  tick = 0
  const checked = (listingId: string, lastError: string | null) => {
    tick += 1
    listings = listings.map((row) => (row.id === listingId ? { ...row, lastError, checkedAt: new Date(NOW.getTime() + tick) } : row))
  }
  recordQuote = vi.fn(async (listingId: string) => checked(listingId, null))
  recordError = vi.fn(async (listingId: string, error: string) => checked(listingId, error))
  recordGone = vi.fn(async (listingId: string, error: string) => checked(listingId, error))
  update = vi.fn(async () => true)
  alerts = vi.fn(async () => 0)
  io = {
    eanMisses,
    linkFailures,
    paused: async () => paused,
    products: async () => products,
    mlListings: async () => listings,
    removedRefs: async () => removed,
    load: async (url): Promise<Loaded<LoadedPage>> => {
      loads.push(url)
      const answer = pages[url] ?? 'missing'
      if (typeof answer === 'object' && 'error' in answer) return { ok: false, error: answer.error }
      return { ok: true, value: { finalUrl: url, pageProps: { answer } } }
    },
    loadLink: async (url): Promise<Loaded<LoadedPage>> => {
      loads.push(url)
      const answer = pages[url] ?? 'missing'
      if (typeof answer === 'object' && 'error' in answer) return { ok: false, error: answer.error }
      return { ok: true, value: { finalUrl: url, pageProps: { answer } } }
    },
    readSearch: (pageProps): SearchPage => {
      const answer = pageProps.answer as Page
      if (answer === 'missing') throw new SearchResultsMissing()
      if (answer === 'throws') throw new Error('reader changed')
      if (!Array.isArray(answer)) return { ...(answer as { found: number; dropped: number; cards: ObservedCard[] }), nextUrl: null }
      const cards = answer as ObservedCard[]
      return { cards, found: cards.length, dropped: 0, nextUrl: null }
    },
    readProduct: (pageProps) => {
      if (pageProps.answer === 'throws') throw new Error('product reader changed')
      return pageProps.answer as ObservedCard
    },
    upsert, recordQuote, recordError, recordGone, update, alerts,
    now: () => NOW,
  }
})

const upserted = (): NewListing[] => upsert.mock.calls.map(([, listing]) => listing)

test('mlSearchUrl turns text into an ML search slug', () => {
  expect(mlSearchUrl(NAME)).toBe(NAME_URL)
  expect(mlSearchUrl(EAN)).toBe(EAN_URL)
  expect(mlSearchUrl(' !! ')).toBeNull()
})

describe('searching ML', () => {
  test('a title match becomes the ML listing, quoted with the coupon final price, then alerts are checked', async () => {
    const hint: CouponHint = { percentOff: 10, amountOffCents: null, priceAfterCents: null } as CouponHint
    pages[NAME_URL] = [card('MLB1', { couponHint: hint, sellerLabel: 'Loja oficial JBL' })]
    const result = await watchMlProducts(io)
    expect(loads).toEqual([NAME_URL])
    expect(upserted()).toEqual([{ retailer: 'ml', ref: 'MLB1', url: 'https://produto.mercadolivre.com.br/MLB1', title: NAME, merchant: null, match: 'auto' }])
    expect(recordQuote).toHaveBeenCalledWith('ml-listing', expect.objectContaining({ ref: 'MLB1', priceCents: 30_000, finalCents: 27_000 }), NOW)
    expect(alerts).toHaveBeenCalledWith(ID, NOW)
    expect(result).toEqual({ products: 1, matched: 1, failed: 0, pages: 1, empty: 0, cards: 1, dropped: 0, skipped: 0, lastError: null })
  })

  test('the EAN search comes first, and its top card counts as a barcode match', async () => {
    products = [product({ ean: EAN })]
    pages[EAN_URL] = [card('MLB2')]
    await watchMlProducts(io)
    expect(loads).toEqual([EAN_URL])
    expect(upserted()[0]).toMatchObject({ ref: 'MLB2', match: 'barcode' })
    expect(eanMisses.has(ID)).toBe(false)
  })

  test('one search page per product per cycle: an EAN search without a match is remembered, and the next cycle uses the title', async () => {
    products = [product({ ean: EAN })]
    pages[NAME_URL] = [card('MLB3')]
    await watchMlProducts(io)
    expect(loads).toEqual([EAN_URL])
    expect(upsert).not.toHaveBeenCalled()
    expect(eanMisses.has(ID)).toBe(true)
    await watchMlProducts(io)
    expect(loads).toEqual([EAN_URL, NAME_URL])
    expect(upserted()[0]).toMatchObject({ ref: 'MLB3', match: 'auto' })
  })

  test('a tracked auto match is searched by its title even with an EAN, and is gone only when that search misses it', async () => {
    products = [product({ ean: EAN })]
    listings = [{ id: 'tracked', productId: ID, ref: 'MLB9', url: 'u', match: 'auto', lastError: null, checkedAt: null }]
    pages[NAME_URL] = [card('MLB9')]
    await watchMlProducts(io)
    expect(loads).toEqual([NAME_URL])
    expect(recordQuote).toHaveBeenCalledWith('tracked', expect.objectContaining({ ref: 'MLB9' }), NOW)
    pages[NAME_URL] = []
    await watchMlProducts(io)
    expect(loads).toEqual([NAME_URL, NAME_URL])
    expect(recordError).toHaveBeenCalledWith('tracked', ML_LISTING_GONE, NOW)
  })

  test('a tracked barcode match is searched by the EAN only', async () => {
    products = [product({ ean: EAN })]
    listings = [{ id: 'tracked', productId: ID, ref: 'MLB2', url: 'u', match: 'barcode', lastError: null, checkedAt: null }]
    pages[EAN_URL] = []
    await watchMlProducts(io)
    expect(loads).toEqual([EAN_URL])
    expect(recordError).toHaveBeenCalledWith('tracked', ML_LISTING_GONE, NOW)
  })

  test('the listing already tracked is quoted from its card without a new match', async () => {
    listings = [{ id: 'tracked', productId: ID, ref: 'MLB9', url: 'https://produto.mercadolivre.com.br/MLB9', match: 'auto', lastError: null, checkedAt: null }]
    pages[NAME_URL] = [card('MLB1', { priceCents: 1_000 }), card('MLB9')]
    await watchMlProducts(io)
    expect(upsert).not.toHaveBeenCalled()
    expect(recordQuote).toHaveBeenCalledWith('tracked', expect.objectContaining({ ref: 'MLB9' }), NOW)
  })

  test('a tracked listing missing from the search gets an error, and the new match is kept out', async () => {
    listings = [{ id: 'tracked', productId: ID, ref: 'MLB9', url: 'u', match: 'auto', lastError: null, checkedAt: null }]
    pages[NAME_URL] = [card('MLB1')]
    upsert.mockResolvedValue({ id: 'tracked', status: 'kept' })
    await watchMlProducts(io)
    expect(recordQuote).not.toHaveBeenCalled()
    expect(recordError).toHaveBeenCalledWith('tracked', ML_LISTING_GONE, NOW)
  })

  test('a removed match is not quoted', async () => {
    pages[NAME_URL] = [card('MLB1')]
    upsert.mockResolvedValue({ id: 'gone', status: 'removed' })
    const result = await watchMlProducts(io)
    expect(recordQuote).not.toHaveBeenCalled()
    expect(result.matched).toBe(0)
  })

  test('a ref Fernando removed is left out, so the next-best card is adopted', async () => {
    pages[NAME_URL] = [card('MLB1', { priceCents: 20_000 }), card('MLB2', { priceCents: 25_000 })]
    removed.set(ID, new Set([removedKey('ml', 'MLB1')]))
    await watchMlProducts(io)
    expect(upserted()).toEqual([expect.objectContaining({ ref: 'MLB2' })])
  })

  test('only removed cards give no match', async () => {
    pages[NAME_URL] = [card('MLB1')]
    removed.set(ID, new Set([removedKey('ml', 'MLB1')]))
    await watchMlProducts(io)
    expect(upsert).not.toHaveBeenCalled()
  })

  test('an EAN search whose top card is a removed tombstone is remembered as a miss, so the next cycle searches by title', async () => {
    products = [product({ ean: EAN })]
    pages[EAN_URL] = [card('MLB7')]
    pages[NAME_URL] = [card('MLB8')]
    removed.set(ID, new Set([removedKey('ml', 'MLB7')]))
    await watchMlProducts(io)
    expect(upsert).not.toHaveBeenCalled()
    expect(eanMisses.has(ID)).toBe(true)
    await watchMlProducts(io)
    expect(loads).toEqual([EAN_URL, NAME_URL])
    expect(upserted()[0]).toMatchObject({ ref: 'MLB8' })
  })

  test('an EAN match whose upsert hits a tombstone the filter did not know is a miss too', async () => {
    products = [product({ ean: EAN })]
    pages[EAN_URL] = [card('MLB7')]
    upsert.mockResolvedValue({ id: 'gone', status: 'removed' })
    await watchMlProducts(io)
    expect(eanMisses.has(ID)).toBe(true)
  })

  test('no match and no results leave nothing behind', async () => {
    pages[NAME_URL] = [card('MLB1', { title: 'Geladeira Brastemp Frost Free 375 Litros' })]
    const result = await watchMlProducts(io)
    expect(upsert).not.toHaveBeenCalled()
    expect(result).toEqual({ products: 1, matched: 0, failed: 0, pages: 1, empty: 0, cards: 1, dropped: 0, skipped: 0, lastError: null })
  })

  test('a page with results but no readable card is a reader failure, and missing results and dropped cards are counted', async () => {
    products = [product({ id: 'a', query: 'produto a' }), product({ id: 'b', query: 'produto b' }), product({ id: 'c', query: 'produto c' })]
    pages['https://lista.mercadolivre.com.br/produto-a'] = { found: 4, dropped: 4, cards: [] }
    pages['https://lista.mercadolivre.com.br/produto-b'] = 'missing'
    pages['https://lista.mercadolivre.com.br/produto-c'] = { found: 5, dropped: 1, cards: [card('MLB1', { title: 'Outro' })] }
    const result = await watchMlProducts(io)
    expect(result).toMatchObject({ pages: 3, failed: 1, empty: 1, cards: 5, dropped: 1, lastError: SEARCH_UNPARSED })
  })

  test('a failed load is counted with its error and the next product still runs', async () => {
    products = [product({ id: 'a' }), product({ id: 'b', name: 'Mouse Logitech G203', query: 'Mouse Logitech G203' })]
    pages[NAME_URL] = { error: 'timeout' }
    const result = await watchMlProducts(io)
    expect(loads).toEqual([NAME_URL, 'https://lista.mercadolivre.com.br/mouse-logitech-g203'])
    expect(result).toMatchObject({ failed: 1, lastError: 'timeout' })
  })

  test('three reader failures in a row stop the step, unparsed pages included', async () => {
    products = ['a', 'b', 'c', 'd'].map((id) => product({ id, query: `produto ${id}` }))
    for (const id of ['a', 'b', 'd']) pages[`https://lista.mercadolivre.com.br/produto-${id}`] = 'throws'
    pages['https://lista.mercadolivre.com.br/produto-c'] = { found: 3, dropped: 3, cards: [] }
    const result = await watchMlProducts(io)
    expect(loads).toHaveLength(3)
    expect(result).toMatchObject({ products: 4, failed: 3, lastError: SEARCH_UNPARSED })
  })

  test('a run stop from the breaker (hold, session, block) propagates', async () => {
    io.load = async () => {
      throw new RunStop('blocked', 'bloqueado')
    }
    await expect(watchMlProducts(io)).rejects.toThrow('bloqueado')
  })
})

describe('linked ML listings', () => {
  const LINK = 'https://www.mercadolivre.com.br/p/MLB123'

  test('a pasted ML link reads its page, names the product and quotes the listing', async () => {
    products = [product({ name: LINK, query: LINK })]
    listings = [{ id: 'linked', productId: ID, ref: 'MLB123', url: LINK, match: 'link', lastError: null, checkedAt: null }]
    pages[LINK] = card('MLB555')
    const result = await watchMlProducts(io)
    expect(loads).toEqual([LINK])
    expect(update).toHaveBeenCalledWith(ID, { name: NAME, query: 'fone ouvido jbl tune 520bt bluetooth preto' })
    expect(recordQuote).toHaveBeenCalledWith('linked', expect.objectContaining({ ref: 'MLB555' }), NOW)
    expect(result.matched).toBe(1)
  })

  test('a named product with a link listing is not renamed', async () => {
    listings = [{ id: 'linked', productId: ID, ref: 'MLB123', url: LINK, match: 'link', lastError: null, checkedAt: null }]
    pages[LINK] = card('MLB123')
    await watchMlProducts(io)
    expect(update).not.toHaveBeenCalled()
  })

  test('an unreadable link page records the error on the listing', async () => {
    listings = [{ id: 'linked', productId: ID, ref: 'MLB123', url: LINK, match: 'link', lastError: null, checkedAt: null }]
    pages[LINK] = 'throws'
    const result = await watchMlProducts(io)
    expect(recordError).toHaveBeenCalledWith('linked', 'product reader changed', NOW)
    expect(result.failed).toBe(1)
  })

  test('a product still waiting for another store link is not searched on ML', async () => {
    const kabum = 'https://www.kabum.com.br/produto/1'
    products = [product({ name: kabum, query: kabum })]
    await watchMlProducts(io)
    expect(loads).toEqual([])
  })
})

test('the price pause skips the step without loading anything', async () => {
  paused = true
  expect(await watchMlProducts(io)).toMatchObject({ matched: 0, failed: 0, pages: 0 })
  expect(loads).toEqual([])
})

test('a pause that starts mid-step stops before the next product loads', async () => {
  products = [product({ id: 'a', query: 'produto a' }), product({ id: 'b', query: 'produto b' })]
  io.load = async (url) => {
    loads.push(url)
    paused = true
    return { ok: true, value: { finalUrl: url, pageProps: { answer: 'missing' } } }
  }
  await watchMlProducts(io)
  expect(loads).toEqual(['https://lista.mercadolivre.com.br/produto-a'])
})

describe('products still named by their link', () => {
  const KABUM = 'https://www.kabum.com.br/produto/1'

  test('with an EAN, the EAN is searched even after an EAN miss, and never the link text', async () => {
    products = [product({ name: KABUM, query: KABUM, ean: EAN })]
    eanMisses.add(ID)
    pages[EAN_URL] = [card('MLB2')]
    const result = await watchMlProducts(io)
    expect(loads).toEqual([EAN_URL])
    expect(result.skipped).toBe(0)
  })

  test('without an EAN nothing is loaded and the product counts as skipped, not as a page', async () => {
    products = [product({ name: KABUM, query: KABUM })]
    const result = await watchMlProducts(io)
    expect(loads).toEqual([])
    expect(result).toMatchObject({ pages: 0, skipped: 1 })
  })

  test('a tracked automatic listing of an unnamed product is searched by the EAN or not at all', async () => {
    listings = [{ id: 'tracked', productId: ID, ref: 'MLB9', url: 'u', match: 'auto', lastError: null, checkedAt: null }]
    products = [product({ name: KABUM, query: KABUM })]
    await watchMlProducts(io)
    expect(loads).toEqual([])
    products = [product({ name: KABUM, query: KABUM, ean: EAN })]
    await watchMlProducts(io)
    expect(loads).toEqual([EAN_URL])
  })
})

describe('dead ML links', () => {
  const LINK = 'https://www.mercadolivre.com.br/p/MLB'
  const linkRow = (id: string): MlListingRow => ({
    id: `link-${id}`, productId: id, ref: `MLB${id}`, url: `${LINK}${id}`, match: 'link', lastError: null, checkedAt: null,
  })
  const linked = (ids: string[], dead: string[]) => {
    products = ids.map((id) => product({ id, query: `produto ${id}` }))
    listings = ids.map(linkRow)
    for (const id of ids) pages[`${LINK}${id}`] = dead.includes(id) ? { error: 'pageProps ausente' } : card(`MLB${id}`)
  }
  const linkLoads = (id: string) => loads.filter((url) => url === `${LINK}${id}`).length
  const goneIds = () => recordGone.mock.calls.map(([listingId]) => listingId)

  const searchOnly = (ids: string[]) => {
    for (const id of ids) pages[`https://lista.mercadolivre.com.br/produto-${id}`] = [card(`MLB9${id}`, { title: 'Outro produto qualquer' })]
    return ids.map((id) => product({ id, query: `produto ${id}` }))
  }

  test('after 3 failing link reads in a row the rest of the links are skipped, the searches still run, and nothing advances', async () => {
    linked(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e'])
    products = [...products, ...searchOnly(['s'])]
    const result = await watchMlProducts(io)
    expect(loads.filter((url) => url.startsWith(LINK))).toHaveLength(LINK_FAILURES_IN_ROW_MAX)
    expect(loads).toContain('https://lista.mercadolivre.com.br/produto-s')
    expect(result.skipped).toBe(2)
    expect(linkFailures.size).toBe(0)
  })

  test('a good search page does not prove the item-page reader works, so failing links do not advance', async () => {
    linked(['a', 'b', 'c'], ['a', 'b', 'c'])
    products = [...products, ...searchOnly(['s'])]
    await watchMlProducts(io)
    expect(linkFailures.size).toBe(0)
  })

  test('an item-page layout change with harvest and searches working gives up nothing, however many cycles pass', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    linked(ids, [])
    for (const id of ids) pages[`${LINK}${id}`] = 'throws'
    products = [...searchOnly(['s', 't']), ...products]
    for (let cycle = 0; cycle < 8; cycle += 1) await watchMlProducts(io)
    expect(recordGone).not.toHaveBeenCalled()
    expect(linkFailures.size).toBe(0)
  })

  test('a failing link advances when another link page of the same step reads in full', async () => {
    linked(['a', 'b'], ['a'])
    await watchMlProducts(io)
    expect(linkFailures.get('a')).toBe(1)
  })

  test('all products ML links with the first 3 dead: the good links lead from cycle 2, and the dead ones are given up by cycle 4', async () => {
    linked(['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'b', 'c'])
    await watchMlProducts(io)
    expect(['d', 'e', 'f'].map(linkLoads)).toEqual([0, 0, 0])
    await watchMlProducts(io)
    expect(['d', 'e', 'f'].map(linkLoads)).toEqual([1, 1, 1])
    expect(loads.slice(LINK_FAILURES_IN_ROW_MAX, LINK_FAILURES_IN_ROW_MAX + 3)).toEqual([`${LINK}d`, `${LINK}e`, `${LINK}f`])
    await watchMlProducts(io)
    expect(recordGone).not.toHaveBeenCalled()
    await watchMlProducts(io)
    expect(goneIds().sort()).toEqual(['link-a', 'link-b', 'link-c'])
    const dead = ['a', 'b', 'c'].map(linkLoads)
    await watchMlProducts(io)
    expect(['a', 'b', 'c'].map(linkLoads)).toEqual(dead)
    expect(linkLoads('d')).toBe(4)
  })

  test('three adjacent dead links followed by good links: every good link is read within 3 cycles', async () => {
    linked(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c'])
    for (let cycle = 0; cycle < 3; cycle += 1) await watchMlProducts(io)
    for (const id of ['d', 'e']) expect(linkLoads(id)).toBeGreaterThan(0)
  })

  test('a lone dead link among search-only products is never given up, with at most one link read per cycle', async () => {
    linked(['a'], ['a'])
    products = [...products, ...searchOnly(['s', 't'])]
    for (let cycle = 1; cycle <= 6; cycle += 1) {
      await watchMlProducts(io)
      expect(linkLoads('a')).toBe(cycle)
    }
    expect(recordGone).not.toHaveBeenCalled()
    expect(recordError).toHaveBeenLastCalledWith('link-a', 'pageProps ausente', NOW)
  })

  test('a read that works resets the failure count', async () => {
    linked(['a', 'b'], ['a'])
    await watchMlProducts(io)
    expect(linkFailures.get('a')).toBe(1)
    pages[`${LINK}a`] = card('MLBa')
    await watchMlProducts(io)
    expect(linkFailures.has('a')).toBe(false)
  })

  test('the give-up goes through the stock-out path, and a named product with a dead link gets no ML search', async () => {
    linked(['a', 'b'], ['a'])
    for (let cycle = 0; cycle < LINK_GONE_CYCLES; cycle += 1) await watchMlProducts(io)
    expect(recordGone).toHaveBeenCalledWith('link-a', ML_LINK_GONE, NOW)
    pages['https://lista.mercadolivre.com.br/produto-a'] = [card('MLB1')]
    const result = await watchMlProducts(io)
    expect(linkLoads('a')).toBe(LINK_GONE_CYCLES)
    expect(loads).not.toContain('https://lista.mercadolivre.com.br/produto-a')
    expect(result.skipped).toBe(1)
  })

  test('once the dead link listing is removed, the next cycle searches by name and adopts another listing', async () => {
    listings = []
    removed.set(ID, new Set([removedKey('ml', 'MLB123')]))
    pages[NAME_URL] = [card('MLB123'), card('MLB456', { priceCents: 31_000 })]
    await watchMlProducts(io)
    expect(loads).toEqual([NAME_URL])
    expect(upserted()).toEqual([expect.objectContaining({ ref: 'MLB456' })])
  })

  test('a wall, an expired session or a hold on a link read still stops the step', async () => {
    linked(['a'], [])
    for (const stop of [new RunStop('blocked', 'captcha'), new RunStop('session_expired', 'login'), new RunStop('partial', 'VPN conectada')]) {
      io.loadLink = async () => {
        throw stop
      }
      await expect(watchMlProducts(io)).rejects.toBe(stop)
    }
    expect(recordError).not.toHaveBeenCalled()
  })
})

describe('oldestCheckFirst', () => {
  test('never-checked products come first, then the oldest check, keeping the creation order on ties', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms)
    const row = (productId: string, checkedAt: Date | null): MlListingRow => ({
      id: `l-${productId}`, productId, ref: `MLB${productId}`, url: 'u', match: 'link', lastError: null, checkedAt,
    })
    const ordered = oldestCheckFirst(
      ['a', 'b', 'c', 'd', 'e'].map((id) => product({ id })),
      [row('a', at(30)), row('b', null), row('c', at(10)), row('e', at(10))],
    )
    expect(ordered.map((entry) => entry.id)).toEqual(['b', 'd', 'c', 'e', 'a'])
  })
})
