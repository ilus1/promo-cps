import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, test, vi } from 'vitest'
import { HOUR_MS, MARKET_CHECK_VALID_HOURS } from '@/lib/constants'
import { checkKeySql } from './check-sql'
import { needsCheckCondition } from './price-checks'

const mocks = vi.hoisted(() => ({
  dealWhere: vi.fn(),
  rows: [] as unknown[],
}))

vi.mock('./client', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => mocks.rows }) }) }),
    }),
  },
}))
vi.mock('./deals', () => ({ dealWhere: mocks.dealWhere, dealOrder: () => [] }))
vi.mock('./alerts', () => ({ listAlerts: async () => [{ id: 'a1', query: 'verificados=1&q=fone' }] }))

const NOW = new Date('2026-11-03T12:00:00Z')
const dialect = new PgDialect()

test('the check key is the product id, or item:<id> without one, with the prefix as a literal so the index matches', () => {
  const { sql, params } = dialect.sqlToQuery(checkKeySql)
  expect(sql).toBe(`coalesce("items"."product_id", 'item:' || "items"."id")`)
  expect(params).toEqual([])
})

test('a check is needed unless a matched or no_match row is within the market validity window', () => {
  const { sql, params } = dialect.sqlToQuery(needsCheckCondition(NOW))
  expect(sql.replace(/\s+/g, ' ')).toBe(
    `not exists (select 1 from "price_checks" where ("price_checks"."key" = coalesce("items"."product_id", 'item:' || "items"."id") `
    + 'and "price_checks"."status" in ($1, $2) and "price_checks"."checked_at" >= $3))',
  )
  expect(params).toEqual([
    'matched',
    'no_match',
    new Date(NOW.getTime() - MARKET_CHECK_VALID_HOURS * HOUR_MS).toISOString(),
  ])
})

test('alert candidates ignore the "Só verificados" filter, or they could never need a check', async () => {
  const { alertCandidatesToCheck } = await import('./price-checks')
  mocks.dealWhere.mockReturnValue(sql`true`)
  await alertCandidatesToCheck(NOW, NOW, 5, 15)
  expect(mocks.dealWhere).toHaveBeenCalledTimes(1)
  const [options] = mocks.dealWhere.mock.calls[0]
  expect(options).toMatchObject({ onlyVerified: false, offersOnly: true, text: 'fone' })
})

test('the plain needs-check condition has no failed branch, so alerts still retry failed rows', () => {
  expect(dialect.sqlToQuery(needsCheckCondition(NOW)).params).not.toContain('failed')
})
