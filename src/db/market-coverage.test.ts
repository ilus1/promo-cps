import { beforeEach, expect, test, vi } from 'vitest'
import { MARKET_CHECK_VALID_HOURS, HOUR_MS, PRICE_CHECK_PRIORITY_SAVING_PERCENT, STALE_AFTER_HOURS } from '@/lib/constants'
import { STATUS_NOT_SEEN } from '@/lib/domain'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb } from './__fixtures__/fake-db'
import { marketCoverage } from './market-coverage'

const NOW = new Date('2026-11-04T12:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS).toISOString()

beforeEach(resetFakeDb)

test('coverage counts fresh Novos with the priority discount, and those with a valid high check', async () => {
  queueRows([[1200, 57]])
  expect(await marketCoverage(NOW)).toEqual({ matched: 57, total: 1200 })
  const [select] = captured
  expect(select.sql).toMatch(/^select count\(\*\)::int, \(count\(\*\) filter \(where exists \(select 1 from "price_checks" where \("price_checks"\."key" = coalesce\("items"\."product_id", 'item:' \|\| "items"\."id"\) and "price_checks"\."status" = \$\d+ and "price_checks"\."confidence" = \$\d+ and "price_checks"\."checked_at" >= \$\d+ and "price_checks"\."market_low_cents" > \$\d+\)\)\)\)::int from "items" where \("items"\."observed_at" >= \$\d+ and "items"\."status" = \$\d+ and "items"\."ml_discount_pct" >= \$\d+\)$/)
  expect(select.params).toEqual(['matched', 'high', hoursAgo(MARKET_CHECK_VALID_HOURS), 0, hoursAgo(STALE_AFTER_HOURS), STATUS_NOT_SEEN, PRICE_CHECK_PRIORITY_SAVING_PERCENT])
})

test('coverage reads zero when the query returns no row', async () => {
  expect(await marketCoverage(NOW)).toEqual({ matched: 0, total: 0 })
})
