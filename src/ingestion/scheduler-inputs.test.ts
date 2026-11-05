import { describe, expect, test } from 'vitest'
import type { Run } from '@/db/schema'
import { LOGIN_REFUSED_TEXT, SESSION_EXPIRED_TEXT, type RunKind, type RunRowStatus } from '@/lib/domain'
import { schedulerPlan, stopHold } from './schedule'
import { schedulerInputs, type RecordedAccount } from './scheduler-inputs'

const EVERY_HOURS = 3
const at = (time: string) => new Date(`2026-11-02T${time}:00Z`)
const run = (kind: RunKind, status: RunRowStatus, time: string): Run => (
  { id: `${kind}-${time}`, kind, status, startedAt: at(time), finishedAt: at(time), pages: 0, counts: {}, error: null }
)

const OLD_CYCLE = run('cycle', 'ok', '08:00')
const base: RecordedAccount = {
  lastCycle: OLD_CYCLE,
  workedCycle: OLD_CYCLE,
  login: undefined,
  accountWorked: OLD_CYCLE,
  expired: undefined,
  held: undefined,
  searches: [],
}

const pauseOf = (recorded: RecordedAccount) => schedulerPlan(schedulerInputs(recorded), EVERY_HOURS).pause

describe('only a cycle proves the session works', () => {
  const expired = run('cycle', 'session_expired', '10:00')

  test('expired, then a Busca ok: still paused', () => {
    const buscaOk = run('search', 'ok', '11:00')
    expect(pauseOf({ ...base, lastCycle: expired, expired, accountWorked: buscaOk })).toBe(SESSION_EXPIRED_TEXT)
  })

  test('expired, then a cycle ok: lifted', () => {
    const cycleOk = run('cycle', 'ok', '11:00')
    expect(pauseOf({ ...base, lastCycle: cycleOk, workedCycle: cycleOk, expired, accountWorked: cycleOk })).toBeNull()
  })

  test('refused, then a Busca ok: still refused', () => {
    const refused = run('login', 'refused', '10:00')
    expect(pauseOf({ ...base, login: refused, accountWorked: run('search', 'ok', '11:00') })).toBe(LOGIN_REFUSED_TEXT)
  })

  test('no cycle has worked yet: the first-cycle pause holds even if a Busca worked', () => {
    const inputs = schedulerInputs({ ...base, workedCycle: undefined, accountWorked: run('search', 'ok', '11:00') })
    expect(inputs.firstCycleDone).toBe(false)
  })
})

describe('a Busca that loaded is fair evidence only for lifting a block', () => {
  const blocked = run('cycle', 'blocked', '10:00')

  test('blocked, then a Busca ok: no hold', () => {
    const inputs = schedulerInputs({ ...base, lastCycle: blocked, held: blocked, accountWorked: run('search', 'ok', '11:00') })
    expect(stopHold(inputs.latestHeld, inputs.latestAccountWorked, EVERY_HOURS)).toBeNull()
  })

  test('blocked with nothing worked after it: held for a full interval', () => {
    const inputs = schedulerInputs({ ...base, lastCycle: blocked, held: blocked })
    expect(stopHold(inputs.latestHeld, inputs.latestAccountWorked, EVERY_HOURS)).not.toBeNull()
  })

  test('nothing recorded: no cycle, login, worked, expired or blocked input', () => {
    expect(schedulerInputs({
      lastCycle: undefined, workedCycle: undefined, login: undefined, accountWorked: undefined,
      expired: undefined, held: undefined, searches: [],
    })).toMatchObject({
      firstCycleDone: false, lastCycleStartedAt: null, lastCycleFinishedAt: null, latestLogin: null, latestWorked: null,
      latestAccountWorked: null, latestExpired: null, latestHeld: null,
    })
  })
})
