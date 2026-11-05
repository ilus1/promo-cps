import type { Search } from '@/db/schema'
import {
  HALF_DIVISOR, HOUR_MS, MINUTE_MS, SCHEDULE_JITTER_MINUTES, SCHEDULER_CHECK_MS, SCHEDULER_TICK_COOLDOWN_MS,
} from '@/lib/constants'
import {
  FIRST_CYCLE_TEXT, LOGIN_REFUSED_TEXT, SESSION_EXPIRED_TEXT, type LoginState, type RunStatus,
} from '@/lib/domain'

type Schedulable = Pick<Search, 'lastRunAt' | 'runEveryHours'> & Partial<Pick<Search, 'lastStatus'>>

export interface StatusAt<S> { status: S | null; at: Date }

function dueAfter(lastAt: Date | null, everyHours: number): Date {
  return lastAt ? new Date(lastAt.getTime() + everyHours * HOUR_MS) : new Date(0)
}

const HASH_MULTIPLIER = 0x45d9f3b
const HASH_SHIFT = 16
const HASH_RANGE = 0x100000000

export function slotRandom(slotMs: number): number {
  let h = Math.trunc(slotMs / MINUTE_MS) | 0
  for (let i = 0; i < 2; i++) h = Math.imul((h >>> HASH_SHIFT) ^ h, HASH_MULTIPLIER)
  return (((h >>> HASH_SHIFT) ^ h) >>> 0) / HASH_RANGE
}

export function jitterOffsetMs(random: number): number {
  const unit = Math.min(1, Math.max(0, random)) * 2 - 1
  return Math.round(unit * SCHEDULE_JITTER_MINUTES * MINUTE_MS)
}

export function cycleDueAt(
  lastCycleStartedAt: Date | null, everyHours: number, jitterMs = 0, notBefore: Date | null = null,
): Date {
  const due = dueAfter(lastCycleStartedAt, everyHours)
  if (lastCycleStartedAt === null) return due
  const jittered = due.getTime() + jitterMs
  return new Date(notBefore ? Math.max(jittered, notBefore.getTime()) : jittered)
}

export function searchDueAt(s: Schedulable): Date {
  return dueAfter(s.lastRunAt, s.runEveryHours)
}

export function buscaSlackMs(cycleEveryHours: number, buscaEveryHours: number): number {
  return Math.min(cycleEveryHours, buscaEveryHours) * HOUR_MS / HALF_DIVISOR
}

export function alignedToCycle(searchDue: Date, cycleDue: Date, slackMs: number): Date {
  const early = cycleDue.getTime() - searchDue.getTime()
  return early > 0 && early < slackMs ? cycleDue : searchDue
}

export function neverAttempted(s: Schedulable): boolean {
  return s.lastStatus === null
}

export function dueTimes(
  lastCycleStartedAt: Date | null, everyHours: number, searches: Schedulable[], jitterMs = 0, notBefore: Date | null = null,
): Date[] {
  const cycleDue = cycleDueAt(lastCycleStartedAt, everyHours, jitterMs, notBefore)
  return [cycleDue, ...searches.map((s) => alignedToCycle(searchDueAt(s), cycleDue, buscaSlackMs(everyHours, s.runEveryHours)))]
}

export function dueTimesSplit(
  lastCycleStartedAt: Date | null, everyHours: number, searches: Schedulable[], jitterMs = 0, notBefore: Date | null = null,
): { held: Date[]; fresh: Date[] } {
  const cycleDue = cycleDueAt(lastCycleStartedAt, everyHours, jitterMs, notBefore)
  const dueOf = (s: Schedulable) => alignedToCycle(searchDueAt(s), cycleDue, buscaSlackMs(everyHours, s.runEveryHours))
  return {
    held: [cycleDue, ...searches.filter((s) => !neverAttempted(s)).map(dueOf)],
    fresh: searches.filter(neverAttempted).map(dueOf),
  }
}

export function earliest(dues: readonly Date[]): Date | null {
  if (dues.length === 0) return null
  return new Date(Math.min(...dues.map((due) => due.getTime())))
}

export function nextRunAt(
  lastCycleStartedAt: Date | null,
  everyHours: number,
  searches: Schedulable[],
  jitterMs = 0,
  notBefore: Date | null = null,
): Date {
  return earliest(dueTimes(lastCycleStartedAt, everyHours, searches, jitterMs, notBefore))
    ?? cycleDueAt(lastCycleStartedAt, everyHours, jitterMs, notBefore)
}

function after(run: StatusAt<RunStatus> | null, since: Date): boolean {
  return run !== null && run.at.getTime() > since.getTime()
}

export function schedulerPause(
  latestLogin: StatusAt<LoginState> | null,
  latestWorked: StatusAt<RunStatus> | null,
  latestExpired: StatusAt<RunStatus> | null,
): string | null {
  if (latestLogin?.status === 'refused' && !after(latestWorked, latestLogin.at)) return LOGIN_REFUSED_TEXT
  if (latestExpired === null) return null
  const loggedInSince = latestLogin?.status === 'logged_in'
    && latestLogin.at.getTime() > latestExpired.at.getTime()
  return loggedInSince || after(latestWorked, latestExpired.at) ? null : SESSION_EXPIRED_TEXT
}

export interface HeldRun { startedAt: Date; finishedAt: Date | null }

export type TickAction = 'cycle' | 'busca'

export function tickAction(
  now: Date,
  lastCycleStartedAt: Date | null,
  everyHours: number,
  searches: Schedulable[],
  jitterMs = 0,
  notBefore: Date | null = null,
): TickAction | null {
  const cycleDue = cycleDueAt(lastCycleStartedAt, everyHours, jitterMs, notBefore)
  if (cycleDue.getTime() <= now.getTime()) return 'cycle'
  return searches.some((s) => alignedToCycle(searchDueAt(s), cycleDue, buscaSlackMs(everyHours, s.runEveryHours)).getTime() <= now.getTime()) ? 'busca' : null
}

export interface SchedulerInputs {
  firstCycleDone: boolean
  lastCycleStartedAt: Date | null
  lastCycleFinishedAt: Date | null
  searches: Schedulable[]
  latestLogin: StatusAt<LoginState> | null
  latestWorked: StatusAt<RunStatus> | null
  latestAccountWorked: StatusAt<RunStatus> | null
  latestExpired: StatusAt<RunStatus> | null
  latestHeld: HeldRun | null
}

export interface SchedulerPlan {
  pause: string | null
  nextRunAt: Date | null
  cycleNextRunAt: Date | null
}

export function schedulerPlan(inputs: SchedulerInputs, everyHours: number, jitterMs = 0): SchedulerPlan {
  const pause = inputs.firstCycleDone
    ? schedulerPause(inputs.latestLogin, inputs.latestWorked, inputs.latestExpired)
    : FIRST_CYCLE_TEXT
  if (pause !== null) return { pause, nextRunAt: null, cycleNextRunAt: null }
  return {
    pause,
    nextRunAt: nextRunAt(inputs.lastCycleStartedAt, everyHours, inputs.searches, jitterMs, inputs.lastCycleFinishedAt),
    cycleNextRunAt: cycleDueAt(inputs.lastCycleStartedAt, everyHours, jitterMs, inputs.lastCycleFinishedAt),
  }
}

export function heldUntil(due: Date, holdUntilMs: number): Date {
  return due.getTime() >= holdUntilMs ? due : new Date(holdUntilMs)
}

export function wakeDelay(nextRunAt: Date, now: Date): number {
  const wait = nextRunAt.getTime() - now.getTime()
  if (Number.isNaN(wait)) return SCHEDULER_CHECK_MS
  return Math.min(Math.max(wait, 0), SCHEDULER_CHECK_MS)
}

export function heldNextRun(
  dues: readonly Date[], tickEndedAtMs: number | null, holdUntilMs: number, freshDues: readonly Date[] = [],
): Date | null {
  const held = dues.map((due) => {
    const overdue = tickEndedAtMs !== null && due.getTime() <= tickEndedAtMs
    return heldUntil(due, overdue ? Math.max(holdUntilMs, tickEndedAtMs + SCHEDULER_TICK_COOLDOWN_MS) : holdUntilMs)
  })
  return earliest([...held, ...freshDues.map((due) => heldUntil(due, holdUntilMs))])
}

export function stopHold(
  latestHeld: HeldRun | null,
  latestWorked: StatusAt<RunStatus> | null,
  everyHours: number,
): number | null {
  if (latestHeld === null) return null
  if (latestWorked !== null && latestWorked.at.getTime() >= latestHeld.startedAt.getTime()) return null
  return (latestHeld.finishedAt ?? latestHeld.startedAt).getTime() + everyHours * HOUR_MS
}

export function latestHold(...holds: (number | null)[]): number {
  return Math.max(0, ...holds.filter((hold): hold is number => hold !== null))
}

export function canTick(nextRunAt: Date | null, now: Date, chainIdle: boolean): boolean {
  return chainIdle && nextRunAt !== null && nextRunAt.getTime() <= now.getTime()
}
