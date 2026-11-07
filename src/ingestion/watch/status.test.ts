import { describe, expect, test } from 'vitest'
import type { MonitoringCounts } from '@/db/monitoring'
import { HOUR_MS, MINUTE_MS } from '@/lib/constants'
import { dayKey } from '@/lib/market/crawl-rules'
import type { RequestHold } from '@/lib/request-hold'
import type { WatchRetailer } from '@/lib/watch/types'
import { freshHealth, type SiteHealth } from './site-gate'
import { watchStatusOf, type StatusInputs } from './status'

const NOW = new Date('2026-11-06T12:00:00Z')
const VPN: RequestHold = { kind: 'vpn', text: 'VPN da empresa conectada: desconecte para rodar', reason: 'VPN conectada' }
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS)

const COUNTS: MonitoringCounts = {
  products: 3,
  retailers: {
    ml: { listings: 2, unchecked: false, oldestCheckAt: ago(2), lastCheckAt: ago(1) },
    kabum: { listings: 3, unchecked: false, oldestCheckAt: ago(4), lastCheckAt: ago(1) },
    amazon: { listings: 1, unchecked: false, oldestCheckAt: ago(1), lastCheckAt: ago(1) },
    americanas: { listings: 2, unchecked: true, oldestCheckAt: ago(1), lastCheckAt: ago(1) },
  },
}

function inputs(
  patch: Partial<StatusInputs> = {}, health: Partial<Record<WatchRetailer, Partial<SiteHealth>>> = {}, busy: WatchRetailer[] = [],
): StatusInputs {
  return {
    running: true,
    hold: null,
    health: (site) => ({ ...freshHealth(), ...health[site] }),
    busy: (site) => busy.includes(site),
    chainIdle: true,
    cycleRunning: false,
    cycleNextRunAt: new Date(NOW.getTime() + HOUR_MS),
    counts: COUNTS,
    lastAlert: null,
    refreshHours: 3,
    now: NOW,
    ...patch,
  }
}

const source = (status: ReturnType<typeof watchStatusOf>, retailer: WatchRetailer) => status.sources.find((row) => row.retailer === retailer)

describe('watchStatusOf', () => {
  test('lists every store in order with its listings and the product count', () => {
    const status = watchStatusOf(inputs())
    expect(status.products).toBe(3)
    expect(status.sources.map((row) => [row.retailer, row.listings])).toEqual([['ml', 2], ['amazon', 1], ['kabum', 3], ['americanas', 2], ['buscape', 0]])
  })

  test('a site is running while its requests are in flight, and waits otherwise', () => {
    const status = watchStatusOf(inputs({}, {}, ['kabum']))
    expect(source(status, 'kabum')).toMatchObject({ state: 'running', waitingFor: null, nextRefreshAt: ago(1) })
    expect(source(status, 'americanas')).toMatchObject({ state: 'waiting', waitingFor: null, nextRefreshAt: NOW })
    expect(source(status, 'amazon')).toMatchObject({ state: 'waiting', waitingFor: 'next_refresh', nextRefreshAt: new Date(NOW.getTime() + 2 * HOUR_MS) })
    expect(source(status, 'buscape')).toMatchObject({ state: 'waiting', waitingFor: 'next_refresh', nextRefreshAt: null })
  })

  test('ML waits for the next cycle and runs while one runs', () => {
    expect(source(watchStatusOf(inputs()), 'ml')).toMatchObject({
      state: 'waiting', waitingFor: 'ml_cycle', nextRefreshAt: new Date(NOW.getTime() + HOUR_MS), lastRequestAt: ago(1), requestsToday: 0,
    })
    expect(source(watchStatusOf(inputs({ cycleRunning: true })), 'ml')).toMatchObject({ state: 'running', waitingFor: null })
  })

  test('a store with no listings has no next refresh, ML included', () => {
    const status = watchStatusOf(inputs({ counts: { products: 1, retailers: {} } }))
    expect(status.sources.map((row) => row.nextRefreshAt)).toEqual([null, null, null, null, null])
  })

  test('a hold puts every source on hold with its short reason', () => {
    const status = watchStatusOf(inputs({ hold: VPN }, {}, ['kabum']))
    expect(status.sources.every((row) => row.state === 'held' && row.holdText === VPN.reason && row.waitingFor === null)).toBe(true)
  })

  test('without the loops every source is stopped, with nothing to wait for', () => {
    expect(watchStatusOf(inputs({ running: false })).sources.every((row) => row.state === 'stopped' && row.waitingFor === null)).toBe(true)
  })

  test('a backoff shows as blocked until its end, and an expired one does not', () => {
    const until = new Date(NOW.getTime() + 15 * MINUTE_MS)
    const status = watchStatusOf(inputs({}, { kabum: { blockedUntil: until, lastError: 'captcha' }, amazon: { blockedUntil: ago(1) } }))
    expect(source(status, 'kabum')).toMatchObject({ state: 'blocked', blockedUntil: until, lastError: 'captcha' })
    expect(source(status, 'amazon')).toMatchObject({ state: 'waiting', blockedUntil: null })
  })

  test('a Chrome source skipped for a running ML job waits for it', () => {
    const status = watchStatusOf(inputs({ chainIdle: false }, { amazon: { skipped: 'ml_busy' } }))
    expect(source(status, 'amazon')).toMatchObject({ state: 'waiting', waitingFor: 'ml_busy' })
    expect(source(watchStatusOf(inputs({}, { amazon: { skipped: 'ml_busy' } })), 'amazon')?.waitingFor).toBe('next_refresh')
  })

  test("today's requests come from the gate, and the last request falls back to the newest check", () => {
    const status = watchStatusOf(inputs({}, { kabum: { dayKey: dayKey(NOW), requestsToday: 7, lastRequestAt: ago(0.5) }, amazon: { dayKey: '2026-11-05', requestsToday: 9 } }))
    expect(source(status, 'kabum')).toMatchObject({ requestsToday: 7, lastRequestAt: ago(0.5) })
    expect(source(status, 'amazon')).toMatchObject({ requestsToday: 0, lastRequestAt: ago(1) })
  })
})
