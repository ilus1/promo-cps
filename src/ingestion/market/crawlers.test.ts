import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CrawlerStateRow } from '@/db/crawler-state'
import {
  HOUR_MS, MARKET_BOOT_DELAY_MS, MARKET_ERROR_BACKOFF_MAX_MS, MARKET_ERROR_BACKOFF_MS, MARKET_STATUS_CACHE_MS, MINUTE_MS,
  PRICE_CHECK_PRIORITY_SAVING_PERCENT, SECOND_MS,
} from '@/lib/constants'

const mocks = vi.hoisted(() => ({
  autoRun: 'on',
  loadCrawlerState: vi.fn(),
  saveCrawlerState: vi.fn(),
  validOfferCounts: vi.fn(),
  searchCounts: vi.fn(),
  marketCoverage: vi.fn(),
  requestHold: vi.fn(),
  startRematchLoop: vi.fn(),
  kabumStep: vi.fn(),
  amazonStep: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ AUTO_RUN: mocks.autoRun }) }))
vi.mock('@/db/crawler-state', () => ({ loadCrawlerState: mocks.loadCrawlerState, saveCrawlerState: mocks.saveCrawlerState }))
vi.mock('@/db/market-offers', () => ({ upsertOffers: vi.fn(), validOfferCounts: mocks.validOfferCounts }))
vi.mock('@/db/market-searches', () => ({ dueSearches: vi.fn(), recordSearch: vi.fn(), searchCounts: mocks.searchCounts }))
vi.mock('@/db/market-coverage', () => ({ marketCoverage: mocks.marketCoverage }))
vi.mock('../request-hold', () => ({ requestHold: mocks.requestHold }))
vi.mock('./rematch', () => ({ rematchKeys: vi.fn(), requestRematch: vi.fn(), startRematchLoop: mocks.startRematchLoop }))
vi.mock('./amazon-browser', () => ({ amazonPageLoader: vi.fn(), withAmazonBrowser: vi.fn() }))
vi.mock('./kabum-crawler', async (original) => ({ ...await original<typeof import('./kabum-crawler')>(), kabumStep: mocks.kabumStep }))
vi.mock('./amazon-crawler', async (original) => ({ ...await original<typeof import('./amazon-crawler')>(), amazonStep: mocks.amazonStep }))

import { errorBackoffMs, marketStatus, pauseWhileIdle, startCrawlerLoop, startMarketCrawlers, stopMarketCrawlers } from './crawlers'

const NOW = new Date('2026-11-04T12:00:00Z')

function stateRow(site: CrawlerStateRow['site']): CrawlerStateRow {
  return {
    site, cursor: {}, backoffLevel: 0, blockedUntil: null, dayKey: null, pagesToday: 0, lastPageAt: null,
    passStartedAt: null, bestsellersAt: null, lastError: null, updatedAt: NOW,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.autoRun = 'on'
  mocks.loadCrawlerState.mockImplementation(async (site: CrawlerStateRow['site']) => stateRow(site))
  mocks.saveCrawlerState.mockResolvedValue(undefined)
  mocks.validOfferCounts.mockResolvedValue({ kabum: 120, amazon: 30 })
  mocks.searchCounts.mockResolvedValue({ searched: 4, due: 11 })
  mocks.marketCoverage.mockResolvedValue({ matched: 5, total: 50 })
  mocks.requestHold.mockResolvedValue(null)
  mocks.kabumStep.mockResolvedValue({ sleepMs: HOUR_MS, waitingFor: 'next_pass' })
  mocks.amazonStep.mockResolvedValue({ sleepMs: HOUR_MS, waitingFor: 'queue_empty' })
})

afterEach(() => {
  stopMarketCrawlers()
  vi.useRealTimers()
})

describe('startCrawlerLoop', () => {
  test('the first step waits for the boot delay, then each step sleeps what it asked for', async () => {
    const step = vi.fn(async () => ({ sleepMs: 10 * SECOND_MS, waitingFor: null }))
    const loop = startCrawlerLoop({ site: 'kabum', step })
    await vi.advanceTimersByTimeAsync(MARKET_BOOT_DELAY_MS - 1)
    expect(step).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(step).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10 * SECOND_MS)
    expect(step).toHaveBeenCalledTimes(2)
    loop.stop()
    await vi.advanceTimersByTimeAsync(HOUR_MS)
    expect(step).toHaveBeenCalledTimes(2)
  })

  test('the loop keeps the last waiting reason for the status', async () => {
    const loop = startCrawlerLoop({ site: 'amazon', step: async () => ({ sleepMs: MINUTE_MS, waitingFor: 'queue_empty' }), bootDelayMs: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(loop.lastWait).toBe('queue_empty')
    loop.stop()
  })

  test('an error is logged with its cause and backed off, doubling up to an hour, and never saved as the page error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const step = vi.fn(async () => {
      throw new Error('Failed query: select', { cause: Object.assign(new Error('connection refused'), { code: '08006' }) })
    })
    const loop = startCrawlerLoop({ site: 'amazon', step, bootDelayMs: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(error).toHaveBeenCalledWith('[market]', 'amazon:', 'connection refused (08006)')
    expect(mocks.saveCrawlerState).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(MARKET_ERROR_BACKOFF_MS)
    expect(step).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(MARKET_ERROR_BACKOFF_MS)
    expect(step).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(MARKET_ERROR_BACKOFF_MS)
    expect(step).toHaveBeenCalledTimes(3)
    loop.stop()
    error.mockRestore()
  })

  test('the error backoff doubles from a minute and stops at an hour', () => {
    expect([1, 2, 3, 7, 50].map(errorBackoffMs)).toEqual([
      MARKET_ERROR_BACKOFF_MS, 2 * MARKET_ERROR_BACKOFF_MS, 4 * MARKET_ERROR_BACKOFF_MS, MARKET_ERROR_BACKOFF_MAX_MS, MARKET_ERROR_BACKOFF_MAX_MS,
    ])
  })
})

describe('pauseWhileIdle', () => {
  test('it is true only after the whole pause passed with the chain idle', async () => {
    const idle = vi.fn(() => true)
    const pause = pauseWhileIdle(30 * SECOND_MS, idle)
    let done = false
    void pause.then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(30 * SECOND_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pause).toBe(true)
  })

  test('it ends false within a poll once an ML job is queued', async () => {
    let busy = false
    const pause = pauseWhileIdle(30 * SECOND_MS, () => !busy)
    await vi.advanceTimersByTimeAsync(5 * SECOND_MS)
    busy = true
    await vi.advanceTimersByTimeAsync(SECOND_MS)
    expect(await pause).toBe(false)
  })

  test('an ML job that ends again before the pause is over still makes it false', async () => {
    let busy = false
    const pause = pauseWhileIdle(30 * SECOND_MS, () => !busy)
    await vi.advanceTimersByTimeAsync(5 * SECOND_MS)
    busy = true
    await vi.advanceTimersByTimeAsync(SECOND_MS)
    busy = false
    await vi.advanceTimersByTimeAsync(30 * SECOND_MS)
    expect(await pause).toBe(false)
  })
})

describe('startMarketCrawlers', () => {
  test('starts both loops and the rematch loop once, replacing an earlier start', async () => {
    startMarketCrawlers()
    startMarketCrawlers()
    expect(mocks.startRematchLoop).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(MARKET_BOOT_DELAY_MS)
    expect(mocks.kabumStep).toHaveBeenCalledTimes(1)
    expect(mocks.amazonStep).toHaveBeenCalledTimes(1)
  })

  test('AUTO_RUN=off starts nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mocks.autoRun = 'off'
    startMarketCrawlers()
    await vi.advanceTimersByTimeAsync(MARKET_BOOT_DELAY_MS)
    expect(mocks.startRematchLoop).not.toHaveBeenCalled()
    expect(mocks.kabumStep).not.toHaveBeenCalled()
    expect(globalThis.__promoMarketCrawlers).toBeUndefined()
    log.mockRestore()
  })
})

describe('marketStatus', () => {
  test('a stopped status carries the counts, the queue and the coverage', async () => {
    const status = await marketStatus(NOW)
    expect(status.kabum).toMatchObject({ state: 'stopped', validOffers: 120 })
    expect(status.amazon).toMatchObject({ state: 'stopped', validOffers: 30, progress: { site: 'amazon', searchedKeys: 4, dueKeys: 11 } })
    expect(status.coverage).toEqual({ matched: 5, total: 50, minPercent: PRICE_CHECK_PRIORITY_SAVING_PERCENT })
  })

  test('the counts are cached for thirty seconds, while the crawler rows and the hold are read on every call', async () => {
    const later = new Date(NOW.getTime() + 2 * HOUR_MS)
    await marketStatus(later)
    for (const mock of [mocks.validOfferCounts, mocks.searchCounts, mocks.marketCoverage, mocks.loadCrawlerState, mocks.requestHold]) mock.mockClear()
    await marketStatus(new Date(later.getTime() + MARKET_STATUS_CACHE_MS - 1))
    expect(mocks.validOfferCounts).not.toHaveBeenCalled()
    expect(mocks.searchCounts).not.toHaveBeenCalled()
    expect(mocks.marketCoverage).not.toHaveBeenCalled()
    expect(mocks.loadCrawlerState).toHaveBeenCalledTimes(2)
    expect(mocks.requestHold).toHaveBeenCalledTimes(1)
    await marketStatus(new Date(later.getTime() + MARKET_STATUS_CACHE_MS))
    expect(mocks.validOfferCounts).toHaveBeenCalledTimes(1)
  })

  test('a hold set after a cached call shows as held on the next call', async () => {
    startMarketCrawlers()
    const at = new Date(NOW.getTime() + 3 * HOUR_MS)
    expect((await marketStatus(at)).kabum.state).toBe('running')
    mocks.requestHold.mockResolvedValue({ kind: 'vpn', text: 't', reason: 'VPN conectada' })
    const next = await marketStatus(new Date(at.getTime() + SECOND_MS))
    expect(next.kabum).toMatchObject({ state: 'held', holdText: 'VPN conectada' })
    expect(next.amazon).toMatchObject({ state: 'held', holdText: 'VPN conectada' })
  })

  test('a block saved after a cached call shows on the next call', async () => {
    startMarketCrawlers()
    const at = new Date(NOW.getTime() + 4 * HOUR_MS)
    await marketStatus(at)
    const blockedUntil = new Date(at.getTime() + HOUR_MS)
    mocks.loadCrawlerState.mockImplementation(async (site: CrawlerStateRow['site']) => ({ ...stateRow(site), blockedUntil, lastError: 'captcha' }))
    expect((await marketStatus(new Date(at.getTime() + SECOND_MS))).amazon).toMatchObject({ state: 'blocked', blockedUntil, lastError: 'captcha' })
  })

  test('running loops report their state, with the Amazon waiting reason from the last step', async () => {
    startMarketCrawlers()
    await vi.advanceTimersByTimeAsync(MARKET_BOOT_DELAY_MS)
    const status = await marketStatus(new Date(NOW.getTime() + 5 * HOUR_MS))
    expect(status.kabum.state).toBe('running')
    expect(status.amazon).toMatchObject({ state: 'waiting', waitingFor: 'queue_empty' })
  })

  test('a hold shows on both crawlers', async () => {
    mocks.requestHold.mockResolvedValue({ kind: 'manual', text: 't', reason: 'pausado manualmente' })
    startMarketCrawlers()
    const status = await marketStatus(new Date(NOW.getTime() + 9 * HOUR_MS))
    expect(status.kabum).toMatchObject({ state: 'held', holdText: 'pausado manualmente' })
    expect(status.amazon).toMatchObject({ state: 'held', holdText: 'pausado manualmente' })
  })
})
