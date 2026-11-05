import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  AMAZON_OFFER_VALID_DAYS, DAY_MS, KABUM_OFFER_VALID_DAYS, MARKET_CANDIDATE_LIMIT, MARKET_OFFER_PRUNE_DAYS, MATCH_PRICE_CEILING_FACTOR,
  MATCH_PRICE_FLOOR_DIVISOR,
} from '@/lib/constants'
import { offerTokens, retrieves } from '@/lib/market/tokens'
import type { MarketOffer, RetrievalTerms } from '@/lib/market/types'
import { priceBand } from '@/lib/price-compare/match'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb } from './__fixtures__/fake-db'
import {
  anyTermHitsSql, candidateCondition, candidateOffers, effectivePriceSql, OFFER_UPSERT_CHUNK, offerKey, offerRow, pruneOffers, upsertOffers, validOfferCounts,
} from './market-offers'

const NOW = new Date('2026-11-04T12:00:00Z')
const FINAL_CENTS = 200000
const TERMS: RetrievalTerms = { all: ['samsung', 'galaxy'], any: ['a55', 'a35'] }
const NO_TERMS: RetrievalTerms = { all: [], any: [] }
const EFFECTIVE_PRICE = (n: number) => `(case when "market_offers"."price_until" is not null and "market_offers"."price_until" <= $${n} `
  + 'then coalesce("market_offers"."regular_price_cents", "market_offers"."price_cents") else "market_offers"."price_cents" end)'
const flat = (text: string) => text.replace(/\s+/g, ' ')
const daysBefore = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString()
const KABUM_SINCE = daysBefore(KABUM_OFFER_VALID_DAYS)
const AMAZON_SINCE = daysBefore(AMAZON_OFFER_VALID_DAYS)
const validSql = (first: number) => `("market_offers"."in_stock" = $${first} `
  + `and (("market_offers"."retailer" = $${first + 1} and "market_offers"."last_seen_at" >= $${first + 2}) `
  + `or ("market_offers"."retailer" = $${first + 3} and "market_offers"."last_seen_at" >= $${first + 4})))`

const offer = (over: Partial<MarketOffer> = {}): MarketOffer => ({
  retailer: 'kabum',
  listingId: '512345',
  title: 'Smartphone Samsung Galaxy A55 5G 256GB',
  brand: 'Samsung',
  seller: 'KaBuM!',
  priceCents: 180000,
  listPriceCents: 220000,
  regularPriceCents: null,
  priceUntil: null,
  inStock: true,
  url: 'https://www.kabum.com.br/produto/512345/smartphone-samsung-galaxy-a55',
  source: 'kabum_catalog',
  ...over,
})

beforeEach(resetFakeDb)

test('the offer key is the retailer and its listing id', () => {
  expect(offerKey(offer())).toBe('kabum:512345')
  expect(offerKey(offer({ retailer: 'amazon', listingId: 'B0CX1' }))).toBe('amazon:B0CX1')
})

test('a row carries the title tokens, the campaign price fields, and is first and last seen now', () => {
  const until = new Date('2026-11-06T03:00:00Z')
  expect(offerRow(offer({ regularPriceCents: 199900, priceUntil: until }), NOW)).toMatchObject({ regularPriceCents: 199900, priceUntil: until })
  const row = offerRow(offer(), NOW)
  expect(row).toMatchObject({ key: 'kabum:512345', retailer: 'kabum', listingId: '512345', priceCents: 180000, source: 'kabum_catalog' })
  expect(row.tokens).toEqual(offerTokens(offer().title))
  expect(row.firstSeenAt).toEqual(NOW)
  expect(row.lastSeenAt).toEqual(NOW)
})

test('an upsert writes one row per key, the last one wins, and the conflict keeps the first sighting and the source', async () => {
  const written = await upsertOffers([offer({ priceCents: 100 }), offer({ listingId: '9' }), offer({ priceCents: 200 })], NOW)
  expect(written).toBe(2)
  expect(captured).toHaveLength(1)
  const [insert] = captured
  expect(insert.sql).toContain('on conflict ("key") do update set "title" = excluded."title", "brand" = excluded."brand", '
    + '"seller" = excluded."seller", "price_cents" = excluded."price_cents", "list_price_cents" = excluded."list_price_cents", '
    + '"regular_price_cents" = excluded."regular_price_cents", "price_until" = excluded."price_until", "in_stock" = excluded."in_stock", "url" = excluded."url", "tokens" = excluded."tokens", "last_seen_at" = excluded."last_seen_at"')
  expect(insert.sql).not.toContain('"first_seen_at" = excluded')
  expect(insert.sql).not.toContain('"source" = excluded')
  expect(insert.params).toContain(200)
  expect(insert.params).not.toContain(100)
  expect(insert.params.filter((param) => param === 'kabum:512345')).toHaveLength(1)
})

test('a large upsert is split into chunks', async () => {
  const offers = Array.from({ length: OFFER_UPSERT_CHUNK * 2 + 1 }, (_, index) => offer({ listingId: String(index) }))
  expect(await upsertOffers(offers, NOW)).toBe(offers.length)
  expect(captured).toHaveLength(3)
  expect(captured.map((query) => query.params.filter((param) => typeof param === 'string' && param.startsWith('kabum:')).length))
    .toEqual([OFFER_UPSERT_CHUNK, OFFER_UPSERT_CHUNK, 1])
})

test('an empty upsert sends nothing', async () => {
  expect(await upsertOffers([], NOW)).toBe(0)
  expect(captured).toEqual([])
})

test('the effective price is the campaign price until its end, then the regular price, and the end itself counts as ended', () => {
  const { sql, params } = new PgDialect().sqlToQuery(effectivePriceSql(NOW))
  expect(flat(sql)).toBe(EFFECTIVE_PRICE(1))
  expect(params).toEqual([NOW.toISOString()])
})

const RETRIEVAL_SQL = '("market_offers"."tokens" @> $1::text[] and (cardinality($2::text[]) = 0 or "market_offers"."tokens" && $3::text[]) and '
const pgTextArray = (literal: string): string[] => (literal === '{}' ? [] : literal.slice(2, -2).split('","'))

test('the SQL retrieval condition agrees with retrieves over a grid of terms and tokens', () => {
  const allLists = [[], ['galaxy'], ['samsung', 'galaxy']]
  const anyLists = [[], ['a55'], ['a35', 'a55']]
  const tokenSets = [[], ['galaxy'], ['samsung', 'galaxy'], ['samsung', 'galaxy', 'a35'], ['galaxy', 'a55'], ['a55']]
  for (const all of allLists) {
    for (const any of anyLists) {
      const { sql, params } = new PgDialect().sqlToQuery(candidateCondition({ all, any }, FINAL_CENTS, NOW))
      expect(flat(sql).startsWith(RETRIEVAL_SQL)).toBe(true)
      const [contained, counted, overlapped] = (params.slice(0, 3) as string[]).map(pgTextArray)
      for (const tokens of tokenSets) {
        const held = new Set(tokens)
        const sqlSays = contained.every((term) => held.has(term)) && (counted.length === 0 || overlapped.some((term) => held.has(term)))
        expect(sqlSays, JSON.stringify({ all, any, tokens })).toBe(retrieves({ all, any }, held))
      }
    }
  }
})

test('a candidate holds every all-term and one any-term, has its effective price in the band, and is valid', () => {
  const { minCents, maxCents } = priceBand(FINAL_CENTS)
  const { sql, params } = new PgDialect().sqlToQuery(candidateCondition(TERMS, FINAL_CENTS, NOW))
  expect(flat(sql)).toBe('("market_offers"."tokens" @> $1::text[] '
    + 'and (cardinality($2::text[]) = 0 or "market_offers"."tokens" && $3::text[]) '
    + `and ${EFFECTIVE_PRICE(4)} between $5 and $6 and ${validSql(7)})`)
  expect(params).toEqual([
    '{"samsung","galaxy"}', '{"a55","a35"}', '{"a55","a35"}', NOW.toISOString(), minCents, maxCents, true, 'kabum', KABUM_SINCE, 'amazon', AMAZON_SINCE,
  ])
})

test('an empty any-list is an empty array, which the cardinality test lets through', () => {
  const { params } = new PgDialect().sqlToQuery(candidateCondition({ all: ['galaxy'], any: [] }, FINAL_CENTS, NOW))
  expect(params.slice(0, 3)).toEqual(['{"galaxy"}', '{}', '{}'])
})

test('the SQL band keeps exactly the prices the matcher keeps', () => {
  for (const finalCents of [1, 4, 5, 6, 999, 1000, 1001, 199999, FINAL_CENTS]) {
    const [, , , , low, high] = new PgDialect().sqlToQuery(candidateCondition(TERMS, finalCents, NOW)).params as [string, string, string, string, number, number]
    for (const price of [0, 1, low - 1, low, low + 1, high - 1, high, high + 1]) {
      const matcherKeeps = price * MATCH_PRICE_FLOOR_DIVISOR >= finalCents && price <= finalCents * MATCH_PRICE_CEILING_FACTOR
      expect(price >= low && price <= high, `${price} for ${finalCents}`).toBe(matcherKeeps)
    }
  }
})

test('candidates are priced at their effective price and come cheapest first by it, capped at the candidate limit', async () => {
  queueRows([['kabum', 'Samsung Galaxy A55 5G 256GB', 'Samsung', 'KaBuM!', 180000, 'https://k']])
  const rows = await candidateOffers(TERMS, FINAL_CENTS, NOW)
  expect(rows).toEqual([{ retailer: 'kabum', title: 'Samsung Galaxy A55 5G 256GB', brand: 'Samsung', seller: 'KaBuM!', priceCents: 180000, url: 'https://k' }])
  const [select] = captured
  expect(select.sql.startsWith('select "retailer", "title", "brand", "seller", (case when "price_until" is not null and "market_offers"."price_until" <= $1 '
    + 'then coalesce("regular_price_cents", "price_cents") else "price_cents" end), "url" from "market_offers" where (')).toBe(true)
  expect(select.sql).toMatch(/order by cardinality\(.*\) desc, \(case when "market_offers"\."price_until" is not null and "market_offers"\."price_until" <= \$\d+ then .* end\) asc, "market_offers"\."key" asc limit \$\d+$/)
  expect(select.params.at(-1)).toBe(MARKET_CANDIDATE_LIMIT)
})

test('the any-term hits count how many any-terms an offer holds', () => {
  const { sql, params } = new PgDialect().sqlToQuery(anyTermHitsSql(['b550m', 'am4', 'ddr4']))
  expect(sql).toBe('cardinality(array(select unnest("market_offers"."tokens") intersect select unnest($1::text[])))')
  expect(params).toEqual(['{"b550m","am4","ddr4"}'])
})

test('with no all-terms, offers holding more any-terms come first, then the cheapest, then by key', async () => {
  await candidateOffers({ all: [], any: ['b550m', 'am4', 'ddr4'] }, FINAL_CENTS, NOW)
  const [select] = captured
  const order = select.sql.slice(select.sql.indexOf(' order by '))
  expect(order).toMatch(/^ order by cardinality\(array\(select unnest\("market_offers"\."tokens"\) intersect select unnest\(\$(\d+)::text\[\]\)\)\) desc, \(case when /)
  const anyParam = Number(/unnest\(\$(\d+)::text\[\]\)/.exec(order)?.[1])
  expect(select.params[anyParam - 1]).toBe('{"b550m","am4","ddr4"}')
  expect(order).toMatch(/ end\) asc, "market_offers"\."key" asc limit \$\d+$/)
})

test('with no any-terms, offers come cheapest first then by key, with no hit count to compute', async () => {
  await candidateOffers({ all: ['samsung', 'galaxy'], any: [] }, FINAL_CENTS, NOW)
  const [select] = captured
  const order = select.sql.slice(select.sql.indexOf(' order by '))
  expect(order).toMatch(/^ order by \(case when "market_offers"\."price_until" is not null and "market_offers"\."price_until" <= \$\d+ then .* end\) asc, "market_offers"\."key" asc limit \$\d+$/)
  expect(order).not.toContain('cardinality(')
  expect(order).not.toContain('intersect')
})

test('no terms means no candidates and no query', async () => {
  expect(await candidateOffers(NO_TERMS, FINAL_CENTS, NOW)).toEqual([])
  expect(captured).toEqual([])
})

test('valid offers are counted per retailer, with zero for a retailer that has none', async () => {
  queueRows([['amazon', 7]])
  expect(await validOfferCounts(NOW)).toEqual({ kabum: 0, amazon: 7 })
  const [select] = captured
  expect(select.sql).toBe(`select "retailer", count(*)::int from "market_offers" where ${validSql(1)} group by "market_offers"."retailer"`)
  expect(select.params).toEqual([true, 'kabum', KABUM_SINCE, 'amazon', AMAZON_SINCE])
})

test('pruning deletes offers unseen for the prune window and returns how many went', async () => {
  queueRows([['kabum:1'], ['amazon:2']])
  expect(await pruneOffers(NOW)).toBe(2)
  const [deletion] = captured
  expect(deletion.sql).toBe('delete from "market_offers" where "market_offers"."last_seen_at" < $1 returning "key"')
  expect(deletion.params).toEqual([daysBefore(MARKET_OFFER_PRUNE_DAYS)])
})
