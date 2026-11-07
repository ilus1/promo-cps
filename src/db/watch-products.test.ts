import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, test, vi } from 'vitest'
import { DAY_MS } from '@/lib/constants'
import type { WatchListingView } from '@/lib/watch/types'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb } from './__fixtures__/fake-db'
import { liveListingCondition } from './watch-listings'
import {
  activeProducts, bestOffer, createProduct, deactivateProduct, listWatchedProducts, markResolved, productsDueForResolve, updateProduct, watchedProduct,
  WATCH_LOW_WINDOW_DAYS, WATCH_RESOLVE_DAYS,
} from './watch-products'

const NOW = new Date('2026-11-06T12:00:00Z')
const PRODUCT = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const OTHER_PRODUCT = '3b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f14'
const NUL = '\u0000'
const CREATED = '2026-11-05T10:00:00.000Z'
const productRow = (id: string, name: string) => [id, name, 'fone jbl 520bt', '6925281974571', 'manual', 15000, 10, true, CREATED, null]
const listingRow = (id: string, productId: string, over: Partial<Record<string, unknown>> = {}) => {
  const row = {
    id, productId, retailer: 'amazon', merchant: '', merchantKey: '', ref: 'B0CX1', url: `https://x/${id}`, title: 'Fone', match: 'barcode', removed: false,
    priceCents: 19900, listPriceCents: 29900, finalCents: 19900, inStock: true, checkedAt: '2026-11-06T09:00:00.000Z', unavailableSince: null, lastError: null,
    createdAt: CREATED, ...over,
  }
  return Object.values(row)
}
const DAY_AGO = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString()
const segmentRow = (productId: string, listingId: string, finalCents: number, fromDaysAgo: number, endedDaysAgo: number | null, quotedCents: number) => [
  productId, listingId, finalCents, DAY_AGO(fromDaysAgo), endedDaysAgo === null ? null : DAY_AGO(endedDaysAgo), true, quotedCents, null, NOW.toISOString(), null,
]
const view = (over: Partial<WatchListingView>): WatchListingView => ({
  id: 'l', retailer: 'amazon', merchant: null, title: 't', url: 'u', match: 'auto', priceCents: 100, listPriceCents: null, finalCents: 100,
  inStock: true, checkedAt: NOW, lastError: null, ...over,
})

beforeEach(resetFakeDb)

test('a product is created with its texts cleaned and the default drop percent left to the table', async () => {
  queueRows([[PRODUCT]])
  expect(await createProduct({ name: `Fone${NUL} JBL`, query: `fone${NUL} jbl`, ean: `789${NUL}1`, eanSource: 'manual', targetPriceCents: 15000 }, NOW)).toBe(PRODUCT)
  const [insert] = captured
  expect(insert.sql).toContain('values (default, $1, $2, $3, $4, $5, default, default, $6, default) returning "id"')
  expect(insert.params).toEqual(['Fone JBL', 'fone jbl', '7891', 'manual', 15000, NOW.toISOString()])
})

test('an update sets only the given fields, and deactivating sets active to false', async () => {
  queueRows([[PRODUCT]], [[PRODUCT]])
  expect(await updateProduct(PRODUCT, { name: `Novo${NUL}`, targetPriceCents: null })).toBe(true)
  expect(captured[0]).toEqual({
    sql: 'update "watched_products" set "name" = $1, "target_price_cents" = $2 where "watched_products"."id" = $3 returning "id"',
    params: ['Novo', null, PRODUCT],
  })
  expect(await deactivateProduct(PRODUCT)).toBe(true)
  expect(captured[1].params).toEqual([false, PRODUCT])
})

test('an empty update only checks that the product exists, and an id that is not a uuid sends nothing', async () => {
  expect(await updateProduct(PRODUCT, {})).toBe(false)
  expect(captured[0].sql).toMatch(/^select "id" from "watched_products" where/)
  resetFakeDb()
  expect(await updateProduct('nope', { name: 'x' })).toBe(false)
  expect(await watchedProduct('nope', NOW)).toBeNull()
  expect(captured).toEqual([])
})

test('products are due for resolve when active and never resolved or resolved over a week ago, never-resolved first', async () => {
  await productsDueForResolve(NOW)
  const [select] = captured
  expect(select.sql).toMatch(/where \("watched_products"\."active" = \$1 and \("watched_products"\."resolved_at" is null or "watched_products"\."resolved_at" < \$2\)\) order by "watched_products"\."resolved_at" asc nulls first/)
  expect(select.params).toEqual([true, new Date(NOW.getTime() - WATCH_RESOLVE_DAYS * DAY_MS).toISOString()])
})

test('marking a product resolved stamps the time', async () => {
  await markResolved(PRODUCT, NOW)
  expect(captured[0].params).toEqual([NOW.toISOString(), PRODUCT])
})

test('the best offer is the lowest final price among listings in stock whose last check worked', () => {
  const listings = [
    view({ id: 'out', finalCents: 50, inStock: false }),
    view({ id: 'err', finalCents: 60, lastError: 'HTTP 503' }),
    view({ id: 'unseen', finalCents: null, inStock: null }),
    view({ id: 'ok', finalCents: 90, retailer: 'kabum' }),
    view({ id: 'tie', finalCents: 90, retailer: 'buscape', merchant: 'Magazine Luiza' }),
  ]
  expect(bestOffer(listings)).toEqual({ listingId: 'ok', retailer: 'kabum', merchant: null, finalCents: 90, url: 'u' })
  expect(bestOffer([view({ inStock: false })])).toBeNull()
})

test('a given-up ML link whose error "Buscar agora" cleared stays out of the best price until a fresh read quotes it', () => {
  const cleared = view({ id: 'gone', retailer: 'ml', finalCents: 10, inStock: false, lastError: null })
  expect(bestOffer([cleared, view({ id: 'ok', finalCents: 90, retailer: 'kabum' })])?.listingId).toBe('ok')
  expect(bestOffer([cleared])).toBeNull()
})

test('the list gives each active product its live listings, best offer, 30-day low and last check', async () => {
  queueRows(
    [productRow(PRODUCT, 'Fone JBL'), productRow(OTHER_PRODUCT, 'Caixa JBL')],
    [
      listingRow('a', PRODUCT, { finalCents: 18000, checkedAt: '2026-11-06T11:00:00.000Z' }),
      listingRow('b', PRODUCT, { retailer: 'buscape', merchant: 'KaBuM!', merchantKey: 'kabum', finalCents: 17000, inStock: false }),
    ],
    [segmentRow(PRODUCT, 'a', 16500, 5, null, 18000), segmentRow(PRODUCT, 'a', 18000, 1, null, 18000)],
  )
  const [fone, caixa] = await listWatchedProducts(NOW)
  expect(fone).toMatchObject({ id: PRODUCT, name: 'Fone JBL', targetPriceCents: 15000, dropPercent: 10, low30dCents: 16500 })
  expect(fone.best).toEqual({ listingId: 'a', retailer: 'amazon', merchant: null, finalCents: 18000, url: 'https://x/a' })
  expect(fone.lastCheckedAt).toEqual(new Date('2026-11-06T11:00:00.000Z'))
  expect(fone.listings.map((listing) => [listing.id, listing.merchant])).toEqual([['a', null], ['b', 'KaBuM!']])
  expect(caixa).toMatchObject({ id: OTHER_PRODUCT, best: null, low30dCents: null, lastCheckedAt: null, resolvedAt: null, listings: [] })
  const [products, listings, lows] = captured
  expect(products.sql).toMatch(/where "watched_products"\."active" = \$1 order by "watched_products"\."created_at" desc, "watched_products"\."id" asc$/)
  expect(listings.sql).toContain('where ("watched_listings"."product_id" in ($1, $2) and "watched_listings"."removed" = false)')
  expect(lows.sql).toMatch(/^select "watched_listings"\."product_id", "listing_price_segments"\."listing_id", .* from "listing_price_segments" inner join "watched_listings" /)
  expect(lows.sql).toContain('where ("watched_listings"."product_id" in ($1, $2) and "watched_listings"."removed" = false and ("listing_price_segments"."last_seen_at" >= $3 ')
  expect(lows.params.slice(2)).toEqual([DAY_AGO(WATCH_LOW_WINDOW_DAYS), DAY_AGO(WATCH_LOW_WINDOW_DAYS)])
})

test('the 30-day low is the lowest best price of the history over the window, counting a price seen before it but still quoted into it', async () => {
  queueRows(
    [productRow(PRODUCT, 'Fone JBL')],
    [listingRow('a', PRODUCT, { finalCents: 18000 }), listingRow('b', PRODUCT, { retailer: 'kabum', finalCents: 15000 })],
    [
      segmentRow(PRODUCT, 'a', 17000, WATCH_LOW_WINDOW_DAYS + 5, null, 18000),
      segmentRow(PRODUCT, 'a', 18000, 2, null, 18000),
      segmentRow(PRODUCT, 'b', 12000, WATCH_LOW_WINDOW_DAYS + 20, WATCH_LOW_WINDOW_DAYS + 10, 15000),
      segmentRow(PRODUCT, 'b', 15000, 1, null, 15000),
    ],
  )
  expect((await listWatchedProducts(NOW))[0].low30dCents).toBe(15000)
  resetFakeDb()
  queueRows(
    [productRow(PRODUCT, 'Fone JBL')],
    [listingRow('a', PRODUCT, { finalCents: 18000 })],
    [segmentRow(PRODUCT, 'a', 17000, WATCH_LOW_WINDOW_DAYS + 5, null, 18000), segmentRow(PRODUCT, 'a', 18000, 2, null, 18000)],
  )
  expect((await listWatchedProducts(NOW))[0].low30dCents).toBe(17000)
})

test('no active products means no listing or low queries', async () => {
  expect(await listWatchedProducts(NOW)).toEqual([])
  expect(captured).toHaveLength(1)
})

test('one product reads by id only while it is active, so a stopped or missing one is null', async () => {
  queueRows([productRow(PRODUCT, 'Fone JBL')], [], [])
  expect((await watchedProduct(PRODUCT, NOW))?.id).toBe(PRODUCT)
  expect(captured[0].sql).toMatch(/where \("watched_products"\."id" = \$1 and "watched_products"\."active" = \$2\) limit \$3$/)
  expect(captured[0].params).toEqual([PRODUCT, true, 1])
  resetFakeDb()
  expect(await watchedProduct(PRODUCT, NOW)).toBeNull()
  expect(captured).toHaveLength(1)
})

test('a live listing is one that was not removed, written as a literal so the partial index matches', () => {
  expect(new PgDialect().sqlToQuery(liveListingCondition())).toMatchObject({ sql: '"watched_listings"."removed" = false', params: [] })
})

test('active products are read oldest first, for the ML cycle step', async () => {
  queueRows([[PRODUCT, 'Fone JBL', 'fone jbl', null, null, null]])
  expect(await activeProducts()).toEqual([{ id: PRODUCT, name: 'Fone JBL', query: 'fone jbl', ean: null, eanSource: null, resolvedAt: null }])
  expect(captured[0].sql).toMatch(/where "watched_products"\."active" = \$1 order by "watched_products"\."created_at" asc, "watched_products"\."id" asc$/)
})
