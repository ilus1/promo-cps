import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb, TRANSACTION_MARKER } from './__fixtures__/fake-db'
import { ML_LINK_GONE } from './listing-outcome'
import { activeListing, activeProductExists, lastWatchAlert, mlLinksGone, monitoringCounts, productNames, removedRefs, requestCheck } from './monitoring'

const ID = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const AT = new Date('2026-11-06T12:00:00Z')

beforeEach(resetFakeDb)

test('a check clears the resolve time of an active product and makes its non-ML listings due', async () => {
  queueRows([[ID]])
  expect(await requestCheck(ID)).toBe(true)
  const [begin, product, listings, gone] = captured
  expect(begin.sql).toBe(TRANSACTION_MARKER)
  expect(product.sql).toBe('update "watched_products" set "resolved_at" = $1 where ("watched_products"."id" = $2 and "watched_products"."active" = $3) returning "id"')
  expect(product.params).toEqual([null, ID, true])
  expect(listings.sql).toBe('update "watched_listings" set "checked_at" = $1 '
    + 'where ("watched_listings"."product_id" = $2 and "watched_listings"."removed" = false and "watched_listings"."retailer" <> $3)')
  expect(listings.params).toEqual([null, ID, 'ml'])
  expect(gone.sql).toBe('update "watched_listings" set "last_error" = $1 '
    + 'where ("watched_listings"."product_id" = $2 and "watched_listings"."removed" = false and "watched_listings"."last_error" = $3)')
  expect(gone.params).toEqual([null, ID, ML_LINK_GONE])
})

test('a check of an unknown or inactive product touches no listing', async () => {
  queueRows([])
  expect(await requestCheck(ID)).toBe(false)
  expect(captured).toHaveLength(2)
})

test('a malformed id is refused without a query', async () => {
  expect(await requestCheck('nope')).toBe(false)
  expect(captured).toHaveLength(0)
})

test('the counts read active products and live listings per store', async () => {
  queueRows([[2]], [['kabum', 3, true, AT.toISOString(), AT.toISOString()]])
  expect(await monitoringCounts()).toEqual({
    products: 2,
    retailers: { kabum: { listings: 3, unchecked: true, oldestCheckAt: AT, lastCheckAt: AT } },
  })
  const [products, listings] = captured
  expect(products.sql).toBe('select count(*)::int from "watched_products" where "watched_products"."active" = $1')
  expect(listings.sql).toBe('select "watched_listings"."retailer", count(*)::int, bool_or("watched_listings"."checked_at" is null), '
    + 'min("watched_listings"."checked_at"), max("watched_listings"."checked_at") from "watched_listings" '
    + 'inner join "watched_products" on "watched_products"."id" = "watched_listings"."product_id" '
    + 'where ("watched_listings"."removed" = false and "watched_products"."active" = $1) group by "watched_listings"."retailer"')
})

test('the last alert is the newest one with its product name', async () => {
  queueRows([['Fone JBL', 'target', 29_990, AT.toISOString()]])
  expect(await lastWatchAlert()).toEqual({ productName: 'Fone JBL', kind: 'target', priceCents: 29_990, sentAt: AT })
  expect(captured[0].sql).toBe('select "watched_products"."name", "watch_alerts"."kind", "watch_alerts"."price_cents", "watch_alerts"."sent_at" '
    + 'from "watch_alerts" inner join "watched_products" on "watched_products"."id" = "watch_alerts"."product_id" '
    + 'order by "watch_alerts"."sent_at" desc, "watch_alerts"."id" desc limit $1')
})

test('no alert yet gives null', async () => {
  queueRows([])
  expect(await lastWatchAlert()).toBeNull()
})

test('a listing counts as active only while it is live and its product is watched', async () => {
  queueRows([[ID]], [])
  expect(await activeListing(ID)).toBe(true)
  expect(await activeListing(ID)).toBe(false)
  expect(captured[0].sql).toBe('select "watched_listings"."id" from "watched_listings" '
    + 'inner join "watched_products" on "watched_products"."id" = "watched_listings"."product_id" '
    + 'where ("watched_listings"."id" = $1 and "watched_listings"."removed" = false and "watched_products"."active" = $2) limit $3')
  expect(await activeListing('nope')).toBe(false)
  expect(captured).toHaveLength(2)
})

test('product names are read in one query, and none are asked for without ids', async () => {
  queueRows([[ID, 'Fone JBL']])
  expect(await productNames([ID])).toEqual(new Map([[ID, 'Fone JBL']]))
  expect(captured[0].sql).toBe('select "id", "name" from "watched_products" where "watched_products"."id" in ($1)')
  expect(await productNames([])).toEqual(new Map())
  expect(captured).toHaveLength(1)
})

test('a product exists for the routes only while it is watched, read without its listings', async () => {
  queueRows([[ID]], [])
  expect(await activeProductExists(ID)).toBe(true)
  expect(await activeProductExists(ID)).toBe(false)
  expect(captured[0].sql).toBe('select "id" from "watched_products" where ("watched_products"."id" = $1 and "watched_products"."active" = $2) limit $3')
  expect(await activeProductExists('nope')).toBe(false)
  expect(captured).toHaveLength(2)
})

test('removed refs are the refs every row of which is removed, grouped per product, in one query', async () => {
  queueRows([[ID, 'americanas', '1:2'], [ID, 'buscape', 'fone/jbl'], ['other', 'kabum', '9']])
  const removed = await removedRefs([ID, 'other'])
  expect(removed.get(ID)).toEqual(new Set(['americanas:1:2', 'buscape:fone/jbl']))
  expect(removed.get('other')).toEqual(new Set(['kabum:9']))
  expect(captured[0].sql).toBe('select "product_id", "retailer", "ref" from "watched_listings" where "watched_listings"."product_id" in ($1, $2) '
    + 'group by "watched_listings"."product_id", "watched_listings"."retailer", "watched_listings"."ref" having bool_and("watched_listings"."removed")')
  expect(await removedRefs([])).toEqual(new Map())
  expect(captured).toHaveLength(1)
})

test('dead ML links are the products whose ML link listing was removed or given up, in one query', async () => {
  queueRows([[ID]])
  expect(await mlLinksGone([ID, 'other'])).toEqual(new Set([ID]))
  expect(captured[0].sql).toBe('select distinct "product_id" from "watched_listings" where ("watched_listings"."product_id" in ($1, $2) '
    + 'and "watched_listings"."retailer" = $3 and "watched_listings"."match" = $4 '
    + 'and ("watched_listings"."removed" = $5 or "watched_listings"."last_error" = $6))')
  expect(captured[0].params).toEqual([ID, 'other', 'ml', 'link', true, ML_LINK_GONE])
  expect(await mlLinksGone([])).toEqual(new Set())
  expect(captured).toHaveLength(1)
})
