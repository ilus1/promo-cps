import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './constants'
import { PLAN_FAILED_TEXT } from './domain'
import type { HealthReport } from './health-view'
import { staleAfterMs, watchdogDecision, watchdogState, type WatchdogState } from './watchdog-rules'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const EVERY = 3
const STALE_HOURS = 2 * EVERY + 1

function startedAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR_MS).toISOString()
}

function health(over: Partial<HealthReport> = {}): HealthReport {
  return {
    schedulerEnabled: true,
    serverStartedAt: startedAgo(1000),
    lastCycle: { startedAt: startedAgo(1), status: 'ok' },
    pause: null,
    nextRunAt: null,
    runEveryHours: EVERY,
    hold: null,
    watch: [{ retailer: 'kabum', state: 'running', blockedUntil: null }, { retailer: 'amazon', state: 'running', blockedUntil: null }],
    ...over,
  }
}

describe('staleAfterMs', () => {
  it('is twice the interval plus one hour', () => {
    expect(staleAfterMs(EVERY)).toBe(STALE_HOURS * HOUR_MS)
  })
})

describe('watchdogDecision', () => {
  it('has nothing to say for a healthy server', () => {
    const d = watchdogDecision(health(), NOW, {})
    expect(d.active).toEqual([])
    expect(d.notifications).toEqual([])
  })

  it('never notifies for blocked or stopped watch sources', () => {
    const d = watchdogDecision(health({
      watch: [{ retailer: 'kabum', state: 'blocked', blockedUntil: NOW.toISOString() }, { retailer: 'amazon', state: 'stopped', blockedUntil: null }],
    }), NOW, {})
    expect(d.active).toEqual([])
    expect(d.notifications).toEqual([])
  })

  it('flags an unreachable server', () => {
    const d = watchdogDecision('unreachable', NOW, {})
    expect(d.active).toEqual(['unreachable'])
    expect(d.notifications).toHaveLength(1)
    expect(d.notifications[0].title).toBe('Promo CPS: servidor fora do ar')
    expect(d.unknown).toEqual(['paused', 'stale', 'vpn_unknown'])
  })

  it('shows the pause reason', () => {
    const d = watchdogDecision(health({ pause: 'a sessão expirou' }), NOW, {})
    expect(d.active).toEqual(['paused'])
    expect(d.notifications[0].body).toBe('A sessão expirou')
  })

  it('leaves a paused scheduler to the pause rule even when the cycle is old', () => {
    const d = watchdogDecision(health({ pause: 'x', lastCycle: { startedAt: startedAgo(48), status: 'ok' } }), NOW, {})
    expect(d.active).toEqual(['paused'])
  })

  it('does not flag a cycle exactly at the limit', () => {
    const d = watchdogDecision(health({ lastCycle: { startedAt: startedAgo(STALE_HOURS), status: 'ok' } }), NOW, {})
    expect(d.active).toEqual([])
  })

  it('flags a cycle one millisecond past the limit', () => {
    const startedAt = new Date(NOW.getTime() - STALE_HOURS * HOUR_MS - 1).toISOString()
    const d = watchdogDecision(health({ lastCycle: { startedAt, status: 'ok' } }), NOW, {})
    expect(d.active).toEqual(['stale'])
    expect(d.notifications[0].body).toContain('há 7 h')
  })

  it('scales the limit with the interval', () => {
    const lastCycle = { startedAt: startedAgo(STALE_HOURS), status: 'ok' }
    expect(watchdogDecision(health({ lastCycle, runEveryHours: 1 }), NOW, {}).active).toEqual(['stale'])
  })

  it('does not flag a running cycle', () => {
    const running = { startedAt: startedAgo(100), status: null }
    expect(watchdogDecision(health({ lastCycle: running }), NOW, {}).active).toEqual([])
  })

  it('does not flag an old cycle while the server is younger than the limit', () => {
    const old = { startedAt: startedAgo(100), status: 'ok' }
    const d = watchdogDecision(health({ lastCycle: old, serverStartedAt: startedAgo(STALE_HOURS) }), NOW, {})
    expect(d.active).toEqual([])
  })

  it('flags an old cycle once the server is older than the limit', () => {
    const old = { startedAt: startedAgo(100), status: 'ok' }
    const serverStartedAt = new Date(NOW.getTime() - STALE_HOURS * HOUR_MS - 1).toISOString()
    expect(watchdogDecision(health({ lastCycle: old, serverStartedAt }), NOW, {}).active).toEqual(['stale'])
  })

  it('treats a planning failure as no pause', () => {
    const old = { startedAt: startedAgo(100), status: 'ok' }
    expect(watchdogDecision(health({ pause: PLAN_FAILED_TEXT }), NOW, {}).active).toEqual([])
    expect(watchdogDecision(health({ pause: PLAN_FAILED_TEXT, lastCycle: old }), NOW, {}).active).toEqual(['stale'])
  })

  it('ignores staleness with the scheduler off or no cycle yet', () => {
    const old = { startedAt: startedAgo(100), status: 'ok' }
    expect(watchdogDecision(health({ lastCycle: old, schedulerEnabled: false }), NOW, {}).active).toEqual([])
    expect(watchdogDecision(health({ lastCycle: null }), NOW, {}).active).toEqual([])
  })

  it('stays quiet for a problem notified under a day ago', () => {
    const previous: WatchdogState = { unreachable: new Date(NOW.getTime() - 24 * HOUR_MS + 1).toISOString() }
    const d = watchdogDecision('unreachable', NOW, previous)
    expect(d.active).toEqual(['unreachable'])
    expect(d.notifications).toEqual([])
  })

  it('notifies again after exactly a day', () => {
    const previous: WatchdogState = { unreachable: new Date(NOW.getTime() - 24 * HOUR_MS).toISOString() }
    expect(watchdogDecision('unreachable', NOW, previous).notifications).toHaveLength(1)
  })

  it('notifies when the stored time is unreadable', () => {
    expect(watchdogDecision('unreachable', NOW, { unreachable: 'lixo' }).notifications).toHaveLength(1)
  })
})

describe('watchdogState', () => {
  const earlier = '2026-11-03T06:00:00.000Z'

  it('records the time of each sent notification', () => {
    const d = watchdogDecision('unreachable', NOW, {})
    expect(watchdogState({}, d, ['unreachable'], NOW)).toEqual({ unreachable: NOW.toISOString() })
  })

  it('records nothing for a notification that failed to send', () => {
    const d = watchdogDecision('unreachable', NOW, {})
    expect(watchdogState({}, d, [], NOW)).toEqual({})
  })

  it('keeps the old time of a due problem whose send failed', () => {
    const previous: WatchdogState = { paused: '2026-11-02T06:00:00.000Z' }
    const d = watchdogDecision(health({ pause: 'x' }), NOW, previous)
    expect(d.notifications).toHaveLength(1)
    expect(watchdogState(previous, d, [], NOW)).toEqual(previous)
  })

  it('keeps the old time of an active problem that was not due', () => {
    const previous: WatchdogState = { paused: earlier }
    const d = watchdogDecision(health({ pause: 'x' }), NOW, previous)
    expect(watchdogState(previous, d, [], NOW)).toEqual({ paused: earlier })
  })

  it('forgets a cleared problem', () => {
    const previous: WatchdogState = { paused: earlier }
    const d = watchdogDecision(health(), NOW, previous)
    expect(watchdogState(previous, d, [], NOW)).toEqual({})
  })

  it('keeps pause and stale while the server is unreachable', () => {
    const previous: WatchdogState = { paused: earlier, stale: earlier, unreachable: earlier }
    const d = watchdogDecision('unreachable', NOW, previous)
    expect(watchdogState(previous, d, [], NOW)).toEqual(previous)
  })

  it('forgets unreachable once the server answers', () => {
    const previous: WatchdogState = { unreachable: earlier, paused: earlier }
    const d = watchdogDecision(health({ pause: 'x' }), NOW, previous)
    expect(watchdogState(previous, d, [], NOW)).toEqual({ paused: earlier })
  })
})

describe('holds', () => {
  const old = { startedAt: startedAgo(STALE_HOURS + 5), status: 'ok' }

  it.each(['vpn', 'manual'] as const)('a %s hold raises no problem, even when the last cycle is stale', (kind) => {
    const d = watchdogDecision(health({ lastCycle: old, hold: { kind, text: 'x' } }), NOW, {})
    expect(d.active).toEqual([])
    expect(d.notifications).toEqual([])
  })

  it('the price-only pause does not silence a stale runner', () => {
    expect(watchdogDecision(health({ lastCycle: old, hold: { kind: 'price_manual', text: 'x' } }), NOW, {}).active).toEqual(['stale'])
  })

  it('staleness is reported again once the hold lifts', () => {
    expect(watchdogDecision(health({ lastCycle: old, hold: null }), NOW, {}).active).toEqual(['stale'])
  })

  it('a report from an older server without the hold field still works', () => {
    const legacy: Partial<HealthReport> = health({ lastCycle: old })
    delete legacy.hold
    expect(watchdogDecision(legacy as HealthReport, NOW, {}).active).toEqual(['stale'])
  })

  it('a real scheduler pause is still reported next to a hold', () => {
    const d = watchdogDecision(health({ pause: 'sessão expirada', hold: { kind: 'vpn', text: 'x' } }), NOW, {})
    expect(d.active).toEqual(['paused'])
  })
})

describe('an unverifiable VPN', () => {
  const unknown = { kind: 'vpn_unknown', text: 'Não foi possível verificar a VPN: tentando de novo' } as const

  it('raises its own problem with its own text', () => {
    const d = watchdogDecision(health({ hold: unknown }), NOW, {})
    expect(d.active).toEqual(['vpn_unknown'])
    expect(d.notifications).toEqual([{
      id: 'vpn_unknown',
      title: expect.stringContaining('VPN não verificada'),
      body: 'Não foi possível verificar a VPN: nada roda até a verificação voltar',
    }])
  })

  it('notifies when it appears, then once a day', () => {
    const sent = new Date(NOW.getTime() - HOUR_MS).toISOString()
    expect(watchdogDecision(health({ hold: unknown }), NOW, { vpn_unknown: sent }).notifications).toEqual([])
    const old = new Date(NOW.getTime() - 25 * HOUR_MS).toISOString()
    expect(watchdogDecision(health({ hold: unknown }), NOW, { vpn_unknown: old }).notifications).toHaveLength(1)
  })

  it('a real VPN hold and a manual hold stay silent', () => {
    for (const kind of ['vpn', 'manual'] as const) {
      expect(watchdogDecision(health({ hold: { kind, text: 'x' } }), NOW, {}).active).toEqual([])
    }
  })

  it('the problem clears once the VPN can be checked again', () => {
    const sent = NOW.toISOString()
    const decision = watchdogDecision(health({ hold: null }), NOW, { vpn_unknown: sent })
    expect(decision.active).toEqual([])
    expect(watchdogState({ vpn_unknown: sent }, decision, [], NOW).vpn_unknown).toBeUndefined()
  })

  it('is kept while the server is unreachable', () => {
    const sent = NOW.toISOString()
    const decision = watchdogDecision('unreachable', NOW, { vpn_unknown: sent })
    expect(watchdogState({ vpn_unknown: sent }, decision, [], NOW).vpn_unknown).toBe(sent)
  })
})

describe('the last hold seen', () => {
  const vpn = { kind: 'vpn', text: 'x' } as const
  const longAgo = { startedAt: startedAgo(10 + STALE_HOURS), status: 'ok' }

  it('is recorded while a hold is active and kept after it lifts', () => {
    const during = watchdogDecision(health({ lastCycle: longAgo, hold: vpn }), NOW, {})
    expect(during.holdSeen).toBe(true)
    const state = watchdogState({}, during, [], NOW)
    expect(state.holdSeenAt).toBe(NOW.toISOString())
    const after = watchdogDecision(health({ lastCycle: longAgo, hold: null }), new Date(NOW.getTime() + 60_000), state)
    expect(after.holdSeen).toBe(false)
    expect(watchdogState(state, after, [], new Date(NOW.getTime() + 60_000)).holdSeenAt).toBe(NOW.toISOString())
  })

  it('a report right after a 10 h hold is not stale', () => {
    const state = { holdSeenAt: new Date(NOW.getTime() - 60_000).toISOString() }
    const server = startedAgo(1000)
    expect(watchdogDecision(health({ lastCycle: longAgo, serverStartedAt: server, hold: null }), NOW, state).active).toEqual([])
  })

  it('without a recent hold the same report is stale', () => {
    expect(watchdogDecision(health({ lastCycle: longAgo, hold: null }), NOW, {}).active).toEqual(['stale'])
  })

  it('stale returns once the staleness window has passed since the hold', () => {
    const state = { holdSeenAt: new Date(NOW.getTime() - (STALE_HOURS * HOUR_MS + 1)).toISOString() }
    expect(watchdogDecision(health({ lastCycle: longAgo, hold: null }), NOW, state).active).toEqual(['stale'])
  })

  it('a price-only pause does not count as a runner hold', () => {
    expect(watchdogDecision(health({ lastCycle: longAgo, hold: { kind: 'price_manual', text: 'x' } }), NOW, {}).holdSeen).toBe(false)
  })

  it('an unreadable stored time is ignored', () => {
    expect(watchdogDecision(health({ lastCycle: longAgo, hold: null }), NOW, { holdSeenAt: 'garbage' }).active).toEqual(['stale'])
  })
})
