import { describe, expect, test, vi } from 'vitest'
import { PRICE_CHECK_ALERT_ITEMS, PRICE_CHECK_ALERT_ITEMS_TOTAL } from '@/lib/constants'
import type { DesktopNotification } from '@/lib/desktop-notify'
import type { CheckItem } from '@/lib/price-check-rules'
import type { Run } from '@/db/schema'
import { announce, notifyStatus, type AnnounceDeps } from './announce'

const item = (id: string, productId: string | null = null): CheckItem => ({ id, productId, title: id, finalCents: 100, showsSaving: true })
const note = (title: string): DesktopNotification => ({ title, body: '', url: '' })
const run = (kind: Run['kind'], status: Run['status']) => ({ kind, status, startedAt: new Date('2026-11-03T12:00:00Z') }) as Run

function harness(overrides: Partial<AnnounceDeps> = {}) {
  const events: string[] = []
  const deps: AnnounceDeps = {
    sessionAlert: async () => note('session'),
    healthAlert: () => note('health'),
    notify: (n) => events.push(`notify:${n.title}`),
    digestNotification: (d) => note(`digest:${d.alertName}`),
    alertCandidates: vi.fn(async () => [item('alert1')]),
    runChecks: vi.fn(async (items: readonly CheckItem[]) => {
      events.push(`checks:${items.map((i) => i.id).join(',')}`)
    }),
    collectDigests: vi.fn(async () => {
      events.push('collect')
      return [{ alertName: 'A', count: 1, samples: [], url: '' }]
    }),
    now: () => new Date('2026-11-03T12:30:00Z'),
    ...overrides,
  }
  return { deps, events }
}

describe('a finished cycle', () => {
  test('alert checks, then the digests', async () => {
    const { deps, events } = harness()
    await announce(run('cycle', 'ok'), deps)
    expect(events).toEqual(['checks:alert1', 'collect', 'notify:digest:A'])
  })

  test('the alert step asks for the per-alert and total limits and checks exactly those candidates', async () => {
    const { deps } = harness()
    await announce(run('cycle', 'partial'), deps)
    expect(deps.alertCandidates).toHaveBeenCalledWith(
      new Date('2026-11-03T12:00:00Z'), new Date('2026-11-03T12:30:00Z'), PRICE_CHECK_ALERT_ITEMS, PRICE_CHECK_ALERT_ITEMS_TOTAL,
    )
    expect(vi.mocked(deps.runChecks).mock.calls[0]).toEqual([[item('alert1')]])
  })
})

test('a finished Busca run checks alert candidates too', async () => {
  const { deps, events } = harness()
  await announce(run('search', 'ok'), deps)
  expect(events).toEqual(['checks:alert1', 'collect', 'notify:digest:A'])
})

test.each([
  run('cycle', 'failed'), run('cycle', 'blocked'), run('search', 'failed'), run('login', 'logged_in'),
])('a $kind run with status $status does no price checks but still sends digests', async (r) => {
  const { deps, events } = harness()
  await announce(r, deps)
  expect(events).toEqual(['collect', 'notify:digest:A'])
  expect(deps.runChecks).not.toHaveBeenCalled()
})

test('a failing alert check is logged and does not stop the digests', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { deps, events } = harness({ alertCandidates: vi.fn(async () => { throw new Error('db down') }) })
  await announce(run('cycle', 'ok'), deps)
  expect(events).toEqual(['collect', 'notify:digest:A'])
  expect(error).toHaveBeenCalledWith('[market] alertas failed:', 'db down')
  error.mockRestore()
})

describe('notifyStatus', () => {
  test('sends the session then the health notification', async () => {
    const { deps, events } = harness()
    await notifyStatus(run('cycle', 'ok'), deps)
    expect(events).toEqual(['notify:session', 'notify:health'])
    expect(deps.runChecks).not.toHaveBeenCalled()
  })

  test('skips what is absent', async () => {
    const { deps, events } = harness({ sessionAlert: async () => null, healthAlert: () => null })
    await notifyStatus(run('login', 'logged_in'), deps)
    expect(events).toEqual([])
  })
})
