import { describe, expect, it, test, vi } from 'vitest'
import type { DesktopNotification } from '@/lib/desktop-notify'
import type { Run } from '@/db/schema'
import { notifyStatus, sessionAlertFor, type AnnounceDeps } from './announce'

const BASE = 'http://127.0.0.1:8510'
const note = (title: string): DesktopNotification => ({ title, body: '', url: '' })
const run = (kind: Run['kind'], status: Run['status']) => ({ kind, status, startedAt: new Date('2026-11-03T12:00:00Z') }) as Run

function harness(overrides: Partial<AnnounceDeps> = {}) {
  const events: string[] = []
  const deps: AnnounceDeps = {
    sessionAlert: async () => note('session'),
    healthAlert: () => note('health'),
    notify: (n) => events.push(`notify:${n.title}`),
    ...overrides,
  }
  return { deps, events }
}

describe('notifyStatus', () => {
  test('sends the session then the health notification', async () => {
    const { deps, events } = harness()
    await notifyStatus(run('cycle', 'ok'), deps)
    expect(events).toEqual(['notify:session', 'notify:health'])
  })

  test('skips what is absent', async () => {
    const { deps, events } = harness({ sessionAlert: async () => null, healthAlert: () => null })
    await notifyStatus(run('login', 'logged_in'), deps)
    expect(events).toEqual([])
  })
})

describe('sessionAlertFor', () => {
  const finished = (status: string | null) => ({ kind: 'cycle' as const, status: status as never, error: 'x', startedAt: new Date(0) })
  const previously = (status: string | null) => vi.fn(async () => status as never)

  it('notifies a problem the previous run did not have, including a first run', async () => {
    expect((await sessionAlertFor(finished('blocked'), previously('ok'), BASE))?.title).toBe('Promo CPS: acesso bloqueado pelo Mercado Livre')
    expect(await sessionAlertFor(finished('session_expired'), previously(null), BASE)).not.toBeNull()
    expect((await sessionAlertFor(finished('failed'), previously('blocked'), BASE))?.title).toBe('Promo CPS: o ciclo falhou')
  })

  it('stays quiet when the problem repeats', async () => {
    expect(await sessionAlertFor(finished('blocked'), previously('blocked'), BASE)).toBeNull()
  })

  it('healthy runs never look up the previous run', async () => {
    const load = previously('blocked')
    expect(await sessionAlertFor(finished('ok'), load, BASE)).toBeNull()
    expect(await sessionAlertFor(finished('partial'), load, BASE)).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('looks the previous run up before the current one started', async () => {
    const load = previously('ok')
    await sessionAlertFor(finished('blocked'), load, BASE)
    expect(load).toHaveBeenCalledWith('cycle', new Date(0))
  })
})
