import { beforeEach, expect, test, vi } from 'vitest'
import { loginDisplay } from '@/ingestion/login-display'
import type { Run } from './schema'
import { accountRuns } from './request-runs'

const { lastRun, lastStatusRun, lastWorkedAccountRun, lastWorkedCycleRun, lastExpiredAccountRun } = vi.hoisted(() => ({
  lastRun: vi.fn(), lastStatusRun: vi.fn(), lastWorkedAccountRun: vi.fn(), lastWorkedCycleRun: vi.fn(), lastExpiredAccountRun: vi.fn(),
}))
vi.mock('./runs', () => ({ lastRun, lastStatusRun, lastWorkedAccountRun, lastWorkedCycleRun, lastExpiredAccountRun }))

const run = (kind: string, status: string, time: string) => (
  { kind, status, startedAt: new Date(`2026-11-02T${time}:00Z`), finishedAt: null, error: null } as unknown as Run
)

beforeEach(() => {
  vi.clearAllMocks()
  lastRun.mockResolvedValue(undefined)
  lastStatusRun.mockResolvedValue(undefined)
})

test('the UI session state follows cycles only: expired, then a Busca ok, still shows expired', async () => {
  lastWorkedAccountRun.mockResolvedValue(run('search', 'ok', '11:00'))
  lastWorkedCycleRun.mockResolvedValue(run('cycle', 'ok', '08:00'))
  lastExpiredAccountRun.mockResolvedValue(run('cycle', 'session_expired', '10:00'))
  const { workedCycle, expiredRun, login } = await accountRuns()
  expect(loginDisplay({ state: 'idle', error: null }, login, workedCycle, expiredRun)).toEqual({ state: 'session_expired', error: null })
})

test('expired, then a cycle ok, shows the session active', async () => {
  lastWorkedCycleRun.mockResolvedValue(run('cycle', 'ok', '11:00'))
  lastWorkedAccountRun.mockResolvedValue(run('cycle', 'ok', '11:00'))
  lastExpiredAccountRun.mockResolvedValue(run('cycle', 'session_expired', '10:00'))
  const { workedCycle, expiredRun, login } = await accountRuns()
  expect(loginDisplay({ state: 'idle', error: null }, login, workedCycle, expiredRun).state).toBe('session_active')
})
