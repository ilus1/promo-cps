import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MINUTE_MS, WATCH_CHROME_INTERVAL_MS, WATCH_HTTP_INTERVAL_MS, WATCH_HTTP_JITTER_MS, WATCH_IDLE_POLL_MS } from '@/lib/constants'
import type { RequestHold } from '@/lib/request-hold'
import type { SourcePage } from '@/lib/watch/types'
import type { FetchedPage } from '../market/fetched-page'
import { createSiteGate, freshHealth, isSkipped, type GateDeps, type SiteHealth, type WatchSite } from './site-gate'

const NOW = new Date('2026-11-06T12:00:00Z')
const VPN: RequestHold = { kind: 'vpn', text: 'VPN', reason: 'VPN conectada' }
const PRICE_PAUSE: RequestHold = { kind: 'price_manual', text: 'pausa', reason: 'comparação pausada manualmente' }
const OK_PAGE: FetchedPage = { status: 200, html: 'ok' }

let clock: number
let hold: RequestHold | null
let idle: boolean
let sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>
let logLine: ReturnType<typeof vi.fn<(line: string) => void>>
let deps: GateDeps

function okParse(page: FetchedPage): SourcePage<string> {
  return { kind: 'ok', value: page.html }
}

function kindParse(kind: 'wall' | 'unknown' | 'missing' | 'empty') {
  return (): SourcePage<string> => ({ kind, reason: kind })
}

function gate(states?: Map<WatchSite, SiteHealth>) {
  return createSiteGate(deps, states)
}

beforeEach(() => {
  clock = NOW.getTime()
  hold = null
  idle = true
  sleep = vi.fn(async (ms: number) => {
    clock += ms
  })
  logLine = vi.fn()
  deps = { now: () => new Date(clock), sleep, hold: async () => hold, idle: () => idle, random: () => 0, log: logLine }
})

describe('closed sites send nothing', () => {
  test.each([[VPN], [PRICE_PAUSE]])('any hold skips the request: %j', async (active) => {
    hold = active
    const send = vi.fn(async () => OK_PAGE)
    const result = await gate().request('americanas', 'http', send, okParse)
    expect(result).toEqual({ kind: 'skipped', reason: 'held' })
    expect(send).not.toHaveBeenCalled()
  })

  test('a chrome request waits for the ML chain to be idle, and the status remembers why', async () => {
    idle = false
    const send = vi.fn(async () => OK_PAGE)
    const sites = gate()
    expect(await sites.request('amazon', 'chrome', send, okParse)).toEqual({ kind: 'skipped', reason: 'ml_busy' })
    expect(send).not.toHaveBeenCalled()
    expect(sites.health('amazon').skipped).toBe('ml_busy')
    idle = true
    await sites.request('amazon', 'chrome', send, okParse)
    expect(sites.health('amazon').skipped).toBeNull()
  })

  test('an http request ignores the ML chain', async () => {
    idle = false
    const send = vi.fn(async () => OK_PAGE)
    expect(await gate().request('kabum', 'http', send, okParse)).toEqual({ kind: 'ok', value: 'ok' })
  })

  test('a blocked site is skipped until its backoff ends', async () => {
    const states = new Map([['buscape' as WatchSite, { ...freshHealth(), blockedUntil: new Date(clock + MINUTE_MS) }]])
    const send = vi.fn(async () => OK_PAGE)
    const sites = gate(states)
    expect(await sites.request('buscape', 'http', send, okParse)).toEqual({ kind: 'skipped', reason: 'blocked' })
    clock += MINUTE_MS + 1
    expect(await sites.request('buscape', 'http', send, okParse)).toEqual({ kind: 'ok', value: 'ok' })
  })

  test('a hold that starts during the pace wait still skips the request', async () => {
    const sites = gate()
    await sites.request('kabum', 'http', async () => OK_PAGE, okParse)
    sleep.mockImplementationOnce(async (ms: number) => {
      clock += ms
      hold = VPN
    })
    const send = vi.fn(async () => OK_PAGE)
    expect(await sites.request('kabum', 'http', send, okParse)).toEqual({ kind: 'skipped', reason: 'held' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('pace', () => {
  test('requests to one site are spaced by the transport interval plus jitter', async () => {
    deps.random = () => 0.5
    const sites = gate()
    await sites.request('americanas', 'http', async () => OK_PAGE, okParse)
    await sites.request('americanas', 'http', async () => OK_PAGE, okParse)
    expect(sleep).toHaveBeenCalledWith(WATCH_HTTP_INTERVAL_MS + Math.floor(0.5 * WATCH_HTTP_JITTER_MS))
  })

  test('chrome requests use the slower pace, waited in short slices', async () => {
    const sites = gate()
    await sites.request('amazon', 'chrome', async () => OK_PAGE, okParse)
    await sites.request('amazon', 'chrome', async () => OK_PAGE, okParse)
    const slept = sleep.mock.calls.map(([ms]) => ms)
    expect(slept.reduce((total, ms) => total + ms, 0)).toBe(WATCH_CHROME_INTERVAL_MS)
    expect(Math.max(...slept)).toBe(WATCH_IDLE_POLL_MS)
  })

  test('an ML job that starts during the chrome pace wait skips the request at once', async () => {
    const sites = gate()
    await sites.request('amazon', 'chrome', async () => OK_PAGE, okParse)
    sleep.mockImplementation(async (ms: number) => {
      clock += ms
      if (sleep.mock.calls.length === 3) idle = false
    })
    const send = vi.fn(async () => OK_PAGE)
    expect(await sites.request('amazon', 'chrome', send, okParse)).toEqual({ kind: 'skipped', reason: 'ml_busy' })
    expect(send).not.toHaveBeenCalled()
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  test('different sites do not wait for each other', async () => {
    const sites = gate()
    await sites.request('americanas', 'http', async () => OK_PAGE, okParse)
    await sites.request('buscape', 'http', async () => OK_PAGE, okParse)
    expect(sleep).not.toHaveBeenCalled()
  })

  test('concurrent requests to one site run one at a time', async () => {
    const sites = gate()
    const order: string[] = []
    let release = () => {}
    const first = sites.request('kabum', 'http', () => new Promise<FetchedPage>((resolve) => {
      order.push('first sent')
      release = () => resolve(OK_PAGE)
    }), okParse)
    const second = sites.request('kabum', 'http', async () => {
      order.push('second sent')
      return OK_PAGE
    }, okParse)
    await vi.waitFor(() => expect(order).toEqual(['first sent']))
    expect(sites.busy('kabum')).toBe(true)
    expect(sites.busy('amazon')).toBe(false)
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['first sent', 'second sent'])
    expect(sites.busy('kabum')).toBe(false)
  })
})

describe('health', () => {
  test('a wall blocks the site for 15 minutes and logs it', async () => {
    const sites = gate()
    const result = await sites.request('amazon', 'chrome', async () => OK_PAGE, kindParse('wall'))
    expect(result).toEqual({ kind: 'wall', reason: 'wall' })
    expect(sites.health('amazon').blockedUntil).toEqual(new Date(clock + 15 * MINUTE_MS))
    expect(sites.health('amazon').lastError).toBe('wall')
    expect(logLine).toHaveBeenCalledWith(expect.stringContaining('amazon: blocked until'))
  })

  test('three unknown pages in a row block the site, and a good page resets the streak', async () => {
    const sites = gate()
    await sites.request('kabum', 'http', async () => OK_PAGE, kindParse('unknown'))
    await sites.request('kabum', 'http', async () => OK_PAGE, kindParse('unknown'))
    await sites.request('kabum', 'http', async () => OK_PAGE, okParse)
    await sites.request('kabum', 'http', async () => OK_PAGE, kindParse('unknown'))
    expect(sites.health('kabum').blockedUntil).toBeNull()
    await sites.request('kabum', 'http', async () => OK_PAGE, kindParse('unknown'))
    await sites.request('kabum', 'http', async () => OK_PAGE, kindParse('unknown'))
    expect(sites.health('kabum').blockedUntil).not.toBeNull()
  })

  test('a missing or empty page neither blocks nor clears the last error', async () => {
    const sites = gate()
    await sites.request('kabum', 'http', async () => OK_PAGE, kindParse('unknown'))
    await sites.request('kabum', 'http', async () => OK_PAGE, kindParse('missing'))
    await sites.request('kabum', 'http', async () => OK_PAGE, kindParse('empty'))
    expect(sites.health('kabum')).toMatchObject({ blockedUntil: null, lastError: 'unknown', unknownStreak: 1 })
  })

  test('a thrown send is an unknown page with the network reason', async () => {
    const result = await gate().request('buscape', 'http', async () => {
      throw new Error('ECONNRESET')
    }, (page) => (page.status === 0 ? { kind: 'unknown', reason: 'sem resposta' } : okParse(page)))
    expect(result).toEqual({ kind: 'unknown', reason: 'sem resposta: ECONNRESET' })
  })

  test('a parser that throws gives an unknown page instead of breaking the loop', async () => {
    const result = await gate().request('buscape', 'http', async () => OK_PAGE, () => {
      throw new Error('boom')
    })
    expect(result.kind).toBe('unknown')
    expect(isSkipped(result)).toBe(false)
  })

  test('requests are counted per day', async () => {
    const sites = gate()
    await sites.request('americanas', 'http', async () => OK_PAGE, okParse)
    await sites.request('americanas', 'http', async () => OK_PAGE, okParse)
    expect(sites.health('americanas')).toMatchObject({ requestsToday: 2, lastRequestAt: new Date(clock) })
    clock += 24 * 60 * MINUTE_MS
    await sites.request('americanas', 'http', async () => OK_PAGE, okParse)
    expect(sites.health('americanas').requestsToday).toBe(1)
  })
})
