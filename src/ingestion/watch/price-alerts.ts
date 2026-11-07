import { alertHistory, logAlert, sentAlerts, type AlertHistory } from '@/db/watch-alerts'
import { watchedProduct } from '@/db/watch-products'
import { appBaseUrl } from '@/lib/app-url'
import { WATCH_LOW_WINDOW_DAYS } from '@/lib/constants'
import { sendDesktopNotification, type DesktopNotification } from '@/lib/desktop-notify'
import { formatCents, formatPercent } from '@/lib/format'
import { daysBefore } from '@/lib/freshness'
import { productHref } from '@/lib/routes'
import { decideAlerts } from '@/lib/watch/alerts'
import type { SentWatchAlert, WatchAlertDecision, WatchAlertKind, WatchProductView } from '@/lib/watch/types'
import { storeInText } from '@/lib/watch/view'

export interface AlertDeps {
  product: (id: string, now: Date) => Promise<WatchProductView | null>
  history: (id: string, since: Date, before: Date) => Promise<AlertHistory>
  sent: (id: string) => Promise<SentWatchAlert[]>
  log: (productId: string, kind: WatchAlertKind, priceCents: number, listingId: string | null, now: Date) => Promise<boolean>
  notify: (notification: DesktopNotification) => void
  baseUrl: () => string
}

export const ALERT_TITLE_PREFIX = 'Preço baixou'
const LOW_TEXT = `Menor preço dos últimos ${WATCH_LOW_WINDOW_DAYS} dias`

export const liveAlertDeps: AlertDeps = {
  product: watchedProduct,
  history: alertHistory,
  sent: sentAlerts,
  log: logAlert,
  notify: sendDesktopNotification,
  baseUrl: appBaseUrl,
}

function reasonText(decision: WatchAlertDecision, product: Pick<WatchProductView, 'targetPriceCents'>): string {
  if (decision.kind === 'target') return `Atingiu o preço alvo de ${formatCents(product.targetPriceCents ?? decision.best.finalCents)}`
  if (decision.kind === 'low_30d') return LOW_TEXT
  const previous = decision.previousBestCents ?? decision.best.finalCents
  const ratio = previous > 0 ? (previous - decision.best.finalCents) / previous : 0
  return `Caiu ${formatPercent(ratio)} (antes ${formatCents(previous)})`
}

export function alertNotification(
  product: Pick<WatchProductView, 'id' | 'name' | 'targetPriceCents'>, decision: WatchAlertDecision, baseUrl: string,
): DesktopNotification {
  const { best } = decision
  return {
    title: `${ALERT_TITLE_PREFIX}: ${product.name}`,
    body: [`${formatCents(best.finalCents)} ${storeInText(best.retailer, best.merchant)}`, reasonText(decision, product)].join('\n'),
    url: `${baseUrl}${productHref(product.id)}`,
  }
}

export async function checkAlerts(productId: string, now: Date, deps: AlertDeps = liveAlertDeps): Promise<number> {
  const product = await deps.product(productId, now)
  if (!product?.best) return 0
  const [history, sent] = await Promise.all([
    deps.history(productId, daysBefore(now, WATCH_LOW_WINDOW_DAYS), now),
    deps.sent(productId),
  ])
  const known = { listings: product.listings, knownIds: history.knownListingIds }
  let notified = 0
  for (const decision of decideAlerts(product, product.best, history.points, sent, now, known)) {
    if (!(await deps.log(productId, decision.kind, decision.best.finalCents, decision.best.listingId, now))) continue
    deps.notify(alertNotification(product, decision, deps.baseUrl()))
    notified += 1
  }
  return notified
}
