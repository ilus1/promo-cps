import type { CrawlerState, CrawlerStatus, Retailer } from './market/types'
import type { HoldKind, RequestHold } from './request-hold'

export interface HealthCycle {
  startedAt: string
  status: string | null
}

export interface HealthCrawler {
  state: CrawlerState
  blockedUntil: string | null
}

export type CrawlerHealthInput = Pick<CrawlerStatus, 'state' | 'blockedUntil'>

export interface HealthReport {
  schedulerEnabled: boolean
  serverStartedAt: string
  lastCycle: HealthCycle | null
  pause: string | null
  nextRunAt: string | null
  runEveryHours: number
  hold: { kind: HoldKind; text: string } | null
  market: Record<Retailer, HealthCrawler> | null
}

export interface HealthInputs {
  schedulerEnabled: boolean
  serverStartedAt: Date
  lastCycle: { startedAt: Date; status: string | null } | null
  pause: string | null
  nextRunAt: Date | null
  runEveryHours: number
  hold: RequestHold | null
  market: Record<Retailer, CrawlerHealthInput> | null
}

function crawlerHealth(crawler: CrawlerHealthInput): HealthCrawler {
  return { state: crawler.state, blockedUntil: crawler.blockedUntil?.toISOString() ?? null }
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
    market: inputs.market ? { kabum: crawlerHealth(inputs.market.kabum), amazon: crawlerHealth(inputs.market.amazon) } : null,
  }
}
