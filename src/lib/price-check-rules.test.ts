import { expect, test } from 'vitest'
import { checkKey, checkPlan, uniqueByKey, type CheckItem } from './price-check-rules'

const item = (id: string, productId: string | null = null): CheckItem => ({ id, productId, title: id, finalCents: 100, showsSaving: false })

test('the key is the product id, or item:<id> without one', () => {
  expect(checkKey({ id: 'MLB1', productId: 'MLB99' })).toBe('MLB99')
  expect(checkKey({ id: 'MLB1', productId: null })).toBe('item:MLB1')
})

test.each([
  [{ kind: 'cycle', status: 'ok' }, { alerts: true }],
  [{ kind: 'cycle', status: 'partial' }, { alerts: true }],
  [{ kind: 'search', status: 'ok' }, { alerts: true }],
  [{ kind: 'search', status: 'partial' }, { alerts: true }],
  [{ kind: 'cycle', status: 'failed' }, { alerts: false }],
  [{ kind: 'cycle', status: 'blocked' }, { alerts: false }],
  [{ kind: 'search', status: 'session_expired' }, { alerts: false }],
  [{ kind: 'login', status: 'logged_in' }, { alerts: false }],
  [{ kind: 'cycle', status: null }, { alerts: false }],
] as const)('plan for %j', (run, plan) => {
  expect(checkPlan(run)).toEqual(plan)
})

test('lists are merged in order, deduplicated by key and capped', () => {
  const merged = uniqueByKey([[item('a', 'P1'), item('b')], [item('c', 'P1'), item('d'), item('e')]], 3)
  expect(merged.map((i) => i.id)).toEqual(['a', 'b', 'd'])
})

test('a zero cap yields nothing', () => {
  expect(uniqueByKey([[item('a')]], 0)).toEqual([])
})
