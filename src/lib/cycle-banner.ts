import { SESSION_EXPIRED_STATUS, type RunRowStatus } from './domain'
import { CYCLE_BANNER_TEXT } from './labels'

type RecordedAt = { status: RunRowStatus | null; startedAt: Date }

function isBannerStatus(status: RunRowStatus | null): status is keyof typeof CYCLE_BANNER_TEXT {
  return status !== null && Object.hasOwn(CYCLE_BANNER_TEXT, status)
}

function startedAfter(run: RecordedAt | null, since: Date): boolean {
  return run !== null && run.startedAt.getTime() > since.getTime()
}

export function cycleBannerText(
  finishedCycle: RecordedAt | null, workedCycle: RecordedAt | null, login: RecordedAt | null,
): string | null {
  if (finishedCycle === null || !isBannerStatus(finishedCycle.status)) return null
  const since = finishedCycle.startedAt
  if (startedAfter(workedCycle, since)) return null
  if (finishedCycle.status === SESSION_EXPIRED_STATUS && login?.status === 'logged_in' && startedAfter(login, since)) return null
  return CYCLE_BANNER_TEXT[finishedCycle.status]
}
