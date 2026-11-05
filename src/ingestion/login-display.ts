import {
  isLoginInProgress, isLoginOutcome, isRunStatus, SESSION_ACTIVE_DISPLAY, SESSION_EXPIRED_DISPLAY, SESSION_EXPIRED_TEXT,
  type LoginDisplay, type LoginState, type LoginStatus, type RunRowStatus, type RunStatus,
} from '@/lib/domain'
import { schedulerPause, type StatusAt } from './schedule'

export type RecordedRun = { status: RunRowStatus | null; startedAt: Date }
export type RecordedLogin = RecordedRun & { error: string | null }

export function loginAt(run: RecordedLogin | null): StatusAt<LoginState> | null {
  return run && isLoginOutcome(run.status) ? { status: run.status, at: run.startedAt } : null
}

export function runAt(run: RecordedRun | null): StatusAt<RunStatus> | null {
  return run && isRunStatus(run.status) ? { status: run.status, at: run.startedAt } : null
}

function sessionWorks(
  lastLogin: RecordedLogin | null, lastWorked: RecordedRun | null, lastExpired: RecordedRun | null,
): boolean {
  const worked = runAt(lastWorked)
  if (worked === null) return false
  const workedAt = worked.at.getTime()
  const loginOlder = lastLogin === null || lastLogin.startedAt.getTime() < workedAt
  const expiredOlder = lastExpired === null || lastExpired.startedAt.getTime() < workedAt
  return loginOlder && expiredOlder
}

export function loginDisplay(
  live: LoginStatus,
  lastLogin: RecordedLogin | null,
  lastWorked: RecordedRun | null,
  lastExpired: RecordedRun | null,
): LoginDisplay {
  if (isLoginInProgress(live.state)) return live
  const recorded = loginAt(lastLogin)
  if (schedulerPause(recorded, runAt(lastWorked), runAt(lastExpired)) === SESSION_EXPIRED_TEXT) {
    return { state: SESSION_EXPIRED_DISPLAY, error: null }
  }
  if (sessionWorks(lastLogin, lastWorked, lastExpired)) {
    return { state: SESSION_ACTIVE_DISPLAY, error: null }
  }
  return live.state === 'idle' && recorded && lastLogin ? { state: recorded.status ?? live.state, error: lastLogin.error } : live
}
