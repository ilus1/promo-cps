import type { HoldKind, RequestHold } from './request-hold'
import type { WatchRetailer, WatchSourceState, WatchSourceStatus } from './watch/types'

export interface HealthCycle {
  startedAt: string
  status: string | null
}

export interface HealthSource {
  retailer: WatchRetailer
  state: WatchSourceState
  blockedUntil: string | null
}

export type SourceHealthInput = Pick<WatchSourceStatus, 'retailer' | 'state' | 'blockedUntil'>

export interface HealthReport {
  schedulerEnabled: boolean
  serverStartedAt: string
  lastCycle: HealthCycle | null
  pause: string | null
  nextRunAt: string | null
  runEveryHours: number
  hold: { kind: HoldKind; text: string } | null
  watch: HealthSource[] | null
}

export interface HealthInputs {
  schedulerEnabled: boolean
  serverStartedAt: Date
  lastCycle: { startedAt: Date; status: string | null } | null
  pause: string | null
  nextRunAt: Date | null
  runEveryHours: number
  hold: RequestHold | null
  watch: SourceHealthInput[] | null
}

function sourceHealth(source: SourceHealthInput): HealthSource {
  return { retailer: source.retailer, state: source.state, blockedUntil: source.blockedUntil?.toISOString() ?? null }
}

export function healthReport(inputs: HealthInputs): HealthReport {
  const { lastCycle } = inputs
  return {
    schedulerEnabled: inputs.schedulerEnabled,
    serverStartedAt: inputs.serverStartedAt.toISOString(),
    lastCycle: lastCycle ? { startedAt: lastCycle.startedAt.toISOString(), status: lastCycle.status } : null,
    pause: inputs.pause,
    nextRunAt: inputs.nextRunAt?.toISOString() ?? null,
    runEveryHours: inputs.runEveryHours,
    hold: inputs.hold ? { kind: inputs.hold.kind, text: inputs.hold.text } : null,
    watch: inputs.watch?.map(sourceHealth) ?? null,
  }
}
