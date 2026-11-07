import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HOUR_MS, MINUTE_MS, WATCH_BOOT_DELAY_MS, WATCH_ERROR_BACKOFF_MAX_MS, WATCH_ERROR_BACKOFF_MS, WATCH_TICK_MS } from '@/lib/constants'

const mocks = vi.hoisted(() => ({
  autoRun: 'on',
  requestCheck: vi.fn(),
  monitoringCounts: vi.fn(),
  lastWatchAlert: vi.fn(),
  requestHold: vi.fn(),
  productsDueForResolve: vi.fn(),
  listingsDueForRefresh: vi.fn(),
  pagesDueForRefresh: vi.fn(),
  withAmazonBrowser: vi.fn(),
  fetchMarketPage: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ AUTO_RUN: mocks.autoRun }) }))
vi.mock('@/db/monitoring', () => ({
  requestCheck: mocks.requestCheck, monitoringCounts: mocks.monitoringCounts, lastWatchAlert: mocks.lastWatchAlert, productNames: vi.fn(async () => new Map()), removedRefs: vi.fn(async () => new Map()), mlLinksGone: vi.fn(async () => new Set()),
}))
vi.mock('@/db/watch-listings', () => ({
  listingsDueForRefresh: mocks.listingsDueForRefresh,
  pagesDueForRefresh: mocks.pagesDueForRefresh,
  recordListingError: vi.fn(),
  recordPageError: vi.fn(),
  recordPageQuotes: vi.fn(),
  recordQuote: vi.fn(),
  upsertListing: vi.fn(),
}))
vi.mock('@/db/watch-products', () => ({ markResolved: vi.fn(), productsDueForResolve: mocks.productsDueForResolve, updateProduct: vi.fn() }))
vi.mock('../auto-run', () => ({ autoRunStatus: () => ({ cycleNextRunAt: null }) }))
vi.mock('../cycle', () => ({ cycleActivity: () => ({ phase: 'idle' }) }))
vi.mock('../market/amazon-browser', () => ({ amazonPageLoader: vi.fn(), withAmazonBrowser: mocks.withAmazonBrowser }))
vi.mock('../market/http-client', () => ({ fetchMarketPage: mocks.fetchMarketPage }))
vi.mock('../request-hold', () => ({ requestHold: mocks.requestHold }))
vi.mock('./price-alerts', () => ({ checkAlerts: vi.fn(async () => 0) }))

import { requestWatchCheck, startLoop, startWatch, stopWatch, watchStatus } from './loops'
import { mlLinkFailures } from '../steps/watch-ml-pages'
import { errorBackoffMs } from './retry-backoff'

const NOW = new Date('2026-11-06T12:00:00Z')
const ID = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.autoRun = 'on'
  mocks.requestCheck.mockResolvedValue(true)
  mocks.monitoringCounts.mockResolvedValue({ products: 1, retailers: {} })
  mocks.lastWatchAlert.mockResolvedValue(null)
  mocks.requestHold.mockResolvedValue(null)
  mocks.productsDueForResolve.mockResolvedValue([])
  mocks.listingsDueForRefresh.mockResolvedValue([])
  mocks.pagesDueForRefresh.mockResolvedValue([])
})

afterEach(() => {
  stopWatch()
  vi.useRealTimers()
})

describe('errorBackoffMs', () => {
  test('doubles from one minute and caps at one hour', () => {
    expect(errorBackoffMs(1)).toBe(WATCH_ERROR_BACKOFF_MS)
    expect(errorBackoffMs(2)).toBe(2 * WATCH_ERROR_BACKOFF_MS)
    expect(errorBackoffMs(20)).toBe(WATCH_ERROR_BACKOFF_MAX_MS)
  })
})

describe('startLoop', () => {
  test('waits the boot delay, then runs a pass every tick', async () => {
    const pass = vi.fn(async () => undefined)
    const loop = startLoop({ name: 't', pass })
    await vi.advanceTimersByTimeAsync(WATCH_BOOT_DELAY_MS - 1)
    expect(pass).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(pass).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(WATCH_TICK_MS)
    expect(pass).toHaveBeenCalledTimes(2)
    loop.stop()
  })

  test('a failing pass is logged and retried after a growing backoff', async () => {
    const log = vi.fn()
    const pass = vi.fn(async () => {
      throw new Error('db down')
    })
    const loop = startLoop({ name: 'resolve', pass, bootDelayMs: 0, log })
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toHaveBeenCalledWith('[watch] resolve: db down')
    await vi.advanceTimersByTimeAsync(WATCH_ERROR_BACKOFF_MS)
    expect(pass).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(WATCH_ERROR_BACKOFF_MS)
    expect(pass).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(WATCH_ERROR_BACKOFF_MS)
    expect(pass).toHaveBeenCalledTimes(3)
    loop.stop()
  })

  test('wake cuts the sleep short, and a wake during a pass makes the next pass start at once', async () => {
    let release = () => {}
    const pass = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    const loop = startLoop({ name: 't', pass, bootDelayMs: 0, tickMs: HOUR_MS })
    await vi.advanceTimersByTimeAsync(0)
    expect(pass).toHaveBeenCalledTimes(1)
    loop.wake()
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(pass).toHaveBeenCalledTimes(2)
    release()
    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(pass).toHaveBeenCalledTimes(2)
    loop.wake()
    await vi.advanceTimersByTimeAsync(0)
    expect(pass).toHaveBeenCalledTimes(3)
    loop.stop()
    release()
  })

  test('stop ends the loop', async () => {
    const pass = vi.fn(async () => undefined)
    const loop = startLoop({ name: 't', pass, bootDelayMs: 0 })
    await vi.advanceTimersByTimeAsync(0)
    loop.stop()
    await vi.advanceTimersByTimeAsync(10 * WATCH_TICK_MS)
    expect(pass).toHaveBeenCalledTimes(1)
  })
})

describe('startWatch', () => {
  test('starts nothing when AUTO_RUN is off', async () => {
    mocks.autoRun = 'off'
    startWatch()
    expect(globalThis.__promoWatch).toBeUndefined()
    await vi.advanceTimersByTimeAsync(WATCH_BOOT_DELAY_MS + WATCH_TICK_MS)
    expect(mocks.productsDueForResolve).not.toHaveBeenCalled()
    expect((await watchStatus(NOW)).sources.every((row) => row.state === 'stopped')).toBe(true)
  })

  test('runs the resolver and the refresher once booted, and never sends a request with nothing due', async () => {
    startWatch()
    await vi.advanceTimersByTimeAsync(WATCH_BOOT_DELAY_MS)
    expect(mocks.productsDueForResolve).toHaveBeenCalled()
    expect(mocks.listingsDueForRefresh).toHaveBeenCalled()
    expect(mocks.pagesDueForRefresh).toHaveBeenCalled()
    expect(mocks.fetchMarketPage).not.toHaveBeenCalled()
    expect(mocks.withAmazonBrowser).not.toHaveBeenCalled()
  })

  test('starting again replaces the running loops', () => {
    startWatch()
    const first = globalThis.__promoWatch
    startWatch()
    expect(globalThis.__promoWatch).not.toBe(first)
  })

  test('stopping closes the Chrome pool too', async () => {
    startWatch()
    const close = vi.spyOn(globalThis.__promoWatch!.chrome, 'close')
    stopWatch()
    expect(close).toHaveBeenCalledTimes(1)
    expect(globalThis.__promoWatch).toBeUndefined()
  })
})

describe('requestWatchCheck', () => {
  test('marks the product, forgets its resolve progress and wakes the resolver', async () => {
    startWatch()
    mlLinkFailures().set(ID, 2)
    globalThis.__promoWatch?.progress.set(ID, { done: new Set(['americanas']), failures: 2, retryAt: Date.now() + 60_000 })
    expect(await requestWatchCheck(ID)).toBe(true)
    expect(mocks.requestCheck).toHaveBeenCalledWith(ID)
    expect(globalThis.__promoWatch?.progress.has(ID)).toBe(false)
    expect(mlLinkFailures().has(ID)).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.productsDueForResolve).toHaveBeenCalled()
  })

  test('an unknown product is not found', async () => {
    mocks.requestCheck.mockResolvedValue(false)
    expect(await requestWatchCheck(ID)).toBe(false)
  })
})

describe('watchStatus', () => {
  test('reads the counts, the hold and the last alert', async () => {
    startWatch()
    mocks.lastWatchAlert.mockResolvedValue({ productName: 'Fone', kind: 'target', priceCents: 100, sentAt: NOW })
    const status = await watchStatus(NOW)
    expect(status).toMatchObject({ products: 1, lastAlert: { productName: 'Fone' } })
    expect(status.sources).toHaveLength(5)
  })
})
