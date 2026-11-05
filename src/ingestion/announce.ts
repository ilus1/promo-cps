import { PRICE_CHECK_ALERT_ITEMS, PRICE_CHECK_ALERT_ITEMS_TOTAL } from '@/lib/constants'
import type { DesktopNotification, DealDigest } from '@/lib/desktop-notify'
import { checkPlan, type CheckItem } from '@/lib/price-check-rules'
import type { Run } from '@/db/schema'
import { errorText } from './errors'

export interface AnnounceDeps {
  sessionAlert: (run: Run) => Promise<DesktopNotification | null>
  healthAlert: (run: Run) => DesktopNotification | null
  notify: (n: DesktopNotification) => void
  digestNotification: (digest: DealDigest) => DesktopNotification
  alertCandidates: (observedSince: Date, now: Date, perAlert: number, total: number) => Promise<CheckItem[]>
  runChecks: (items: readonly CheckItem[]) => Promise<void>
  collectDigests: (observedSince: Date) => Promise<DealDigest[]>
  now: () => Date
}

export async function notifyStatus(run: Run, deps: AnnounceDeps): Promise<void> {
  const session = await deps.sessionAlert(run)
  if (session) deps.notify(session)
  const health = deps.healthAlert(run)
  if (health) deps.notify(health)
}

export async function announce(run: Run, deps: AnnounceDeps): Promise<void> {
  if (checkPlan(run).alerts) {
    try {
      await deps.runChecks(await deps.alertCandidates(run.startedAt, deps.now(), PRICE_CHECK_ALERT_ITEMS, PRICE_CHECK_ALERT_ITEMS_TOTAL))
    } catch (e) {
      console.error('[market] alertas failed:', errorText(e))
    }
  }
  for (const digest of await deps.collectDigests(run.startedAt)) deps.notify(deps.digestNotification(digest))
}
