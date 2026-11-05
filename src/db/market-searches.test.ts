import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, test, vi } from 'vitest'
import { AMAZON_SEARCH_VALID_DAYS, AMAZON_UNKNOWN_RETRY_HOURS, DAY_MS, HOUR_MS, PRICE_CHECK_PRIORITY_SAVING_PERCENT } from '@/lib/constants'
import { STATUS_NOT_SEEN, STATUS_SAVED } from '@/lib/domain'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb } from './__fixtures__/fake-db'
import { dueSearches, prioritizeSearch, recordSearch, searchCounts, searchDueCondition } from './market-searches'

const NOW = new Date('2026-11-04T12:00:00Z')
const SEARCHED_SINCE = new Date(NOW.getTime() - AMAZON_SEARCH_VALID_DAYS * DAY_MS).toISOString()
const UNKNOWN_SINCE = new Date(NOW.getTime() - AMAZON_UNKNOWN_RETRY_HOURS * HOUR_MS).toISOString()
const FRESH_SINCE = (n: number) => `(case when "market_searches"."status" = $${n} then $${n + 1}::timestamptz else $${n + 2}::timestamptz end)`
const NOT_FRESHLY_SEARCHED = /not exists \(select 1 from "market_searches" where \("market_searches"\."key" = coalesce\("items"\."product_id", 'item:' \|\| "items"\."id"\) and "market_searches"\."searched_at" >= \(case when "market_searches"\."status" = \$\d+ then \$\d+::timestamptz else \$\d+::timestamptz end\)\)\)/
const flat = (text: string) => text.replace(/\s+/g, ' ')

beforeEach(resetFakeDb)

test('a key is due when it was never searched or its last search is older than the window for its status', () => {
  const { sql, params } = new PgDialect().sqlToQuery(searchDueCondition(NOW))
  expect(flat(sql)).toBe(`("market_searches"."searched_at" is null or "market_searches"."searched_at" < ${FRESH_SINCE(1)})`)
  expect(params).toEqual(['unknown', UNKNOWN_SINCE, SEARCHED_SINCE])
})

test('an unreadable search is due again after a day, while results and empty pages wait the full revisit', () => {
  const [unknown, unknownSince, searchedSince] = new PgDialect().sqlToQuery(searchDueCondition(NOW)).params as [string, string, string]
  const sqlSays = (status: string | null, at: Date | null) =>
    at === null || at.toISOString() < (status === unknown ? unknownSince : searchedSince)
  const ago = (ms: number) => new Date(NOW.getTime() - ms)
  const retry = AMAZON_UNKNOWN_RETRY_HOURS * HOUR_MS
  const revisit = AMAZON_SEARCH_VALID_DAYS * DAY_MS
  for (const status of ['results', 'empty', 'unknown', null]) {
    for (const age of [HOUR_MS, retry - 1, retry, retry + 1, revisit - 1, revisit, revisit + 1]) {
      const expected = status === 'unknown' ? age > retry : age > revisit
      expect(sqlSays(status, ago(age)), `${status} ${age}`).toBe(expected)
    }
    expect(sqlSays(status, null)).toBe(true)
  }
})

test('with nothing queued, the three worker tiers are read in order, grouped by check key and without freshly searched keys', async () => {
  expect(await dueSearches(NOW, 5)).toEqual([])
  expect(captured).toHaveLength(4)
  const [queued, saved, priority, others] = captured
  expect(queued.sql).toContain('from "market_searches" where ("market_searches"."priority_at" is not null and')
  expect(queued.sql).toContain('order by "market_searches"."priority_at" asc, "market_searches"."key" asc')
  expect(saved.sql).toContain('row_number() over (order by "items"."observed_at" desc, "items"."id" asc)')
  expect(saved.params).toContain(STATUS_SAVED)
  expect(priority.sql).toContain('row_number() over (order by "items"."ml_discount_pct" desc, "items"."id" asc)')
  expect(priority.sql).toContain('"items"."ml_discount_pct" >= $')
  expect(priority.params).toEqual(expect.arrayContaining([STATUS_NOT_SEEN, PRICE_CHECK_PRIORITY_SAVING_PERCENT]))
  expect(others.sql).toContain('row_number() over (order by "items"."ml_discount_pct" desc nulls last, "items"."id" asc)')
  expect(others.sql).toContain('coalesce("items"."ml_discount_pct", 0) < $')
  for (const tier of [saved, priority, others]) {
    expect(tier.sql).toMatch(NOT_FRESHLY_SEARCHED)
    expect(tier.sql).toContain('"items"."observed_at" >= $')
    expect(tier.sql).toContain('(array_agg("title" order by "ranked"."observed_at" desc, "ranked"."id"))[1]')
    expect(tier.sql).toMatch(/group by "key" order by min\("rank"\) limit \$\d+$/)
    expect(tier.params).toEqual(expect.arrayContaining(['unknown', UNKNOWN_SINCE, SEARCHED_SINCE]))
  }
})

test('queued keys come first with their own query, then tier keys with the query of their latest title, skipping repeats and empty queries', async () => {
  queueRows(
    [['MLB1', 'samsung galaxy a55']],
    [['MLB1', 'Samsung Galaxy A55'], ['item:x', 'Kit Para Com'], ['MLB2', 'Fone JBL Tune 520BT']],
    [['MLB3', 'Apple iPhone 15 128gb'], ['MLB4', 'Galaxy Tab A9 128gb']],
  )
  expect(await dueSearches(NOW, 3)).toEqual([
    { key: 'MLB1', query: 'samsung galaxy a55' },
    { key: 'MLB2', query: 'fone jbl tune 520bt' },
    { key: 'MLB3', query: 'apple iphone 15 128gb' },
  ])
  expect(captured).toHaveLength(3)
  expect(captured[1].params.at(-1)).toBe(3)
  expect(captured[2].params.at(-1)).toBe(3)
})

test('a tier query selects only the key and the latest title', async () => {
  await dueSearches(NOW, 1)
  expect(captured[1].sql).toMatch(/^select "key", \(array_agg\("title" order by "ranked"\."observed_at" desc, "ranked"\."id"\)\)\[1\] from \(/)
})

test('a search is recorded with its status and count and leaves the priority queue', async () => {
  await recordSearch('MLB1', 'samsung galaxy a55', 'results', 42, NOW)
  const [insert] = captured
  expect(insert.sql).toBe('insert into "market_searches" ("key", "query", "searched_at", "status", "result_count", "priority_at") '
    + 'values ($1, $2, $3, $4, $5, $6) on conflict ("key") do update set "query" = $7, "searched_at" = $8, "status" = $9, '
    + '"result_count" = $10, "priority_at" = $11')
  expect(insert.params).toEqual(['MLB1', 'samsung galaxy a55', NOW.toISOString(), 'results', 42, null, 'samsung galaxy a55', NOW.toISOString(), 'results', 42, null])
})

test('a priority is one statement: the upsert in a CTE, then whether it queued and the search time from before it', async () => {
  queueRows([{ queued: true, searched_at: null }])
  await prioritizeSearch('MLB1', 'samsung galaxy a55', NOW)
  const [statement] = captured
  expect(statement.sql).toBe('with "queued" as (insert into "market_searches" ("key", "query", "searched_at", "status", "result_count", "priority_at") '
    + 'values ($1, $2, default, default, default, $3) on conflict ("key") do update set "query" = $4, '
    + '"priority_at" = coalesce("market_searches"."priority_at", excluded."priority_at") '
    + `where ("market_searches"."searched_at" is null or "market_searches"."searched_at" < ${FRESH_SINCE(5)}) returning "key") `
    + 'select exists (select 1 from "queued") as "queued", '
    + '(select "market_searches"."searched_at" from "market_searches" where "market_searches"."key" = $8) as "searched_at"')
  expect(statement.params).toEqual([
    'MLB1', 'samsung galaxy a55', NOW.toISOString(), 'samsung galaxy a55', 'unknown', UNKNOWN_SINCE, SEARCHED_SINCE, 'MLB1',
  ])
})

test.each([
  ['a never searched key queues with no search time', { queued: true, searched_at: null }, { queued: true, searchedAt: null }],
  ['a stale key queues and reports its last search', { queued: true, searched_at: '2026-10-20 10:00:00+00' }, { queued: true, searchedAt: new Date('2026-10-20T10:00:00Z') }],
  ['a freshly searched key does not queue and reports when it was searched', { queued: false, searched_at: '2026-11-01 10:00:00+00' }, { queued: false, searchedAt: new Date('2026-11-01T10:00:00Z') }],
  ['no row back reads as not queued and never searched', undefined, { queued: false, searchedAt: null }],
])('%s', async (_, row, expected) => {
  queueRows(row ? [row] : [])
  expect(await prioritizeSearch('MLB1', 'samsung galaxy a55', NOW)).toEqual(expected)
})

test('the counts cover target keys and queued keys once each, split by whether a fresh search exists', async () => {
  queueRows([[4, 9]])
  expect(await searchCounts(NOW)).toEqual({ searched: 4, due: 9 })
  const [select] = captured
  expect(select.sql).toMatch(/^select \(count\(\*\) filter \(where exists \(select 1 from "market_searches" where \("market_searches"\."key" = "due_keys"\."key" and/)
  expect(select.sql).toContain('(count(*) filter (where not exists (select 1 from "market_searches" where ("market_searches"."key" = "due_keys"."key" and')
  expect(select.sql).toContain(`from (select coalesce("items"."product_id", 'item:' || "items"."id") as "key" from "items" where ((`)
  expect(select.sql).toMatch(/ union select "market_searches"\."key" from "market_searches" where \("market_searches"\."priority_at" is not null and \("market_searches"\."searched_at" is null or "market_searches"\."searched_at" < \(case when .* end\)\)\)\) "due_keys"$/)
})

test('the counts read zero when the query returns no row', async () => {
  expect(await searchCounts(NOW)).toEqual({ searched: 0, due: 0 })
})
