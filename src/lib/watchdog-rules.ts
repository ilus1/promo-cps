import { capitalized } from './auto-run-view'
import { DAY_MS, HOUR_MS, SECOND_MS } from './constants'
import { PLAN_FAILED_TEXT } from './domain'
import { formatDateTime } from './format'
import type { HealthReport } from './health-view'
import { APP_NAME } from './labels'
import type { HoldKind } from './request-hold'

export const WATCHDOG_TIMEOUT_MS = 10 * SECOND_MS
export const STALE_EXTRA_HOURS = 1
export const STALE_CYCLE_FACTOR = 2
export const RENOTIFY_AFTER_MS = DAY_MS

export const PROBLEM_IDS = ['unreachable', 'paused', 'stale', 'vpn_unknown'] as const
export type ProblemId = (typeof PROBLEM_IDS)[number]

export type WatchdogInput = HealthReport | 'unreachable'
export type WatchdogState = Partial<Record<ProblemId, string>> & { holdSeenAt?: string }

export interface WatchdogNotification {
  id: ProblemId
  title: string
  body: string
}

export interface WatchdogDecision {
  holdSeen: boolean
  active: ProblemId[]
  unknown: ProblemId[]
  notifications: WatchdogNotification[]
}

const PRICE_HOLD_KIND: HoldKind = 'price_manual'
const UNREACHABLE_BODY = 'O servidor não respondeu a tempo ou respondeu com erro. Veja: systemctl --user status promo-cps'
const UNREACHABLE_SEEN: readonly ProblemId[] = ['paused', 'stale', 'vpn_unknown']
const UNKNOWN_HOLD_KIND: HoldKind = 'vpn_unknown'
const VPN_UNKNOWN_BODY = 'Não foi possível verificar a VPN: nada roda até a verificação voltar'

export function staleAfterMs(runEveryHours: number): number {
  return (STALE_CYCLE_FACTOR * runEveryHours + STALE_EXTRA_HOURS) * HOUR_MS
}

function notification(id: ProblemId, title: string, body: string): WatchdogNotification {
  return { id, title: `${APP_NAME}: ${title}`, body }
}

function staleBody(startedAt: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - startedAt.getTime()) / HOUR_MS)
  return `O último ciclo começou em ${formatDateTime(startedAt)}, há ${hours} h.`
}

function isPaused(health: HealthReport): health is HealthReport & { pause: string } {
  return health.pause !== null && health.pause !== PLAN_FAILED_TEXT
}

function holdsRunner(health: HealthReport): boolean {
  return health.hold != null && health.hold.kind !== PRICE_HOLD_KIND
}

function lastActivity(
  health: HealthReport & { lastCycle: NonNullable<HealthReport['lastCycle']> }, holdSeenAt: string | undefined,
): Date {
  const cycleStart = new Date(health.lastCycle.startedAt).getTime()
  const serverStart = new Date(health.serverStartedAt).getTime()
  const holdSeen = holdSeenAt === undefined ? Number.NaN : new Date(holdSeenAt).getTime()
  return new Date(Math.max(cycleStart, serverStart, Number.isNaN(holdSeen) ? 0 : holdSeen))
}

function problems(health: WatchdogInput, now: Date, holdSeenAt: string | undefined): WatchdogNotification[] {
  if (health === 'unreachable') return [notification('unreachable', 'servidor fora do ar', UNREACHABLE_BODY)]
  if (isPaused(health)) return [notification('paused', 'execução automática pausada', capitalized(health.pause))]
  if (health.hold?.kind === UNKNOWN_HOLD_KIND) return [notification('vpn_unknown', 'VPN não verificada', VPN_UNKNOWN_BODY)]
  if (holdsRunner(health)) return []
  if (!health.schedulerEnabled || health.lastCycle === null || health.lastCycle.status === null) return []
  const since = lastActivity({ ...health, lastCycle: health.lastCycle }, holdSeenAt)
  if (now.getTime() - since.getTime() <= staleAfterMs(health.runEveryHours)) return []
  return [notification('stale', 'nenhum ciclo recente', staleBody(new Date(health.lastCycle.startedAt), now))]
}

function due(notifiedAt: string | undefined, now: Date): boolean {
  if (notifiedAt === undefined) return true
  const elapsed = now.getTime() - new Date(notifiedAt).getTime()
  return Number.isNaN(elapsed) || elapsed >= RENOTIFY_AFTER_MS
}

export function watchdogDecision(health: WatchdogInput, now: Date, previous: WatchdogState): WatchdogDecision {
  const found = problems(health, now, previous.holdSeenAt)
  return {
    holdSeen: health !== 'unreachable' && holdsRunner(health),
    active: found.map((p) => p.id),
    unknown: health === 'unreachable' ? [...UNREACHABLE_SEEN] : [],
    notifications: found.filter((p) => due(previous[p.id], now)),
  }
}

export function watchdogState(
  previous: WatchdogState,
  decision: WatchdogDecision,
  sent: readonly ProblemId[],
  now: Date,
): WatchdogState {
  const next: WatchdogState = {}
  if (decision.holdSeen) next.holdSeenAt = now.toISOString()
  else if (previous.holdSeenAt !== undefined) next.holdSeenAt = previous.holdSeenAt
  for (const id of PROBLEM_IDS) {
    const kept = previous[id]
    if (sent.includes(id)) next[id] = now.toISOString()
    else if (kept !== undefined && (decision.active.includes(id) || decision.unknown.includes(id))) next[id] = kept
  }
  return next
}
