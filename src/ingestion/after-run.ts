import { collectDigests } from '@/db/alerts'
import { alertCandidatesToCheck } from '@/db/price-checks'
import { previousStatus } from '@/db/runs'
import type { Run } from '@/db/schema'
import { sessionAlertFor } from '@/lib/alert-digest'
import { appBaseUrl } from '@/lib/app-url'
import { dealDigestNotification, healthNotification, sendDesktopNotification } from '@/lib/desktop-notify'
import { checkPlan, type CheckItem } from '@/lib/price-check-rules'
import { announce, notifyStatus, type AnnounceDeps } from './announce'
import { queueAnnounce } from './announce-queue'
import { errorText } from './errors'
import { rematchItems, requestRematch } from './market/rematch'

async function matchAlertCandidates(candidates: readonly CheckItem[]): Promise<void> {
  await rematchItems(candidates, new Date())
}

function rematchAfter(run: Run): void {
  if (checkPlan(run).alerts) requestRematch()
}

const liveDeps: AnnounceDeps = {
  sessionAlert: (run) => sessionAlertFor(run, previousStatus, appBaseUrl()),
  healthAlert: (run) => healthNotification(run, appBaseUrl()),
  notify: sendDesktopNotification,
  digestNotification: dealDigestNotification,
  alertCandidates: alertCandidatesToCheck,
  runChecks: matchAlertCandidates,
  collectDigests,
  now: () => new Date(),
}

function logFailure(e: unknown): void {
  console.error('[after-run] failed:', errorText(e))
}

export function afterRun(run: Run): void {
  const status = notifyStatus(run, liveDeps).catch(logFailure)
  queueAnnounce(() => status.then(() => announce(run, liveDeps)).catch(logFailure).then(() => rematchAfter(run)))
}
