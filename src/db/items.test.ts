import { expect, test, vi } from 'vitest'
import type { ObservedCard } from '@/ingestion/ml/observed-card'
import { PgDialect } from 'drizzle-orm/pg-core'
import { REALERT_MIN_DROP_CENTS } from '@/lib/constants'
import { STATUS_NOT_SEEN, STATUS_SEEN } from '@/lib/domain'
import { BASIS_POINTS, REALERT_KEEP_BASIS_POINTS } from '@/lib/price-drop'
import { itemRow, reopenSeenOnDrop, seenWhere, statusChange } from './items'

vi.mock('./client', () => ({ db: {} }))

const card: ObservedCard = {
  id: 'MLB1', productId: null, title: 'Cafe\u0301 Ac\u0327ai', thumbnail: null, url: null, isPad: false, priceCents: 1000,
  basisText: null, basis: 'none', listPriceCents: null, mlDiscountPct: null, soldQuantity: null, full: null,
  freeShipping: null, categoryId: null, domainId: null, sellerLabel: 'Loja Ac\u0327ai', couponHint: null,
}

test('the stored title and seller are composed (NFC), so accent-class search matches them', () => {
  const row = itemRow(card, new Date())
  expect(row.title).toBe('Caf\u00e9 A\u00e7ai')
  expect(row.sellerLabel).toBe('Loja A\u00e7ai')
})

test('a missing seller stays missing', () => {
  expect(itemRow({ ...card, sellerLabel: null }, new Date()).sellerLabel).toBeNull()
})

const render = (query: ReturnType<typeof seenWhere>) => new PgDialect().sqlToQuery(query)

test('saving or marking seen stores the current price, going back to Novos clears it', () => {
  expect(statusChange('NOT_SEEN').seenPriceCents).toBeNull()
  expect(statusChange('SEEN').seenPriceCents).not.toBeNull()
  expect(statusChange('SAVED').seenPriceCents).not.toBeNull()
})

test('the cycle only reopens a Visto with a stored price and a meaningful drop', () => {
  const q = new PgDialect().sqlToQuery(reopenSeenOnDrop())
  expect(q.sql).toContain('"items"."seen_price_cents" is not null')
  expect(q.sql).toContain('excluded."price_cents"::bigint')
  expect(q.sql).toContain('else "items"."status" end')
  expect(q.params).toEqual([STATUS_SEEN, BASIS_POINTS, REALERT_KEEP_BASIS_POINTS, REALERT_MIN_DROP_CENTS, STATUS_NOT_SEEN])
})

const AS_OF = new Date('2026-11-03T12:00:00Z')
const FILTERS = { onlyDrops: false, full: false, freeShipping: false, offersOnly: false, includeStale: false, showInflated: false, onlyVerified: false, sort: 'desconto' as const, text: 'fone' }

test('a bulk mark by ids only names those ids and nothing read after the render', () => {
  const q = render(seenWhere({ ids: ['MLB1', 'MLB2'], asOf: AS_OF }, new Date()))
  expect(q.sql).toContain('"items"."id" in')
  expect(q.sql).toContain('"items"."observed_at" <=')
  expect(q.params).toEqual(['MLB1', 'MLB2', AS_OF.toISOString()])
})

test('a bulk mark by filters is the Novos deal query, bounded by the render time', () => {
  const q = render(seenWhere({ filters: FILTERS, asOf: AS_OF }, new Date()))
  expect(q.sql).toContain('"items"."status" = $1')
  expect(q.params[0]).toBe(STATUS_NOT_SEEN)
  expect(q.sql).toContain('"items"."observed_at" <=')
  expect(q.params).toContain(AS_OF.toISOString())
})
