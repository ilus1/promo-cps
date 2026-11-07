import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, test, vi } from 'vitest'
import { HOUR_MS } from '@/lib/constants'
import type { ListingQuote } from '@/lib/watch/types'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb, TRANSACTION_MARKER } from './__fixtures__/fake-db'
import { merchantKeyOf } from '@/lib/watch/merchant-key'
import { quotesPrice } from '@/lib/watch/listing-state'
import {
  dueForRefreshCondition, listingsDueForRefresh, merchantKey, merchantName, merchantOf, pagesDueForRefresh, recordListingError,
  recordListingGone, recordPageError, recordPageQuotes, recordQuote, removeListing, upsertListing, WATCH_REFRESH_HOURS, type ListingPage, type NewListing,
} from './watch-listings'

const NOW = new Date('2026-11-06T12:00:00Z')
const PRODUCT = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const LISTING = '1b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f12'
const OTHER = '2b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f13'
const NUL = '\u0000'
const ACCENTED_MAGAZINE = 'Magaz\u00edne'
const statements = () => captured.map((query) => query.sql).filter((text) => text !== TRANSACTION_MARKER)
const UNAVAILABLE_FROM = (param: number) => `"unavailable_since" = coalesce("watched_listings"."unavailable_since", $${param})`
const pageRows = (first: number) => `"watched_listings"."product_id" = $${first} and "watched_listings"."retailer" = $${first + 1} `
  + `and "watched_listings"."ref" = $${first + 2} and "watched_listings"."removed" = false`

const amazon: NewListing = { retailer: 'amazon', ref: 'B0CX1', url: 'https://www.amazon.com.br/dp/B0CX1', title: 'Fone JBL', merchant: null, match: 'auto' }
const quote = (over: Partial<ListingQuote> = {}): ListingQuote => ({
  ref: 'B0CX1', merchant: null, title: null, priceCents: 19900, listPriceCents: 29900, finalCents: 19900, inStock: true, ...over,
})
const SPELL_START = new Date(NOW.getTime() - 2 * WATCH_REFRESH_HOURS * HOUR_MS).toISOString()
const UNAVAILABLE_READ = 'select "unavailable_since", "in_stock" from "watched_listings" where "watched_listings"."id" = $1 for update'
const ENDED_UPDATE = 'update "listing_price_segments" set "ended_at" = $1 where "listing_price_segments"."id" = $2'
const page: ListingPage = { retailer: 'buscape', ref: 'fone-jbl', url: 'https://www.buscape.com.br/x', title: 'Fone JBL', match: 'auto' }
const GONE_SET = `update "watched_listings" set "in_stock" = $1, "checked_at" = $2, ${UNAVAILABLE_FROM(3)}, "last_error" = $4`
const goneUpdate = () => captured.find((query) => query.sql.startsWith(GONE_SET))

beforeEach(resetFakeDb)

test('a single-store listing has the empty merchant, a merchant name is cleaned and trimmed, and its key folds case, accents and punctuation', () => {
  expect(merchantKey(null)).toBe('')
  expect(merchantName(null)).toBe('')
  expect(merchantName(` KaBuM!${NUL} `)).toBe('KaBuM!')
  expect(merchantKey(` KaBuM!${NUL} `)).toBe('kabum')
  expect(merchantKey(`${ACCENTED_MAGAZINE} LUIZA`)).toBe(merchantKey('magazine luiza'))
  expect(merchantKey(`${ACCENTED_MAGAZINE} LUIZA`)).toBe(merchantKeyOf(`${ACCENTED_MAGAZINE} LUIZA`))
  expect(merchantOf('')).toBeNull()
  expect(merchantOf('Magazine Luiza')).toBe('Magazine Luiza')
})

test('a new listing for a store is inserted, with its texts cleaned', async () => {
  queueRows([], [[LISTING]])
  expect(await upsertListing(PRODUCT, { ...amazon, title: `Fone${NUL} JBL` }, NOW)).toEqual({ id: LISTING, status: 'inserted' })
  const [lookup, insert] = statements()
  expect(lookup).toBe('select "id", "ref", "removed" from "watched_listings" where ("watched_listings"."product_id" = $1 '
    + 'and "watched_listings"."retailer" = $2 and "watched_listings"."merchant_key" = $3) for update')
  expect(insert).toMatch(/^insert into "watched_listings" .* on conflict do nothing returning "id"$/)
  expect(captured.find((query) => query.sql === insert)?.params).toEqual([PRODUCT, 'amazon', '', '', 'B0CX1', amazon.url, 'Fone JBL', 'auto', NOW.toISOString()])
})

test('a merchant is looked up by its key and stored with its display name next to it', async () => {
  queueRows([], [[LISTING]])
  await upsertListing(PRODUCT, { ...amazon, retailer: 'buscape', merchant: ` ${ACCENTED_MAGAZINE} Luiza ` }, NOW)
  expect(captured[1].params.at(-1)).toBe('magazineluiza')
  expect(captured[2].params.slice(2, 4)).toEqual([`${ACCENTED_MAGAZINE} Luiza`, 'magazineluiza'])
})

test('the same live listing found again only refreshes its link and title', async () => {
  queueRows([[LISTING, 'B0CX1', false]])
  expect(await upsertListing(PRODUCT, amazon, NOW)).toEqual({ id: LISTING, status: 'updated' })
  expect(statements()[1]).toBe('update "watched_listings" set "merchant" = $1, "url" = $2, "title" = $3 where "watched_listings"."id" = $4')
  expect(statements()).toHaveLength(2)
})

test('a removed listing stays removed and untouched when it is found again', async () => {
  queueRows([[LISTING, 'B0CX1', true]])
  expect(await upsertListing(PRODUCT, amazon, NOW)).toEqual({ id: LISTING, status: 'removed' })
  expect(statements()).toHaveLength(1)
})

test('another live listing for the same store is kept, and the new one is not added', async () => {
  queueRows([[OTHER, 'B0OTHER', false], [LISTING, 'B0OLD', true]])
  expect(await upsertListing(PRODUCT, amazon, NOW)).toEqual({ id: OTHER, status: 'kept' })
  expect(statements()).toHaveLength(1)
})

test('a removed listing of another ref leaves the store open for a new one', async () => {
  queueRows([[OTHER, 'B0WRONG', true]], [[LISTING]])
  expect(await upsertListing(PRODUCT, amazon, NOW)).toEqual({ id: LISTING, status: 'inserted' })
})

test('an insert lost to a concurrent writer reads back the row that won', async () => {
  queueRows([], [], [[OTHER, 'B0CX1', false]])
  expect(await upsertListing(PRODUCT, amazon, NOW)).toEqual({ id: OTHER, status: 'updated' })
})

test('removing a listing marks it removed, and an id that is not a uuid sends nothing', async () => {
  queueRows([[LISTING]])
  expect(await removeListing(LISTING)).toBe(true)
  expect(statements()).toEqual(['update "watched_listings" set "removed" = $1 where "watched_listings"."id" = $2 returning "id"'])
  resetFakeDb()
  expect(await removeListing('nope')).toBe(false)
  expect(captured).toEqual([])
})

test('a listing is due when it is live, its product is active and it was never checked or checked over 3 h ago', () => {
  const { sql, params } = new PgDialect().sqlToQuery(dueForRefreshCondition('kabum', NOW))
  expect(sql).toBe('("watched_listings"."retailer" = $1 and "watched_listings"."removed" = false and "watched_products"."active" = $2 '
    + 'and ("watched_listings"."checked_at" is null or "watched_listings"."checked_at" < $3))')
  expect(params).toEqual(['kabum', true, new Date(NOW.getTime() - WATCH_REFRESH_HOURS * HOUR_MS).toISOString()])
})

test('due listings come never-checked first, then oldest, capped, with the merchant shown as null when there is none', async () => {
  queueRows([[LISTING, PRODUCT, 'buscape', 'fone-jbl', 'KaBuM!', 'u1', 't'], [OTHER, PRODUCT, 'buscape', 'fone-jbl', '', 'u2', 't']])
  expect((await listingsDueForRefresh('buscape', NOW, 10)).map((row) => row.merchant)).toEqual(['KaBuM!', null])
  const [select] = captured
  expect(select.sql).toContain('inner join "watched_products" on "watched_products"."id" = "watched_listings"."product_id"')
  expect(select.sql).toMatch(/order by "watched_listings"\."checked_at" asc nulls first, "watched_listings"\."id" asc limit \$\d+$/)
  expect(select.params.at(-1)).toBe(10)
})

test('a quote writes the prices, clears the error and the unavailable time, and opens a segment when there is none', async () => {
  queueRows([], [], [])
  await recordQuote(LISTING, quote({ title: `Fone${NUL} JBL` }), NOW)
  const [read, update, open, insert] = statements()
  expect(read).toBe(UNAVAILABLE_READ)
  expect(update).toBe('update "watched_listings" set "title" = $1, "price_cents" = $2, "list_price_cents" = $3, "final_cents" = $4, '
    + '"in_stock" = $5, "checked_at" = $6, "unavailable_since" = $7, "last_error" = $8 where "watched_listings"."id" = $9')
  expect(captured[2].params).toEqual(['Fone JBL', 19900, 29900, 19900, true, NOW.toISOString(), null, null, LISTING])
  expect(open).toMatch(/from "listing_price_segments" where "listing_price_segments"\."listing_id" = \$1 order by .* limit \$2$/)
  expect(insert).toMatch(/^insert into "listing_price_segments" /)
})

test('an unchanged price extends the open segment, and a changed final price with no spell between opens a new one without ending the old', async () => {
  queueRows([], [], [[7, 19900, 19900]])
  await recordQuote(LISTING, quote(), NOW)
  expect(statements()[3]).toBe('update "listing_price_segments" set "last_seen_at" = $1 where "listing_price_segments"."id" = $2')
  resetFakeDb()
  queueRows([], [], [[7, 19900, 19900]])
  await recordQuote(LISTING, quote({ finalCents: 17910 }), NOW)
  expect(statements()[3]).toMatch(/^insert into "listing_price_segments" /)
  expect(statements()).not.toContain(ENDED_UPDATE)
  expect(captured.at(-1)?.params).toEqual([LISTING, 19900, 17910, NOW.toISOString(), NOW.toISOString()])
})

test('a listing back in stock at the same price after a spell clears its unavailable time and only extends its open segment', async () => {
  queueRows([[SPELL_START, false]], [], [[7, 19900, 19900]])
  await recordQuote(LISTING, quote(), NOW)
  expect(captured[2].params).toEqual([19900, 29900, 19900, true, NOW.toISOString(), null, null, LISTING])
  expect(statements()[3]).toBe('update "listing_price_segments" set "last_seen_at" = $1 where "listing_price_segments"."id" = $2')
  expect(statements()).toHaveLength(4)
})

test('a quote at a different price after an out-of-stock spell ends the old segment where the spell began and opens a new one', async () => {
  queueRows([[SPELL_START, false]], [], [[7, 19900, 19900]])
  await recordQuote(LISTING, quote({ priceCents: 17900, finalCents: 17900 }), NOW)
  const [read, update, open, ended, insert] = statements()
  expect(read).toBe(UNAVAILABLE_READ)
  expect(update).toContain('"unavailable_since" = $6, "last_error" = $7')
  expect(captured[2].params.slice(5, 7)).toEqual([null, null])
  expect(open).toMatch(/^select .* from "listing_price_segments" /)
  expect(ended).toBe(ENDED_UPDATE)
  expect(captured[4].params).toEqual([SPELL_START, 7])
  expect(insert).toMatch(/^insert into "listing_price_segments" /)
  expect(captured.at(-1)?.params).toEqual([LISTING, 17900, 17900, NOW.toISOString(), NOW.toISOString()])
})

test('a quote at a different price after an error spell clears the error and opens a new segment without ending the old one', async () => {
  queueRows([[SPELL_START, true]], [], [[7, 19900, 19900]])
  await recordQuote(LISTING, quote({ priceCents: 17900, finalCents: 17900 }), NOW)
  const [read, update, open, insert] = statements()
  expect(read).toBe(UNAVAILABLE_READ)
  expect(update).toContain('"unavailable_since" = $6, "last_error" = $7')
  expect(captured[2].params.slice(5, 7)).toEqual([null, null])
  expect(open).toMatch(/^select .* from "listing_price_segments" /)
  expect(insert).toMatch(/^insert into "listing_price_segments" /)
  expect(statements()).not.toContain(ENDED_UPDATE)
})

test('an out-of-stock quote reads nothing, writes no segment, keeps the first unavailable time, and a quote without a title keeps the stored one', async () => {
  await recordQuote(LISTING, quote({ inStock: false }), NOW)
  expect(statements()).toHaveLength(1)
  expect(statements()[0]).not.toContain('"title"')
  expect(statements()[0]).toContain(UNAVAILABLE_FROM(6))
  expect(captured[1].params[5]).toBe(NOW.toISOString())
})

test('one Buscape page updates each live merchant row and leaves a removed merchant alone', async () => {
  queueRows(
    [[LISTING, 'fone-jbl', false]], [], [], [], [], [],
    [[OTHER, 'fone-jbl', true]],
  )
  const outcomes = await recordPageQuotes(PRODUCT, page, [
    quote({ ref: 'fone-jbl', merchant: 'KaBuM!' }),
    quote({ ref: 'fone-jbl', merchant: 'Magazine Luiza', priceCents: 18000, finalCents: 18000 }),
  ], NOW)
  expect(outcomes).toEqual([{ id: LISTING, status: 'updated' }, { id: OTHER, status: 'removed' }])
  const priced = captured.filter((query) => query.sql.startsWith('update "watched_listings" set "price_cents"'))
  expect(priced.map((query) => query.params.at(-1))).toEqual([LISTING])
  expect(captured.filter((query) => query.sql === TRANSACTION_MARKER)).toHaveLength(1)
})

test('a merchant that left the page is marked out of stock and checked now, with no segment, so it is neither the best nor due', async () => {
  queueRows([[LISTING, 'fone-jbl', false]])
  await recordPageQuotes(PRODUCT, page, [quote({ ref: 'fone-jbl', merchant: 'KaBuM!' })], NOW)
  expect(goneUpdate()).toEqual({
    sql: `${GONE_SET} where ((${pageRows(5)}) and "watched_listings"."merchant_key" not in ($8))`,
    params: [false, NOW.toISOString(), NOW.toISOString(), null, PRODUCT, 'buscape', 'fone-jbl', 'kabum'],
  })
  expect(statements().filter((text) => text.startsWith('insert into "listing_price_segments"'))).toHaveLength(1)
  expect(quotesPrice({ inStock: false, finalCents: 18000, lastError: null })).toBe(false)
  const dueBefore = new PgDialect().sqlToQuery(dueForRefreshCondition('buscape', NOW)).params.at(-1)
  expect(new Date(String(goneUpdate()?.params[1])).getTime()).toBeGreaterThan(new Date(String(dueBefore)).getTime())
})

test('a page with no quotes marks every live merchant of it out of stock', async () => {
  expect(await recordPageQuotes(PRODUCT, page, [], NOW)).toEqual([])
  expect(statements()).toHaveLength(1)
  expect(goneUpdate()?.sql).toBe(`${GONE_SET} where ((${pageRows(5)}) and true)`)
})

test('a failed page stamps the error and the check on every live merchant row of that product and ref', async () => {
  await recordPageError(PRODUCT, 'buscape', `fone-jbl${NUL}`, `HTTP 503${NUL}`, NOW)
  expect(captured[0]).toEqual({
    sql: `update "watched_listings" set "checked_at" = $1, ${UNAVAILABLE_FROM(2)}, "last_error" = $3 where (${pageRows(4)})`,
    params: [NOW.toISOString(), NOW.toISOString(), 'HTTP 503', PRODUCT, 'buscape', 'fone-jbl'],
  })
})

test('an error is cleaned and stamps the check time', async () => {
  await recordListingError(LISTING, `HTTP 503${NUL}`, NOW)
  expect(captured[0]).toEqual({
    sql: `update "watched_listings" set "checked_at" = $1, ${UNAVAILABLE_FROM(2)}, "last_error" = $3 where "watched_listings"."id" = $4`,
    params: [NOW.toISOString(), NOW.toISOString(), 'HTTP 503', LISTING],
  })
})

test('a given-up listing goes out of stock with its error, keeping the start of its failure run', async () => {
  await recordListingGone(LISTING, 'O anúncio do link não existe mais', NOW)
  expect(captured[0]).toEqual({
    sql: `update "watched_listings" set "in_stock" = $1, "checked_at" = $2, ${UNAVAILABLE_FROM(3)}, "last_error" = $4 where "watched_listings"."id" = $5`,
    params: [false, NOW.toISOString(), NOW.toISOString(), 'O anúncio do link não existe mais', LISTING],
  })
})

test('once its error is cleared, a given-up listing still quotes no price until a fresh read', () => {
  expect(quotesPrice({ inStock: false, finalCents: 18000, lastError: null })).toBe(false)
})

test('due pages group the due merchant rows of one product and ref, oldest check first', async () => {
  queueRows([[PRODUCT, 'fones/fone-jbl', 'https://www.buscape.com.br/fones/fone-jbl', 'Fone JBL', 'auto'], [PRODUCT, 'x/y', null, null, null]])
  expect(await pagesDueForRefresh('buscape', NOW, 5)).toEqual([
    { productId: PRODUCT, retailer: 'buscape', ref: 'fones/fone-jbl', url: 'https://www.buscape.com.br/fones/fone-jbl', title: 'Fone JBL', match: 'auto' },
  ])
  const [select] = captured
  expect(select.sql).toMatch(/group by "watched_listings"\."product_id", "watched_listings"\."ref" order by min\(coalesce\("watched_listings"\."checked_at", '-infinity'::timestamptz\)\), /)
  expect(select.sql).toContain('"watched_listings"."removed" = false and "watched_products"."active" = $2')
  expect(select.params).toEqual(['buscape', true, new Date(NOW.getTime() - WATCH_REFRESH_HOURS * HOUR_MS).toISOString(), 5])
})
