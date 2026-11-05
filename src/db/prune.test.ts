import { beforeEach, expect, test, vi } from 'vitest'
import { DAY_MS, MARKET_OFFER_PRUNE_DAYS } from '@/lib/constants'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb, TRANSACTION_MARKER } from './__fixtures__/fake-db'
import { pruneOld } from './prune'

const NOW = new Date('2026-11-04T12:00:00Z')

beforeEach(resetFakeDb)

const STATEMENTS_BEFORE_OFFERS = 6

test('old market offers are pruned in the same lock-limited transaction as the other old rows, and counted', async () => {
  queueRows(...Array.from({ length: STATEMENTS_BEFORE_OFFERS }, () => []), [['kabum:1'], ['amazon:2']])
  expect(await pruneOld(NOW)).toEqual({ items: 0, coupons: 0, runs: 0, priceChecks: 0, marketOffers: 2 })
  const statements = captured.map((query) => query.sql)
  const lastTransaction = statements.lastIndexOf(TRANSACTION_MARKER)
  const tail = statements.slice(lastTransaction)
  expect(tail[1]).toMatch(/^set local lock_timeout = /)
  expect(tail.at(-2)).toMatch(/^delete from "price_checks" /)
  expect(tail.at(-1)).toBe('delete from "market_offers" where "market_offers"."last_seen_at" < $1 returning "key"')
  expect(captured.at(-1)?.params).toEqual([new Date(NOW.getTime() - MARKET_OFFER_PRUNE_DAYS * DAY_MS).toISOString()])
})
