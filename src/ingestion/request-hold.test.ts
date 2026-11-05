import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { VpnState } from '@/lib/vpn-status'
import { requestHold, mlRequestHold, type HoldDeps } from './request-hold'

vi.mock('@/db/app-settings', () => ({ readHoldSettings: vi.fn() }))
vi.mock('./vpn-guard', () => ({ vpnCheck: vi.fn() }))

const NOW = new Date('2026-11-03T12:00:00Z')

beforeEach(() => {
  globalThis.__promoHoldSettingsErrorLogged = undefined
})

function deps(over: Partial<{ vpn: VpnState; requestsPaused: boolean; priceChecksPaused: boolean }> = {}, fail = false) {
  const logs: string[] = []
  const d: HoldDeps = {
    vpn: async () => over.vpn ?? 'clear',
    settings: async () => {
      if (fail) throw new Error('db down\nx')
      return { requestsPaused: over.requestsPaused ?? false, priceChecksPaused: over.priceChecksPaused ?? false }
    },
    logError: (l) => logs.push(l),
  }
  return { d, logs }
}

describe('requestHold', () => {
  test('null when nothing holds', async () => {
    expect(await requestHold(NOW, deps().d)).toBeNull()
  })

  test.each([
    [{ vpn: 'connected' }, 'vpn'],
    [{ vpn: 'error' }, 'vpn_unknown'],
    [{ vpn: 'off' }, null],
    [{ vpn: 'unknown' }, 'vpn_unknown'],
    [{ requestsPaused: true }, 'manual'],
    [{ priceChecksPaused: true }, 'price_manual'],
    [{ vpn: 'connected', requestsPaused: true }, 'vpn'],
  ] as const)('%j -> %s', async (over, kind) => {
    expect((await requestHold(NOW, deps(over).d))?.kind ?? null).toBe(kind)
  })

  test('unreadable settings are logged once across calls, and again after a good read', async () => {
    const bad = deps({}, true)
    await requestHold(NOW, bad.d)
    await requestHold(NOW, bad.d)
    expect(bad.logs).toHaveLength(1)
    await requestHold(NOW, deps().d)
    await requestHold(NOW, bad.d)
    expect(bad.logs).toHaveLength(2)
  })

  test('unreadable settings are logged and treated as not paused, the VPN still holds', async () => {
    const quiet = deps({}, true)
    expect(await requestHold(NOW, quiet.d)).toBeNull()
    expect(quiet.logs).toEqual(['settings unreadable: db down'])
    expect((await requestHold(NOW, deps({ vpn: 'connected' }, true).d))?.kind).toBe('vpn')
  })
})

test('the Mercado Livre hold ignores the price-only pause', async () => {
  expect(await mlRequestHold(NOW, deps({ priceChecksPaused: true }).d)).toBeNull()
  expect((await mlRequestHold(NOW, deps({ requestsPaused: true }).d))?.kind).toBe('manual')
})
