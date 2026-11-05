import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, test, vi } from 'vitest'
import { CYCLE_COUNT } from '@/lib/cycle-counts'

const captured = vi.hoisted(() => ({ wheres: [] as unknown[] }))

vi.mock('./client', () => {
  const chain = {
    from: () => chain,
    where: (condition: unknown) => {
      captured.wheres.push(condition)
      return chain
    },
    orderBy: () => chain,
    limit: async () => [],
  }
  return { db: { select: () => chain } }
})

import { lastRun, lastStatusRun, lastWorkedAccountRun, lastWorkedCycleRun, previousStatus } from './runs'

const dialect = new PgDialect()
const heldParam = CYCLE_COUNT.held

beforeEach(() => {
  captured.wheres.length = 0
})

function rendered(): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(captured.wheres[0] as never)
}

test.each([
  ['lastRun', () => lastRun('cycle')],
  ['lastStatusRun', () => lastStatusRun('cycle')],
  ['lastWorkedAccountRun', () => lastWorkedAccountRun()],
  ['lastWorkedCycleRun', () => lastWorkedCycleRun()],
  ['previousStatus', () => previousStatus('cycle', new Date('2026-11-03T12:00:00Z'))],
])('%s skips runs stopped by a request hold', async (_name, call) => {
  await call()
  const { sql, params } = rendered()
  expect(params).toContain(heldParam)
  expect(sql).toContain('->>')
  expect(sql).toContain('<> 1')
})
