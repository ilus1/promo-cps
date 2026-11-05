import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, test, vi } from 'vitest'
import { HOUR_MS, STALE_AFTER_HOURS } from '@/lib/constants'
import { STATUS_NOT_SEEN, STATUS_SAVED } from '@/lib/domain'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb } from './__fixtures__/fake-db'
import { checkItemsByIds, firstPerKey, keyItems, rematchTargetCondition, targetItemIds } from './match-targets'

const NOW = new Date('2026-11-04T12:00:00Z')
const FRESH_SINCE = new Date(NOW.getTime() - STALE_AFTER_HOURS * HOUR_MS).toISOString()
const MOST_RECENT_FIRST = 'order by "items"."observed_at" desc, "items"."id" asc'

beforeEach(resetFakeDb)

test('the targets are every Salvo plus the fresh Novos', () => {
  const { sql, params } = new PgDialect().sqlToQuery(rematchTargetCondition(NOW))
  expect(sql).toBe('("items"."status" = $1 or ("items"."status" = $2 and "items"."observed_at" >= $3))')
  expect(params).toEqual([STATUS_SAVED, STATUS_NOT_SEEN, FRESH_SINCE])
})

test('the first row of each check key wins', () => {
  const rows = [{ id: 'a', productId: 'MLB1' }, { id: 'b', productId: 'MLB1' }, { id: 'c', productId: null }, { id: 'd', productId: 'MLB2' }]
  expect(firstPerKey(rows).map((row) => row.id)).toEqual(['a', 'c', 'd'])
})

test('one target item per check key, the most recently observed one', async () => {
  queueRows([['a', 'MLB1'], ['b', 'MLB1'], ['c', null]])
  expect(await targetItemIds(NOW)).toEqual(['a', 'c'])
  expect(captured[0].sql).toBe(`select "id", "product_id" from "items" where ("items"."status" = $1 or ("items"."status" = $2 and "items"."observed_at" >= $3)) ${MOST_RECENT_FIRST}`)
})

test('items are read by id with their check columns, and an empty list sends nothing', async () => {
  expect(await checkItemsByIds([], NOW)).toEqual([])
  expect(captured).toEqual([])
  queueRows([['a', 'MLB1', 'Fone', 9900, true]])
  expect(await checkItemsByIds(['a'], NOW)).toEqual([{ id: 'a', productId: 'MLB1', title: 'Fone', finalCents: 9900, showsSaving: true }])
  expect(captured[0].sql).toMatch(/from "items" where "items"\."id" in \(\$\d+\)$/)
})

test('the items of given keys are found by product id or by item id, one per key, the most recent first', async () => {
  expect(await keyItems([], NOW)).toEqual([])
  expect(captured).toEqual([])
  queueRows([['a', 'MLB1', 'Fone A', 100, true], ['b', 'MLB1', 'Fone B', 90, true], ['c', null, 'Capa', 50, false]])
  expect((await keyItems(['MLB1', 'item:c'], NOW)).map((item) => item.id)).toEqual(['a', 'c'])
  const [select] = captured
  expect(select.sql).toMatch(new RegExp(`where \\("items"\\."product_id" in \\(\\$\\d+\\) or \\("items"\\."product_id" is null and "items"\\."id" in \\(\\$\\d+\\)\\)\\) ${MOST_RECENT_FIRST}$`))
  expect(select.params.slice(-2)).toEqual(['MLB1', 'c'])
})
