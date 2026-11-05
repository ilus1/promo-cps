import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, test, vi } from 'vitest'
import { HOUR_MS, PRICE_CHECK_PRIORITY_SAVING_PERCENT, STALE_AFTER_HOURS } from '@/lib/constants'
import { STATUS_NOT_SEEN, STATUS_SAVED } from '@/lib/domain'
import { priorityNovosSql, targetTiers } from './target-tiers'

vi.mock('./client', () => ({ db: {} }))

const NOW = new Date('2026-11-04T12:00:00Z')
const FRESH_SINCE = new Date(NOW.getTime() - STALE_AFTER_HOURS * HOUR_MS).toISOString()
const dialect = new PgDialect()
const render = (sqlLike: Parameters<PgDialect['sqlToQuery']>[0]) => {
  const { sql, params } = dialect.sqlToQuery(sqlLike)
  return { sql, params }
}

test('the targets are fresh Salvos, then fresh Novos with the priority discount, then the other fresh Novos that show a saving', () => {
  const [saved, priority, others] = targetTiers(NOW)
  expect(render(saved.where)).toEqual({ sql: '("items"."observed_at" >= $1 and "items"."status" = $2)', params: [FRESH_SINCE, STATUS_SAVED] })
  expect(render(priority.where).params).toEqual([FRESH_SINCE, STATUS_NOT_SEEN, PRICE_CHECK_PRIORITY_SAVING_PERCENT])
  expect(render(others.where).sql).toMatch(/^\("items"\."observed_at" >= \$1 and "items"\."status" = \$2 and coalesce\("items"\."ml_discount_pct", 0\) < \$3 and /)
  expect([saved, priority, others].map((tier) => tier.order.map((order) => render(order).sql))).toEqual([
    ['"items"."observed_at" desc'], ['"items"."ml_discount_pct" desc'], ['"items"."ml_discount_pct" desc nulls last'],
  ])
})

test('the priority Novos are the second tier', () => {
  expect(render(priorityNovosSql(NOW))).toEqual({
    sql: '("items"."observed_at" >= $1 and "items"."status" = $2 and "items"."ml_discount_pct" >= $3)',
    params: [FRESH_SINCE, STATUS_NOT_SEEN, PRICE_CHECK_PRIORITY_SAVING_PERCENT],
  })
  expect(render(targetTiers(NOW)[1].where)).toEqual(render(priorityNovosSql(NOW)))
})
