import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, test, vi } from 'vitest'
import { CYCLE_COUNT } from '@/lib/cycle-counts'
import { BLOCKED_STATUS, isHeldRun } from '@/lib/domain'
import { heldRunCondition, notHeldByRequestHold } from './runs'

vi.mock('./client', () => ({ db: {} }))

test('the hold follows blocked runs and failed runs marked by the load breaker count', () => {
  const q = new PgDialect().sqlToQuery(heldRunCondition())
  expect(q.params).toEqual([BLOCKED_STATUS, 'failed', CYCLE_COUNT.loadBreaker])
  expect(q.sql).toContain('->>')
  expect(q.sql).toContain('= 1')
})

test('the SQL condition and isHeldRun agree on the same two cases', () => {
  const q = new PgDialect().sqlToQuery(heldRunCondition())
  const accepted = q.params.filter((p) => typeof p === 'string')
  expect(isHeldRun({ status: accepted[0] })).toBe(true)
  expect(isHeldRun({ status: accepted[1], counts: { [accepted[2]]: 1 } })).toBe(true)
  expect(isHeldRun({ status: accepted[1], counts: {} })).toBe(false)
})

test('runs stopped by a request hold are told apart by the held count', () => {
  const q = new PgDialect().sqlToQuery(notHeldByRequestHold())
  expect(q.params).toEqual([CYCLE_COUNT.held])
  expect(q.sql.replace(/\s+/g, ' ')).toBe('coalesce(("runs"."counts" ->> $1)::int, 0) <> 1')
  expect(CYCLE_COUNT.held).toBe('held')
})
