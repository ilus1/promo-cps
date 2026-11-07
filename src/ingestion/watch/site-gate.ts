import {
  WATCH_CHROME_INTERVAL_MS, WATCH_CHROME_JITTER_MS, WATCH_HTTP_INTERVAL_MS, WATCH_HTTP_JITTER_MS, WATCH_IDLE_POLL_MS,
} from '@/lib/constants'
import { dayKey, healthAfterPage, pageDelayMs, pagesToday } from '@/lib/market/crawl-rules'
import type { PageKind } from '@/lib/market/types'
import type { RequestHold } from '@/lib/request-hold'
import type { SourcePage } from '@/lib/watch/types'
import { errorText } from '../errors'
import type { FetchedPage } from '../market/fetched-page'

export const WATCH_SITES = ['americanas', 'buscape', 'kabum', 'amazon'] as const
export type WatchSite = (typeof WATCH_SITES)[number]

export const TRANSPORTS = ['http', 'chrome'] as const
export type Transport = (typeof TRANSPORTS)[number]

export const SKIP_REASONS = ['held', 'blocked', 'ml_busy'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]
export const ML_BUSY = 'ml_busy' satisfies SkipReason

export type Skipped = { kind: 'skipped'; reason: SkipReason }
export type GateResult<Value> = SourcePage<Value> | Skipped

export interface SiteHealth {
  backoffLevel: number
  unknownStreak: number
  blockedUntil: Date | null
  lastRequestAt: Date | null
  lastError: string | null
  dayKey: string | null
  requestsToday: number
  skipped: SkipReason | null
}

export interface GateDeps {
  now: () => Date
  sleep: (ms: number) => Promise<void>
  hold: (now: Date) => Promise<RequestHold | null>
  idle: () => boolean
  random: () => number
  log: (line: string) => void
}

export interface SiteGate {
  request<Value>(
    site: WatchSite, transport: Transport, send: () => Promise<FetchedPage>, parse: (page: FetchedPage) => SourcePage<Value>,
  ): Promise<GateResult<Value>>
  health(site: WatchSite): SiteHealth
  busy(site: WatchSite): boolean
}

export const WATCH_LOG_TAG = '[watch]'
const NO_RESPONSE_STATUS = 0
const NO_RESPONSE = 'sem resposta'
const UNREADABLE = 'página ilegível'
const RESULTS: PageKind = 'results'
const PACE: Record<Transport, { intervalMs: number; jitterMs: number }> = {
  http: { intervalMs: WATCH_HTTP_INTERVAL_MS, jitterMs: WATCH_HTTP_JITTER_MS },
  chrome: { intervalMs: WATCH_CHROME_INTERVAL_MS, jitterMs: WATCH_CHROME_JITTER_MS },
}

export function freshHealth(): SiteHealth {
  return {
    backoffLevel: 0, unknownStreak: 0, blockedUntil: null, lastRequestAt: null, lastError: null, dayKey: null, requestsToday: 0, skipped: null,
  }
}

export function isSkipped<Value>(result: GateResult<Value>): result is Skipped {
  return result.kind === 'skipped'
}

function pageKindOf(page: SourcePage<unknown>): PageKind {
  return page.kind === 'ok' ? RESULTS : page.kind
}

function withNetworkReason<Value>(page: SourcePage<Value>, fetched: FetchedPage): SourcePage<Value> {
  if (page.kind === 'ok' || !fetched.reason) return page
  return { ...page, reason: `${page.reason}: ${fetched.reason}` }
}

function afterRequest(health: SiteHealth, page: SourcePage<unknown>, now: Date): SiteHealth {
  const next = healthAfterPage({ backoffLevel: health.backoffLevel, unknownStreak: health.unknownStreak }, pageKindOf(page), now)
  const failed = page.kind === 'wall' || page.kind === 'unknown'
  return {
    backoffLevel: next.backoffLevel,
    unknownStreak: next.unknownStreak,
    blockedUntil: next.blockedUntilMs === null ? null : new Date(next.blockedUntilMs),
    lastRequestAt: now,
    lastError: page.kind === 'ok' ? null : failed ? page.reason : health.lastError,
    dayKey: dayKey(now),
    requestsToday: pagesToday(health.dayKey, health.requestsToday, now) + 1,
    skipped: null,
  }
}

async function sent(send: () => Promise<FetchedPage>): Promise<FetchedPage> {
  try {
    return await send()
  } catch (e) {
    return { status: NO_RESPONSE_STATUS, html: '', reason: errorText(e) }
  }
}

function parsed<Value>(parse: (page: FetchedPage) => SourcePage<Value>, fetched: FetchedPage): SourcePage<Value> {
  try {
    return withNetworkReason(parse(fetched), fetched)
  } catch (e) {
    return { kind: 'unknown', reason: `${UNREADABLE}: ${errorText(e)}` }
  }
}

export function createSiteGate(deps: GateDeps, states: Map<WatchSite, SiteHealth> = new Map()): SiteGate {
  const chains = new Map<WatchSite, Promise<unknown>>()
  const inFlight = new Map<WatchSite, number>()
  const health = (site: WatchSite) => states.get(site) ?? freshHealth()
  const track = (site: WatchSite, change: number) => inFlight.set(site, (inFlight.get(site) ?? 0) + change)

  function serialized<T>(site: WatchSite, task: () => Promise<T>): Promise<T> {
    track(site, 1)
    const run = (chains.get(site) ?? Promise.resolve()).then(task).finally(() => track(site, -1))
    chains.set(site, run.then(() => undefined, () => undefined))
    return run
  }

  async function closed(site: WatchSite, transport: Transport): Promise<SkipReason | null> {
    const now = deps.now()
    if (await deps.hold(now)) return 'held'
    const { blockedUntil } = health(site)
    if (blockedUntil && blockedUntil.getTime() > now.getTime()) return 'blocked'
    if (transport === 'chrome' && !deps.idle()) return ML_BUSY
    return null
  }

  function skip(site: WatchSite, reason: SkipReason): Skipped {
    states.set(site, { ...health(site), skipped: reason })
    return { kind: 'skipped', reason }
  }

  function paceMs(site: WatchSite, transport: Transport): number {
    const { lastRequestAt } = health(site)
    if (!lastRequestAt) return 0
    const { intervalMs, jitterMs } = PACE[transport]
    return lastRequestAt.getTime() + pageDelayMs(intervalMs, jitterMs, deps.random()) - deps.now().getTime()
  }

  async function paced(transport: Transport, waitMs: number): Promise<SkipReason | null> {
    if (transport === 'http') {
      await deps.sleep(waitMs)
      return null
    }
    for (let left = waitMs; left > 0; left -= WATCH_IDLE_POLL_MS) {
      if (!deps.idle()) return ML_BUSY
      await deps.sleep(Math.min(WATCH_IDLE_POLL_MS, left))
    }
    return null
  }

  async function request<Value>(
    site: WatchSite, transport: Transport, send: () => Promise<FetchedPage>, parse: (page: FetchedPage) => SourcePage<Value>,
  ): Promise<GateResult<Value>> {
    return serialized(site, async () => {
      const shut = await closed(site, transport)
      if (shut) return skip(site, shut)
      const waitMs = paceMs(site, transport)
      if (waitMs > 0) {
        const busy = await paced(transport, waitMs)
        const shutAfterWait = busy ?? await closed(site, transport)
        if (shutAfterWait) return skip(site, shutAfterWait)
      }
      const page = parsed(parse, await sent(send))
      const next = afterRequest(health(site), page, deps.now())
      states.set(site, next)
      if (next.blockedUntil) deps.log(`${WATCH_LOG_TAG} ${site}: blocked until ${next.blockedUntil.toISOString()} (${next.lastError ?? NO_RESPONSE})`)
      return page
    })
  }

  return { request, health, busy: (site) => (inFlight.get(site) ?? 0) > 0 }
}
