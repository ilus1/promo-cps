import type { MonitoringCounts, RetailerListings } from '@/db/monitoring'
import { HOUR_MS } from '@/lib/constants'
import { pagesToday } from '@/lib/market/crawl-rules'
import type { RequestHold } from '@/lib/request-hold'
import {
  ML_RETAILER, WATCH_RETAILERS, type WatchLastAlert, type WatchRetailer, type WatchSourceState, type WatchSourceStatus, type WatchStatus,
  type WatchWaitingReason,
} from '@/lib/watch/types'
import { ML_BUSY, type SiteHealth } from './site-gate'

export interface StatusInputs {
  running: boolean
  hold: RequestHold | null
  health: (site: Exclude<WatchRetailer, typeof ML_RETAILER>) => SiteHealth
  busy: (site: Exclude<WatchRetailer, typeof ML_RETAILER>) => boolean
  chainIdle: boolean
  cycleRunning: boolean
  cycleNextRunAt: Date | null
  counts: MonitoringCounts
  lastAlert: WatchLastAlert | null
  refreshHours: number
  now: Date
}

const NO_LISTINGS: RetailerListings = { listings: 0, unchecked: false, oldestCheckAt: null, lastCheckAt: null }
const ML_CYCLE: WatchWaitingReason = 'ml_cycle'
const NEXT_REFRESH: WatchWaitingReason = 'next_refresh'

function nextRefreshAt(listings: RetailerListings, refreshHours: number, now: Date): Date | null {
  if (listings.unchecked) return now
  return listings.oldestCheckAt ? new Date(listings.oldestCheckAt.getTime() + refreshHours * HOUR_MS) : null
}

function stateOf(
  inputs: StatusInputs, blockedUntil: Date | null, running: boolean, waitingFor: WatchWaitingReason | null,
): Pick<WatchSourceStatus, 'state' | 'holdText' | 'waitingFor'> {
  const state: WatchSourceState = !inputs.running ? 'stopped' : inputs.hold ? 'held' : blockedUntil ? 'blocked' : running ? 'running' : 'waiting'
  return { state, holdText: state === 'held' ? inputs.hold?.reason ?? null : null, waitingFor: state === 'waiting' ? waitingFor : null }
}

function mlStatus(inputs: StatusInputs, listings: RetailerListings): WatchSourceStatus {
  return {
    retailer: ML_RETAILER,
    ...stateOf(inputs, null, inputs.cycleRunning, ML_CYCLE),
    blockedUntil: null,
    lastError: null,
    lastRequestAt: listings.lastCheckAt,
    requestsToday: 0,
    listings: listings.listings,
    nextRefreshAt: listings.listings > 0 ? inputs.cycleNextRunAt : null,
  }
}

function siteStatus(inputs: StatusInputs, retailer: Exclude<WatchRetailer, typeof ML_RETAILER>, listings: RetailerListings): WatchSourceStatus {
  const { now } = inputs
  const health = inputs.health(retailer)
  const blockedUntil = health.blockedUntil && health.blockedUntil.getTime() > now.getTime() ? health.blockedUntil : null
  const nextAt = nextRefreshAt(listings, inputs.refreshHours, now)
  const waitingFor: WatchWaitingReason | null = health.skipped === ML_BUSY && !inputs.chainIdle
    ? ML_BUSY
    : nextAt === null || nextAt.getTime() > now.getTime() ? NEXT_REFRESH : null
  return {
    retailer,
    ...stateOf(inputs, blockedUntil, inputs.busy(retailer), waitingFor),
    blockedUntil,
    lastError: health.lastError,
    lastRequestAt: health.lastRequestAt ?? listings.lastCheckAt,
    requestsToday: pagesToday(health.dayKey, health.requestsToday, now),
    listings: listings.listings,
    nextRefreshAt: nextAt,
  }
}

export function watchStatusOf(inputs: StatusInputs): WatchStatus {
  const listingsOf = (retailer: WatchRetailer) => inputs.counts.retailers[retailer] ?? NO_LISTINGS
  return {
    products: inputs.counts.products,
    sources: WATCH_RETAILERS.map((retailer) => (retailer === ML_RETAILER
      ? mlStatus(inputs, listingsOf(retailer))
      : siteStatus(inputs, retailer, listingsOf(retailer)))),
    lastAlert: inputs.lastAlert,
  }
}
