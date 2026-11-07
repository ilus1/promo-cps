import type { Run } from '@/db/schema'
import { loginAt, runAt } from './login-display'
import type { SchedulerInputs } from './schedule'

export interface RecordedAccount {
  lastCycle: Run | undefined
  workedCycle: Run | undefined
  login: Run | undefined
  accountWorked: Run | undefined
  expired: Run | undefined
  held: Run | undefined
}

export function schedulerInputs(recorded: RecordedAccount): SchedulerInputs {
  const { held } = recorded
  return {
    firstCycleDone: recorded.workedCycle !== undefined,
    lastCycleStartedAt: recorded.lastCycle?.startedAt ?? null,
    lastCycleFinishedAt: recorded.lastCycle?.finishedAt ?? null,
    latestLogin: loginAt(recorded.login ?? null),
    latestWorked: runAt(recorded.workedCycle ?? null),
    latestAccountWorked: runAt(recorded.accountWorked ?? null),
    latestExpired: runAt(recorded.expired ?? null),
    latestHeld: held ? { startedAt: held.startedAt, finishedAt: held.finishedAt } : null,
  }
}
