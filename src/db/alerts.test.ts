import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, test, vi } from 'vitest'
import { REALERT_MIN_DROP_CENTS } from '@/lib/constants'
import { BASIS_POINTS, REALERT_KEEP_BASIS_POINTS } from '@/lib/price-drop'
import { announceableOffers, reannounceCondition } from './alerts'

vi.mock('./client', () => ({ db: {} }))

const rendered = new PgDialect().sqlToQuery(reannounceCondition())

test('the re-announce condition is the shared drop rule on the new price against the last hit', () => {
  expect(rendered.sql).toBe(
    '(excluded."price_cents"::bigint * $1::int <= "alert_hits"."price_cents"::bigint * $2::int\n'
    + '    and excluded."price_cents" <= "alert_hits"."price_cents" - $3::int)',
  )
  expect(rendered.params).toEqual([BASIS_POINTS, REALERT_KEEP_BASIS_POINTS, REALERT_MIN_DROP_CENTS])
})

test('a sibling item is announced only below the product lowest earlier hit, in one uncorrelated join', () => {
  const NOW = new Date('2026-11-03T12:00:00Z')
  const q = new PgDialect().sqlToQuery(announceableOffers('alert-1', NOW))
  expect(q.sql).toContain('coalesce("items"."product_id", "items"."id")')
  expect(q.sql).toContain('min("alert_hits"."price_cents")')
  expect(q.sql).toContain('left join prior on prior.key =')
  expect(q.sql).toContain('prior.lo is null or')
  expect(q.sql).toContain('prior.lo - $')
  expect(q.sql).toContain('"items"."observed_at" >=')
  expect(q.sql).toContain('distinct on')
  expect(q.params).toContain('alert-1')
})
