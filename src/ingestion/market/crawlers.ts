import { loadCrawlerState, saveCrawlerState } from '@/db/crawler-state'
import { marketCoverage, type CoverageCounts } from '@/db/market-coverage'
import { upsertOffers, validOfferCounts } from '@/db/market-offers'
import { dueSearches, recordSearch, searchCounts, type SearchCounts } from '@/db/market-searches'
import { env } from '@/env'
import {
  MARKET_BOOT_DELAY_MS, MARKET_CHAIN_POLL_MS, MARKET_ERROR_BACKOFF_MAX_MS, MARKET_ERROR_BACKOFF_MS, MARKET_STATUS_CACHE_MS,
  PRICE_CHECK_PRIORITY_SAVING_PERCENT,
} from '@/lib/constants'
import type { MarketStatus, Retailer, WaitingReason } from '@/lib/market/types'
import { errorText } from '../errors'
import { requestHold } from '../request-hold'
import { chainIdle } from '../run-chain'
import { amazonSession, withAmazonBrowser } from './amazon-browser'
import { amazonStep, type AmazonDeps } from './amazon-crawler'
import { LOG_TAG, type CrawlStep } from './crawl-page'
import { amazonStatus, kabumStatus } from './crawler-status'
import { fetchKabumPage } from './kabum-client'
import { kabumStep, type KabumDeps } from './kabum-crawler'
import { rematchKeys, requestRematch, startRematchLoop } from './rematch'

export interface CrawlerLoop { lastWait: WaitingReason | null; stop: () => void }

export interface LoopOptions {
  site: Retailer
  step: () => Promise<CrawlStep>
  bootDelayMs?: number
}

interface MarketCounts { offers: Record<Retailer, number>; searches: SearchCounts; coverage: CoverageCounts }

interface MarketCrawlers { kabum: CrawlerLoop; amazon: CrawlerLoop }

declare global {
  var __promoMarketCrawlers: MarketCrawlers | undefined
}

function log(line: string): void {
  console.log(line)
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function pauseWhileIdle(ms: number, idle: () => boolean = chainIdle): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (!idle()) return false
    await sleepFor(Math.min(MARKET_CHAIN_POLL_MS, until - Date.now()))
  }
  return idle()
}

const kabumDeps: KabumDeps = {
  now: () => new Date(),
  hold: requestHold,
  load: () => loadCrawlerState('kabum'),
  save: (patch) => saveCrawlerState('kabum', patch),
  fetch: (url) => fetchKabumPage(url),
  upsert: upsertOffers,
  rematch: requestRematch,
  random: Math.random,
  log,
}

const amazonDeps: AmazonDeps = {
  now: () => new Date(),
  hold: requestHold,
  idle: chainIdle,
  load: () => loadCrawlerState('amazon'),
  save: (patch) => saveCrawlerState('amazon', patch),
  session: (work) => withAmazonBrowser((page, isOpen) => work(amazonSession(page, isOpen))),
  dueSearches,
  recordSearch,
  upsert: upsertOffers,
  rematchKeys,
  rematch: requestRematch,
  pause: (ms) => pauseWhileIdle(ms),
  random: Math.random,
  log,
}

export function errorBackoffMs(failures: number): number {
  return Math.min(MARKET_ERROR_BACKOFF_MS * 2 ** Math.max(failures - 1, 0), MARKET_ERROR_BACKOFF_MAX_MS)
}

export function startCrawlerLoop({ site, step, bootDelayMs = MARKET_BOOT_DELAY_MS }: LoopOptions): CrawlerLoop {
  let alive = true
  let timer: NodeJS.Timeout | undefined
  let wake: (() => void) | undefined
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    wake = resolve
    timer = setTimeout(resolve, ms)
    timer.unref()
  })
  const loop: CrawlerLoop = {
    lastWait: null,
    stop: () => {
      alive = false
      clearTimeout(timer)
      wake?.()
    },
  }
  void (async () => {
    await sleep(bootDelayMs)
    let failures = 0
    while (alive) {
      try {
        const next = await step()
        failures = 0
        loop.lastWait = next.waitingFor
        await sleep(next.sleepMs)
      } catch (e) {
        failures += 1
        console.error(LOG_TAG, `${site}:`, errorText(e))
        await sleep(errorBackoffMs(failures))
      }
    }
  })()
  return loop
}

export function stopMarketCrawlers(): void {
  globalThis.__promoMarketCrawlers?.kabum.stop()
  globalThis.__promoMarketCrawlers?.amazon.stop()
  globalThis.__promoMarketCrawlers = undefined
}

export function startMarketCrawlers(): void {
  stopMarketCrawlers()
  if (env().AUTO_RUN === 'off') {
    console.log(LOG_TAG, 'crawlers disabled (AUTO_RUN=off)')
    return
  }
  startRematchLoop()
  globalThis.__promoMarketCrawlers = {
    kabum: startCrawlerLoop({ site: 'kabum', step: () => kabumStep(kabumDeps) }),
    amazon: startCrawlerLoop({ site: 'amazon', step: () => amazonStep(amazonDeps) }),
  }
}

let countsCache: { at: number; counts: MarketCounts } | null = null

async function readCounts(now: Date): Promise<MarketCounts> {
  const [offers, searches, coverage] = await Promise.all([validOfferCounts(now), searchCounts(now), marketCoverage(now)])
  return { offers, searches, coverage }
}

async function cachedCounts(now: Date): Promise<MarketCounts> {
  const age = countsCache ? now.getTime() - countsCache.at : Infinity
  if (countsCache && age >= 0 && age < MARKET_STATUS_CACHE_MS) return countsCache.counts
  const counts = await readCounts(now)
  countsCache = { at: now.getTime(), counts }
  return counts
}

export async function marketStatus(now: Date): Promise<MarketStatus> {
  const [kabumRow, amazonRow, { offers, searches, coverage }, hold] = await Promise.all([
    loadCrawlerState('kabum'), loadCrawlerState('amazon'), cachedCounts(now), requestHold(now),
  ])
  const loops = globalThis.__promoMarketCrawlers
  const running = loops !== undefined
  return {
    kabum: kabumStatus({ row: kabumRow, running, hold, now, validOffers: offers.kabum }),
    amazon: amazonStatus({
      row: amazonRow,
      running,
      hold,
      now,
      validOffers: offers.amazon,
      chainIdle: chainIdle(),
      lastWait: loops?.amazon.lastWait ?? null,
      searchedKeys: searches.searched,
      dueKeys: searches.due,
    }),
    coverage: { ...coverage, minPercent: PRICE_CHECK_PRIORITY_SAVING_PERCENT },
  }
}
