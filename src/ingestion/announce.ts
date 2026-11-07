import type { Run } from '@/db/schema'
import type { RunKind, RunRowStatus } from '@/lib/domain'
import { sessionNotification, type DesktopNotification } from '@/lib/desktop-notify'

export interface AnnounceDeps {
  sessionAlert: (run: Run) => Promise<DesktopNotification | null>
  healthAlert: (run: Run) => DesktopNotification | null
  notify: (n: DesktopNotification) => void
}

export async function sessionAlertFor(
  run: Pick<Run, 'kind' | 'status' | 'error' | 'startedAt'>,
  loadPrevious: (kind: RunKind, before: Date) => Promise<RunRowStatus | null>,
  baseUrl: string,
): Promise<DesktopNotification | null> {
  const problem = sessionNotification(run, baseUrl)
  if (!problem) return null
  return run.status === await loadPrevious(run.kind, run.startedAt) ? null : problem
}

export async function notifyStatus(run: Run, deps: AnnounceDeps): Promise<void> {
  const session = await deps.sessionAlert(run)
  if (session) deps.notify(session)
  const health = deps.healthAlert(run)
  if (health) deps.notify(health)
}
