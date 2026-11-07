import { lastWatchAlert, mlLinksGone, monitoringCounts, productNames, removedRefs, requestCheck } from '@/db/monitoring'
import {
  listingsDueForRefresh, pagesDueForRefresh, recordListingError, recordPageError, recordPageQuotes, recordQuote, upsertListing,
} from '@/db/watch-listings'
import { markResolved, productsDueForResolve, updateProduct } from '@/db/watch-products'
import { env } from '@/env'
import { WATCH_BOOT_DELAY_MS, WATCH_REFRESH_HOURS, WATCH_TICK_MS } from '@/lib/constants'
import { AUTO_CHECKS_OFF_LABEL } from '@/lib/labels'
import type { WatchStatus } from '@/lib/watch/types'
import { autoRunStatus } from '../auto-run'
import { mlEanMisses, mlLinkFailures } from '../steps/watch-ml-pages'
import { cycleActivity } from '../cycle'
import { errorText } from '../errors'
import { amazonPageLoader, withAmazonBrowser } from '../market/amazon-browser'
import { fetchMarketPage } from '../market/http-client'
import { requestHold } from '../request-hold'
import { chainIdle } from '../run-chain'
import { createChromePool, type ChromeOpener, type ChromePool } from './chrome-pool'
import { checkAlerts } from './price-alerts'
import { refreshPass, type RefreshDeps } from './refresh'
import { resolvePass, type ResolveDeps, type ResolveProgress } from './resolve'
import { errorBackoffMs } from './retry-backoff'
import { createSiteGate, freshHealth, WATCH_LOG_TAG, type GateDeps, type SiteGate } from './site-gate'
import { watchSources, type WatchSources } from './sources'
import { watchStatusOf } from './status'

export interface WatchLoop { wake: () => void; stop: () => void }

export interface LoopOptions {
  name: string
  pass: () => Promise<unknown>
  bootDelayMs?: number
  tickMs?: number
  log?: (line: string) => void
}

interface WatchRuntime { gate: SiteGate; chrome: ChromePool; progress: ResolveProgress; resolver: WatchLoop; refresher: WatchLoop }

declare global {
  var __promoWatch: WatchRuntime | undefined
}

export function startLoop({
  name, pass, bootDelayMs = WATCH_BOOT_DELAY_MS, tickMs = WATCH_TICK_MS, log = (line) => console.error(line),
}: LoopOptions): WatchLoop {
  let alive = true
  let woken = false
  let timer: NodeJS.Timeout | undefined
  let cut: (() => void) | undefined
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    if (woken) {
      woken = false
      resolve()
      return
    }
    cut = resolve
    timer = setTimeout(resolve, ms)
    timer.unref()
  }).finally(() => {
    clearTimeout(timer)
    cut = undefined
  })
  const loop: WatchLoop = {
    wake: () => {
      woken = cut === undefined
      cut?.()
    },
    stop: () => {
      alive = false
      cut?.()
    },
  }
  void (async () => {
    await sleep(bootDelayMs)
    let failures = 0
    while (alive) {
      try {
        await pass()
        failures = 0
        await sleep(tickMs)
      } catch (e) {
        failures += 1
        log(`${WATCH_LOG_TAG} ${name}: ${errorText(e)}`)
        await sleep(errorBackoffMs(failures))
      }
    }
  })()
  return loop
}

function log(line: string): void {
  console.log(line)
}

const gateDeps: GateDeps = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  hold: requestHold,
  idle: chainIdle,
  random: Math.random,
  log,
}

const openChrome: ChromeOpener = (work) => withAmazonBrowser((page) => work(amazonPageLoader(page)))

function resolveDeps(sources: WatchSources, chrome: ChromePool): ResolveDeps {
  return {
    sources,
    chrome,
    due: productsDueForResolve,
    upsert: upsertListing,
    recordQuote,
    recordPageQuotes,
    recordError: recordListingError,
    recordPageError,
    update: updateProduct,
    markResolved,
    removedRefs,
    mlLinksGone,
    alerts: (productId, now) => checkAlerts(productId, now),
    now: () => new Date(),
    log,
  }
}

function refreshDeps(sources: WatchSources, chrome: ChromePool): RefreshDeps {
  return {
    sources,
    chrome,
    dueListings: listingsDueForRefresh,
    duePages: pagesDueForRefresh,
    recordQuote,
    recordPageQuotes,
    recordError: recordListingError,
    recordPageError,
    productNames,
    alerts: (productId, now) => checkAlerts(productId, now),
    now: () => new Date(),
  }
}

export function stopWatch(): void {
  const runtime = globalThis.__promoWatch
  globalThis.__promoWatch = undefined
  if (!runtime) return
  runtime.resolver.stop()
  runtime.refresher.stop()
  runtime.chrome.close().catch((e: unknown) => console.error(WATCH_LOG_TAG, 'chrome close failed:', errorText(e)))
}

export function startWatch(): void {
  stopWatch()
  if (env().AUTO_RUN === 'off') {
    console.log(WATCH_LOG_TAG, 'disabled (AUTO_RUN=off)')
    return
  }
  const gate = createSiteGate(gateDeps)
  const chrome = createChromePool(openChrome)
  const sources = watchSources({ gate, http: (url) => fetchMarketPage(url), chrome, now: () => new Date() })
  const progress: ResolveProgress = new Map()
  const refresher = startLoop({ name: 'refresh', pass: () => refreshPass(refreshDeps(sources, chrome)) })
  const resolver = startLoop({
    name: 'resolve',
    pass: async () => {
      const pass = await resolvePass(resolveDeps(sources, chrome), progress)
      if (pass.due > 0) refresher.wake()
    },
  })
  globalThis.__promoWatch = { gate, chrome, progress, resolver, refresher }
  console.log(WATCH_LOG_TAG, 'started')
}

export const WATCH_OFF_TEXT = AUTO_CHECKS_OFF_LABEL

export function watchRunning(): boolean {
  return globalThis.__promoWatch !== undefined
}

export function wakeWatch(): void {
  globalThis.__promoWatch?.resolver.wake()
}

export async function requestWatchCheck(productId: string): Promise<boolean> {
  if (!(await requestCheck(productId))) return false
  globalThis.__promoWatch?.progress.delete(productId)
  mlEanMisses().delete(productId)
  mlLinkFailures().delete(productId)
  wakeWatch()
  return true
}

export async function watchStatus(now: Date): Promise<WatchStatus> {
  const runtime = globalThis.__promoWatch
  const [counts, hold, lastAlert] = await Promise.all([monitoringCounts(), requestHold(now), lastWatchAlert()])
  return watchStatusOf({
    running: runtime !== undefined,
    hold,
    health: (site) => runtime?.gate.health(site) ?? freshHealth(),
    busy: (site) => runtime?.gate.busy(site) ?? false,
    chainIdle: chainIdle(),
    cycleRunning: cycleActivity().phase === 'running',
    cycleNextRunAt: autoRunStatus().cycleNextRunAt,
    counts,
    lastAlert,
    refreshHours: WATCH_REFRESH_HOURS,
    now,
  })
}
