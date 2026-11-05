import { describe, expect, it } from 'vitest'
import { healthReport, type HealthInputs } from './health-view'

const BASE: HealthInputs = {
  schedulerEnabled: true,
  serverStartedAt: new Date('2026-11-03T07:00:00.000Z'),
  lastCycle: { startedAt: new Date('2026-11-03T08:00:00.000Z'), status: 'ok' },
  pause: null,
  nextRunAt: new Date('2026-11-03T11:10:00.000Z'),
  runEveryHours: 3,
  hold: null,
  market: { kabum: { state: 'running', blockedUntil: null }, amazon: { state: 'waiting', blockedUntil: null } },
}

describe('healthReport', () => {
  it('serializes dates as ISO strings', () => {
    expect(healthReport(BASE)).toEqual({
      schedulerEnabled: true,
      serverStartedAt: '2026-11-03T07:00:00.000Z',
      lastCycle: { startedAt: '2026-11-03T08:00:00.000Z', status: 'ok' },
      pause: null,
      nextRunAt: '2026-11-03T11:10:00.000Z',
      runEveryHours: 3,
      hold: null,
      market: { kabum: { state: 'running', blockedUntil: null }, amazon: { state: 'waiting', blockedUntil: null } },
    })
  })

  it('reports no last cycle when none started', () => {
    expect(healthReport({ ...BASE, lastCycle: null }).lastCycle).toBeNull()
  })

  it('keeps a running cycle with a null status', () => {
    const running = { startedAt: new Date('2026-11-03T08:00:00.000Z'), status: null }
    expect(healthReport({ ...BASE, lastCycle: running }).lastCycle).toEqual({
      startedAt: '2026-11-03T08:00:00.000Z',
      status: null,
    })
  })

  it('keeps the pause reason and a missing next run', () => {
    const report = healthReport({ ...BASE, pause: 'sessão expirada', nextRunAt: null })
    expect(report.pause).toBe('sessão expirada')
    expect(report.nextRunAt).toBeNull()
  })

  it('a hold is listed but never becomes the pause', () => {
    const hold = { kind: 'vpn', text: 'VPN da empresa conectada: desconecte para rodar', reason: 'VPN conectada' } as const
    const report = healthReport({ ...BASE, hold })
    expect(report.pause).toBeNull()
    expect(report.hold).toEqual({ kind: 'vpn', text: hold.text })
  })

  it('the scheduler pause stays as it is next to a hold', () => {
    const hold = { kind: 'manual', text: 'x', reason: 'r' } as const
    expect(healthReport({ ...BASE, pause: 'sessão expirada', hold }).pause).toBe('sessão expirada')
  })

  it('every hold kind is listed with its kind and text', () => {
    const hold = { kind: 'price_manual', text: 'Comparação pausada', reason: 'r' } as const
    expect(healthReport({ ...BASE, hold }).hold).toEqual({ kind: 'price_manual', text: 'Comparação pausada' })
  })

  it('carries each crawler state and its block end as an ISO string', () => {
    const blockedUntil = new Date('2026-11-04T18:15:00.000Z')
    const report = healthReport({ ...BASE, market: { kabum: { state: 'held', blockedUntil: null }, amazon: { state: 'blocked', blockedUntil } } })
    expect(report.market).toEqual({
      kabum: { state: 'held', blockedUntil: null },
      amazon: { state: 'blocked', blockedUntil: '2026-11-04T18:15:00.000Z' },
    })
  })

  it('reports no crawler states when the market status could not be read', () => {
    const report = healthReport({ ...BASE, market: null })
    expect(report.market).toBeNull()
    expect(report.pause).toBeNull()
    expect(report.lastCycle).toEqual({ startedAt: '2026-11-03T08:00:00.000Z', status: 'ok' })
  })

  it('a blocked crawler never becomes the scheduler pause', () => {
    const market = { kabum: { state: 'blocked', blockedUntil: new Date('2026-11-04T18:15:00.000Z') }, amazon: { state: 'stopped', blockedUntil: null } } as const
    expect(healthReport({ ...BASE, market }).pause).toBeNull()
  })
})
