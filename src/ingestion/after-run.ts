import { previousStatus } from '@/db/runs'
import type { Run } from '@/db/schema'
import { appBaseUrl } from '@/lib/app-url'
import { healthNotification, sendDesktopNotification } from '@/lib/desktop-notify'
import { notifyStatus, sessionAlertFor, type AnnounceDeps } from './announce'
import { errorText } from './errors'

const liveDeps: AnnounceDeps = {
  sessionAlert: (run) => sessionAlertFor(run, previousStatus, appBaseUrl()),
  healthAlert: (run) => healthNotification(run, appBaseUrl()),
  notify: sendDesktopNotification,
}

function logFailure(e: unknown): void {
  console.error('[after-run] failed:', errorText(e))
}

export function afterRun(run: Run): void {
  notifyStatus(run, liveDeps).catch(logFailure)
}
