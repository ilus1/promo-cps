import { describe, expect, test } from 'vitest'
import { HOUR_MS, MINUTE_MS, SCHEDULE_JITTER_MINUTES, SCHEDULER_CHECK_MS, SCHEDULER_TICK_COOLDOWN_MS } from '@/lib/constants'
import { FIRST_CYCLE_TEXT, LOGIN_REFUSED_TEXT, SESSION_EXPIRED_TEXT } from '@/lib/domain'
import {
  alignedToCycle, buscaSlackMs, cycleDueAt, dueTimesSplit, jitterOffsetMs, slotRandom, canTick, heldUntil, latestHold, earliest, heldNextRun, stopHold, nextRunAt, schedulerPause, schedulerPlan, searchDueAt, tickAction, wakeDelay,
  type SchedulerInputs,
} from './schedule'

const at = (iso: string) => new Date(iso)

test('the cycle is due its interval after the last cycle started', () => {
  expect(cycleDueAt(at('2026-10-01T09:00:00Z'), 3)).toEqual(at('2026-10-01T12:00:00Z'))
  expect(cycleDueAt(at('2026-10-01T23:30:00Z'), 1)).toEqual(at('2026-10-02T00:30:00Z'))
})

test('a never-run cycle is due immediately', () => {
  expect(cycleDueAt(null, 3)).toEqual(new Date(0))
})

test('each search is due its own interval after its last run', () => {
  expect(searchDueAt({ lastRunAt: at('2026-10-01T09:00:00Z'), runEveryHours: 1 }))
    .toEqual(at('2026-10-01T10:00:00Z'))
  expect(searchDueAt({ lastRunAt: at('2026-10-01T09:00:00Z'), runEveryHours: 3 }))
    .toEqual(at('2026-10-01T12:00:00Z'))
})

test('a never-run search is due immediately', () => {
  expect(searchDueAt({ lastRunAt: null, runEveryHours: 3 })).toEqual(new Date(0))
})

test('the scheduler wakes for whichever search is due first, even an hourly one that ran later', () => {
  expect(nextRunAt(at('2026-10-01T09:00:00Z'), 3, [
    { lastRunAt: at('2026-10-01T06:00:00Z'), runEveryHours: 3 },
    { lastRunAt: at('2026-10-01T07:30:00Z'), runEveryHours: 1 },
  ])).toEqual(at('2026-10-01T08:30:00Z'))
})

test('earliest is the first date, and null for none', () => {
  expect(earliest([at('2026-10-01T10:00:00Z'), at('2026-10-01T09:00:00Z')])).toEqual(at('2026-10-01T09:00:00Z'))
  expect(earliest([at('2026-10-01T10:00:00Z')])).toEqual(at('2026-10-01T10:00:00Z'))
  expect(earliest([])).toBeNull()
})

describe('nextRunAt', () => {
  const lastCycle = at('2026-10-01T09:00:00Z')

  test('the cycle time when there are no searches', () => {
    expect(nextRunAt(lastCycle, 3, [])).toEqual(at('2026-10-01T12:00:00Z'))
  })

  test('a search due before the cycle comes first', () => {
    expect(nextRunAt(lastCycle, 3, [
      { lastRunAt: at('2026-10-01T10:00:00Z'), runEveryHours: 1 },
      { lastRunAt: at('2026-10-01T10:00:00Z'), runEveryHours: 6 },
    ])).toEqual(at('2026-10-01T11:00:00Z'))
  })

  test('the cycle comes first when every search is due later', () => {
    expect(nextRunAt(lastCycle, 3, [{ lastRunAt: at('2026-10-01T11:00:00Z'), runEveryHours: 6 }]))
      .toEqual(at('2026-10-01T12:00:00Z'))
  })

  test('a never-run cycle is due now', () => {
    expect(nextRunAt(null, 3, [{ lastRunAt: lastCycle, runEveryHours: 1 }])).toEqual(new Date(0))
  })
})

describe('schedulerPause', () => {
  const t1 = at('2026-10-01T09:00:00Z')
  const t2 = at('2026-10-01T10:00:00Z')
  const expiredAt = (when: Date) => ({ status: 'session_expired', at: when }) as const
  const workedAt = (when: Date, status: 'ok' | 'partial' = 'ok') => ({ status, at: when }) as const
  const loginAt = (status: 'logged_in' | 'refused' | 'unconfirmed' | 'timed_out' | 'failed', when: Date) => ({ status, at: when }) as const

  test('no pause before any run', () => {
    expect(schedulerPause(null, null, null)).toBeNull()
  })

  test('a refused latest login pauses without a worked run after it', () => {
    expect(schedulerPause(loginAt('refused', t2), null, null)).toBe(LOGIN_REFUSED_TEXT)
    expect(schedulerPause(loginAt('refused', t2), workedAt(t1), null)).toBe(LOGIN_REFUSED_TEXT)
    expect(schedulerPause(loginAt('refused', t2), workedAt(t2), null)).toBe(LOGIN_REFUSED_TEXT)
  })

  test.each(['ok', 'partial'] as const)('refused then %s does not pause', (status) => {
    expect(schedulerPause(loginAt('refused', t1), workedAt(t2, status), null)).toBeNull()
  })

  test('a refused login with no worked run at all pauses', () => {
    expect(schedulerPause(loginAt('refused', t1), null, null)).toBe(LOGIN_REFUSED_TEXT)
  })

  test('refused, then ok, then a later expiry pauses with the expiry', () => {
    const t3 = at('2026-10-01T11:00:00Z')
    expect(schedulerPause(loginAt('refused', t1), workedAt(t2), expiredAt(t3))).toBe(SESSION_EXPIRED_TEXT)
  })

  test('a refused login wins over an expired session, before or after it', () => {
    expect(schedulerPause(loginAt('refused', t2), null, expiredAt(t1))).toBe(LOGIN_REFUSED_TEXT)
    expect(schedulerPause(loginAt('refused', t1), null, expiredAt(t2))).toBe(LOGIN_REFUSED_TEXT)
  })

  test('an expired session pauses without a logged_in login or worked run after it', () => {
    expect(schedulerPause(null, null, expiredAt(t2))).toBe(SESSION_EXPIRED_TEXT)
    expect(schedulerPause(loginAt('logged_in', t1), null, expiredAt(t2))).toBe(SESSION_EXPIRED_TEXT)
    expect(schedulerPause(loginAt('logged_in', t2), null, expiredAt(t2))).toBe(SESSION_EXPIRED_TEXT)
    expect(schedulerPause(null, workedAt(t1), expiredAt(t2))).toBe(SESSION_EXPIRED_TEXT)
    expect(schedulerPause(null, workedAt(t2), expiredAt(t2))).toBe(SESSION_EXPIRED_TEXT)
  })

  test('expired then failed pauses', () => {
    expect(schedulerPause(null, null, expiredAt(t1))).toBe(SESSION_EXPIRED_TEXT)
    expect(schedulerPause(null, workedAt(t1), expiredAt(t2))).toBe(SESSION_EXPIRED_TEXT)
  })

  test.each(['ok', 'partial'] as const)('expired then %s does not pause', (status) => {
    expect(schedulerPause(null, workedAt(t2, status), expiredAt(t1))).toBeNull()
  })

  test('expired, then ok, then failed does not pause', () => {
    expect(schedulerPause(null, workedAt(t2), expiredAt(t1))).toBeNull()
  })

  test('a later logged_in login lifts an expired session', () => {
    expect(schedulerPause(loginAt('logged_in', t2), null, expiredAt(t1))).toBeNull()
  })

  test.each(['timed_out', 'unconfirmed', 'failed'] as const)('a later %s login does not lift an expired session', (status) => {
    expect(schedulerPause(loginAt(status, t2), null, expiredAt(t1))).toBe(SESSION_EXPIRED_TEXT)
  })

  test('no expiry and no refusal never pauses', () => {
    expect(schedulerPause(loginAt('logged_in', t1), workedAt(t2), null)).toBeNull()
    expect(schedulerPause(loginAt('failed', t2), null, null)).toBeNull()
  })
})

describe('tickAction', () => {
  const now = at('2026-10-01T12:00:00Z')
  const fresh = { lastRunAt: at('2026-10-01T11:30:00Z'), runEveryHours: 1 }

  test('the cycle when it is due, even with Buscas due too', () => {
    expect(tickAction(now, at('2026-10-01T09:00:00Z'), 3, [{ lastRunAt: null, runEveryHours: 1 }])).toBe('cycle')
    expect(tickAction(now, null, 3, [])).toBe('cycle')
  })

  test('a Busca tick when only a Busca is due, at the boundary included', () => {
    const cycle = at('2026-10-01T11:00:00Z')
    expect(tickAction(now, cycle, 3, [fresh, { lastRunAt: at('2026-10-01T11:00:00Z'), runEveryHours: 1 }])).toBe('busca')
  })

  test('nothing when nothing is due', () => {
    expect(tickAction(now, at('2026-10-01T11:00:00Z'), 3, [fresh])).toBeNull()
    expect(tickAction(now, at('2026-10-01T11:00:00Z'), 3, [])).toBeNull()
  })

  test('the cycle is due exactly at its boundary', () => {
    expect(tickAction(now, at('2026-10-01T09:00:00Z'), 3, [])).toBe('cycle')
    expect(tickAction(now, at('2026-10-01T09:00:01Z'), 3, [])).toBeNull()
  })
})

describe('schedulerPlan', () => {
  const t1 = at('2026-10-01T09:00:00Z')
  const base: SchedulerInputs = {
    firstCycleDone: true,
    lastCycleStartedAt: t1,
    lastCycleFinishedAt: at('2026-10-01T09:20:00Z'),
    searches: [],
    latestLogin: null,
    latestWorked: { status: 'ok', at: t1 },
    latestAccountWorked: { status: 'ok', at: t1 },
    latestExpired: null,
    latestHeld: null,
  }

  test('no cycle has worked yet: paused with the first-cycle text and nothing planned', () => {
    expect(schedulerPlan({ ...base, firstCycleDone: false, lastCycleStartedAt: null, latestWorked: null }, 3))
      .toEqual({ pause: FIRST_CYCLE_TEXT, nextRunAt: null, cycleNextRunAt: null })
  })

  test('the first-cycle text wins over the other pauses', () => {
    const inputs = { ...base, firstCycleDone: false, latestLogin: { status: 'refused', at: t1 } as const }
    expect(schedulerPlan(inputs, 3).pause).toBe(FIRST_CYCLE_TEXT)
  })

  test('other pauses stop the plan once a cycle has worked', () => {
    expect(schedulerPlan({ ...base, latestExpired: { status: 'session_expired', at: at('2026-10-01T10:00:00Z') } }, 3))
      .toEqual({ pause: SESSION_EXPIRED_TEXT, nextRunAt: null, cycleNextRunAt: null })
  })

  test('an unpaused plan is the earliest due time', () => {
    expect(schedulerPlan(base, 3)).toEqual({ pause: null, nextRunAt: at('2026-10-01T12:00:00Z'), cycleNextRunAt: at('2026-10-01T12:00:00Z') })
    expect(schedulerPlan({ ...base, searches: [{ lastRunAt: t1, runEveryHours: 1 }] }, 3))
      .toEqual({ pause: null, nextRunAt: at('2026-10-01T10:00:00Z'), cycleNextRunAt: at('2026-10-01T12:00:00Z') })
  })
})

describe('heldUntil', () => {
  const due = at('2026-10-01T09:00:00Z')

  test('a due time before the hold waits for it', () => {
    expect(heldUntil(due, due.getTime() + HOUR_MS)).toEqual(new Date(due.getTime() + HOUR_MS))
    expect(heldUntil(new Date(0), due.getTime())).toEqual(due)
  })

  test('a due time at or after the hold stays', () => {
    expect(heldUntil(due, due.getTime())).toEqual(due)
    expect(heldUntil(due, due.getTime() - 1)).toEqual(due)
  })
})

describe('wakeDelay', () => {
  const now = at('2026-10-01T12:00:00Z')
  const ahead = (ms: number) => new Date(now.getTime() + ms)

  test('a due time in the past or now fires at once', () => {
    expect(wakeDelay(ahead(-HOUR_MS), now)).toBe(0)
    expect(wakeDelay(now, now)).toBe(0)
  })

  test('a near due time waits exactly that long', () => {
    expect(wakeDelay(ahead(1000), now)).toBe(1000)
  })

  test('a far due time waits one check interval, far below the setTimeout overflow', () => {
    expect(wakeDelay(ahead(100 * 24 * HOUR_MS), now)).toBe(SCHEDULER_CHECK_MS)
    expect(wakeDelay(ahead(SCHEDULER_CHECK_MS + 1), now)).toBe(SCHEDULER_CHECK_MS)
  })

  test('an invalid date waits one check interval instead of spinning', () => {
    expect(wakeDelay(new Date(NaN), now)).toBe(SCHEDULER_CHECK_MS)
  })
})

describe('heldNextRun', () => {
  const end = at('2026-10-01T12:00:00Z').getTime()
  const cooldownEnd = end + SCHEDULER_TICK_COOLDOWN_MS
  const none = 0

  test('a due time already due when the tick ended holds for the cooldown', () => {
    expect(heldNextRun([new Date(end)], end, none)).toEqual(new Date(cooldownEnd))
    expect(heldNextRun([new Date(end - HOUR_MS)], end, none)).toEqual(new Date(cooldownEnd))
  })

  test('a due time that came after the tick ended is not delayed', () => {
    const fresh = new Date(end + 60_000)
    expect(heldNextRun([fresh], end, none)).toEqual(fresh)
  })

  test('the earliest of the held old ones and the fresh ones wins', () => {
    const fresh = new Date(end + 60_000)
    expect(heldNextRun([new Date(end - HOUR_MS), fresh], end, none)).toEqual(fresh)
    const late = new Date(cooldownEnd + HOUR_MS)
    expect(heldNextRun([new Date(end), late], end, none)).toEqual(new Date(cooldownEnd))
  })

  test('without a tick or a hold the earliest due time stays as it is', () => {
    expect(heldNextRun([new Date(end + 5), new Date(end)], null, none)).toEqual(new Date(end))
    expect(heldNextRun([], end, none)).toBeNull()
  })

  test('the boot or stop hold applies to every due time', () => {
    const hold = end + HOUR_MS
    expect(heldNextRun([new Date(end - 1), new Date(end + 1)], null, hold)).toEqual(new Date(hold))
  })
})

describe('stopHold', () => {
  const blocked = { startedAt: at('2026-10-01T10:00:00Z'), finishedAt: at('2026-10-01T10:20:00Z') }
  const worked = (iso: string) => ({ status: 'ok', at: at(iso) }) as const

  test('a blocked run newer than the last worked run holds one interval after it finished', () => {
    const until = at('2026-10-01T10:20:00Z').getTime() + 3 * HOUR_MS
    expect(stopHold(blocked, null, 3)).toBe(until)
    expect(stopHold(blocked, worked('2026-10-01T09:00:00Z'), 3)).toBe(until)
  })

  test('a blocked run older than or at the last worked run holds nothing', () => {
    expect(stopHold(blocked, worked('2026-10-01T11:00:00Z'), 3)).toBeNull()
    expect(stopHold(blocked, worked('2026-10-01T10:00:00Z'), 3)).toBeNull()
  })

  test('no blocked run holds nothing', () => {
    expect(stopHold(null, null, 3)).toBeNull()
  })

  test('a blocked run that never finished counts from its start', () => {
    expect(stopHold({ startedAt: blocked.startedAt, finishedAt: null }, null, 1)).toBe(blocked.startedAt.getTime() + HOUR_MS)
  })

  test('the same DB rows give the same hold after a restart', () => {
    expect(stopHold(blocked, null, 3)).toBe(stopHold({ ...blocked }, null, 3))
  })
})

describe('latestHold', () => {
  test('the latest of the given holds, ignoring null', () => {
    expect(latestHold(5, null, 9, 7)).toBe(9)
    expect(latestHold(null, null)).toBe(0)
    expect(latestHold()).toBe(0)
  })
})

describe('canTick', () => {
  const now = at('2026-10-01T12:00:00Z')

  test('only when due, planned and the run chain is idle', () => {
    expect(canTick(now, now, true)).toBe(true)
    expect(canTick(at('2026-10-01T11:00:00Z'), now, true)).toBe(true)
    expect(canTick(at('2026-10-01T12:00:01Z'), now, true)).toBe(false)
    expect(canTick(null, now, true)).toBe(false)
    expect(canTick(now, now, false)).toBe(false)
  })
})

describe('a tick re-applies the holds on fresh inputs', () => {
  const due = at('2026-10-01T12:00:00Z')
  const blocked = { startedAt: at('2026-10-01T11:50:00Z'), finishedAt: at('2026-10-01T11:59:00Z') }

  test('a blocked row read after the plan defers the probe', () => {
    const held = heldUntil(due, latestHold(null, stopHold(blocked, null, 3)))
    expect(canTick(held, due, true)).toBe(false)
    expect(canTick(heldUntil(due, latestHold(null, stopHold(null, null, 3))), due, true)).toBe(true)
  })

  test('a tick that failed before launching still holds an overdue plan for the cooldown', () => {
    const failedAt = due.getTime()
    const held = heldNextRun([due], failedAt, latestHold())
    expect(held).toEqual(new Date(failedAt + SCHEDULER_TICK_COOLDOWN_MS))
    expect(canTick(held, new Date(failedAt + SCHEDULER_TICK_COOLDOWN_MS - 1), true)).toBe(false)
    expect(canTick(held, new Date(failedAt + SCHEDULER_TICK_COOLDOWN_MS), true)).toBe(true)
  })
})

describe('schedule jitter', () => {
  const start = at('2026-10-01T09:00:00Z')

  test('the offset spans plus or minus the jitter window', () => {
    expect(jitterOffsetMs(0)).toBe(-SCHEDULE_JITTER_MINUTES * MINUTE_MS)
    expect(jitterOffsetMs(0.5)).toBe(0)
    expect(jitterOffsetMs(1)).toBe(SCHEDULE_JITTER_MINUTES * MINUTE_MS)
    expect(jitterOffsetMs(2)).toBe(SCHEDULE_JITTER_MINUTES * MINUTE_MS)
    expect(jitterOffsetMs(-1)).toBe(-SCHEDULE_JITTER_MINUTES * MINUTE_MS)
  })

  test('the offset moves the cycle slot', () => {
    expect(cycleDueAt(start, 3, 5 * MINUTE_MS)).toEqual(at('2026-10-01T12:05:00Z'))
    expect(cycleDueAt(start, 3, -5 * MINUTE_MS)).toEqual(at('2026-10-01T11:55:00Z'))
  })

  test('never earlier than the previous finish', () => {
    const finish = at('2026-10-01T11:58:00Z')
    expect(cycleDueAt(start, 3, -15 * MINUTE_MS, finish)).toEqual(finish)
    expect(cycleDueAt(start, 3, 15 * MINUTE_MS, finish)).toEqual(at('2026-10-01T12:15:00Z'))
  })

  test('no previous cycle stays due at once', () => {
    expect(cycleDueAt(null, 3, 10 * MINUTE_MS)).toEqual(new Date(0))
  })

  test('nextRunAt, tickAction and the plan use the offset', () => {
    expect(nextRunAt(start, 3, [], 5 * MINUTE_MS)).toEqual(at('2026-10-01T12:05:00Z'))
    expect(tickAction(at('2026-10-01T12:00:00Z'), start, 3, [], 5 * MINUTE_MS)).toBeNull()
    expect(tickAction(at('2026-10-01T12:05:00Z'), start, 3, [], 5 * MINUTE_MS)).toBe('cycle')
    expect(tickAction(at('2026-10-01T11:56:00Z'), start, 3, [], -5 * MINUTE_MS)).toBe('cycle')
  })
})

describe('slotRandom', () => {
  test('is deterministic and inside [0, 1)', () => {
    for (const slot of [0, 1, 1_790_000_000_000, 1_790_000_060_000]) {
      const value = slotRandom(slot)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      expect(slotRandom(slot)).toBe(value)
    }
  })
})

describe('Buscas near the cycle', () => {
  const cycleDue = at('2026-10-01T12:00:00Z')
  const before = (ms: number) => new Date(cycleDue.getTime() - ms)

  test('the slack is half the shorter of the cycle and Busca intervals', () => {
    expect(buscaSlackMs(3, 1)).toBe(30 * MINUTE_MS)
    expect(buscaSlackMs(3, 3)).toBe(90 * MINUTE_MS)
    expect(buscaSlackMs(3, 24)).toBe(90 * MINUTE_MS)
    expect(buscaSlackMs(1, 24)).toBe(30 * MINUTE_MS)
  })

  test.each([[1], [3], [24]])('a %i h Busca due less than its slack before the cycle waits for the cycle', (hours) => {
    const slack = buscaSlackMs(3, hours)
    expect(alignedToCycle(before(slack - 1), cycleDue, slack)).toEqual(cycleDue)
    expect(alignedToCycle(before(1), cycleDue, slack)).toEqual(cycleDue)
  })

  test.each([[1], [3], [24]])('a %i h Busca due exactly the slack before, earlier, at or after the cycle keeps its time', (hours) => {
    const slack = buscaSlackMs(3, hours)
    expect(alignedToCycle(before(slack), cycleDue, slack)).toEqual(before(slack))
    expect(alignedToCycle(before(slack + HOUR_MS), cycleDue, slack)).toEqual(before(slack + HOUR_MS))
    expect(alignedToCycle(cycleDue, cycleDue, slack)).toEqual(cycleDue)
    const after = new Date(cycleDue.getTime() + MINUTE_MS)
    expect(alignedToCycle(after, cycleDue, slack)).toEqual(after)
  })

  test('a 1 h Busca still runs between cycles, a 3 h one an hour early joins the cycle', () => {
    const start = at('2026-10-01T09:00:00Z')
    const hourly = { lastRunAt: at('2026-10-01T10:30:00Z'), runEveryHours: 1 }
    const threeHourly = { lastRunAt: at('2026-10-01T08:00:00Z'), runEveryHours: 3 }
    expect(nextRunAt(start, 3, [hourly])).toEqual(at('2026-10-01T11:30:00Z'))
    expect(nextRunAt(start, 3, [threeHourly])).toEqual(cycleDue)
    expect(tickAction(at('2026-10-01T11:30:00Z'), start, 3, [hourly])).toBe('busca')
    expect(tickAction(at('2026-10-01T11:30:00Z'), start, 3, [threeHourly])).toBeNull()
  })
})

describe('Buscas never attempted', () => {
  const start = at('2026-10-01T09:00:00Z')
  const now = at('2026-10-01T09:30:00Z')
  const fresh = { lastRunAt: null, runEveryHours: 3, lastStatus: null }
  const failed = { lastRunAt: null, runEveryHours: 3, lastStatus: 'failed' }

  test('splits them from the attempted ones', () => {
    const { held, fresh: freshDues } = dueTimesSplit(start, 3, [fresh, failed])
    expect(held).toHaveLength(2)
    expect(freshDues).toEqual([new Date(0)])
  })

  test('skips the post-tick cooldown, an attempted failure still waits', () => {
    const tickEnded = now.getTime()
    const dues = dueTimesSplit(start, 3, [fresh])
    expect(heldNextRun([], tickEnded, 0, dues.fresh)).toEqual(new Date(0))
    const attempted = dueTimesSplit(start, 3, [failed])
    expect(heldNextRun([...attempted.held.slice(1)], tickEnded, 0, attempted.fresh)?.getTime())
      .toBe(tickEnded + SCHEDULER_TICK_COOLDOWN_MS)
  })

  test('still honours the boot and stop holds', () => {
    const holdUntil = now.getTime() + HOUR_MS
    expect(heldNextRun([], null, holdUntil, [new Date(0)])).toEqual(new Date(holdUntil))
  })
})
