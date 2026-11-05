import type { Run, Search } from '@/db/schema'
import { loginAt, runAt } from './login-display'
import type { SchedulerInputs } from './schedule'

export interface RecordedAccount {
  lastCycle: Run | undefined
  workedCycle: Run | undefined
  login: Run | undefined
  accountWorked: Run | undefined
  expired: Run | undefined
  held: Run | undefined
  searches: Search[]
}

export function schedulerInputs(recorded: RecordedAccount): SchedulerInputs {
  const { held } = recorded
  return {
    firstCycleDone: recorded.workedCycle !== undefined,
    lastCycleStartedAt: recorded.lastCycle?.startedAt ?? null,
    lastCycleFinishedAt: recorded.lastCycle?.finishedAt ?? null,
    searches: recorded.searches,
    latestLogin: loginAt(recorded.login ?? null),
    latestWorked: runAt(recorded.workedCycle ?? null),
    latestAccountWorked: runAt(recorded.accountWorked ?? null),
    latestExpired: runAt(recorded.expired ?? null),
    latestHeld: held ? { startedAt: held.startedAt, finishedAt: held.finishedAt } : null,
  }
}
