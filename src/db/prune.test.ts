import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb, TRANSACTION_MARKER } from './__fixtures__/fake-db'
import { pruneOld } from './prune'

const NOW = new Date('2026-11-04T12:00:00Z')
const STATEMENTS_BEFORE_COUPONS = 3

beforeEach(resetFakeDb)

test('old coupons and runs are pruned in one lock-limited transaction after the items, and counted', async () => {
  queueRows(...Array.from({ length: STATEMENTS_BEFORE_COUPONS }, () => []), [['C1'], ['C2']], [['R1']])
  expect(await pruneOld(NOW)).toEqual({ items: 0, coupons: 2, runs: 1 })
  const statements = captured.map((query) => query.sql)
  const tail = statements.slice(statements.lastIndexOf(TRANSACTION_MARKER))
  expect(tail[1]).toMatch(/^set local lock_timeout = /)
  expect(tail[2]).toMatch(/^delete from "coupons" /)
  expect(tail.at(-1)).toMatch(/^delete from "runs" /)
  expect(statements.some((sql) => sql.includes('price_checks') || sql.includes('market_offers'))).toBe(false)
})
