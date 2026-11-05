import { expect, test } from 'vitest'
import { FIRST_CYCLE_TEXT, PLAN_FAILED_TEXT, SESSION_EXPIRED_TEXT } from './domain'
import { AUTO_RUN_OFF_TEXT, AUTO_RUN_RUNNING_TEXT, AUTO_RUN_UNSCHEDULED_TEXT, autoRunView } from './auto-run-view'

const now = new Date('2026-11-02T12:00:00Z')

test('off shows the disabled text', () => {
  expect(autoRunView({ enabled: false, running: false, nextRunAt: null, cycleNextRunAt: null, pause: null }, now).detail).toBe(AUTO_RUN_OFF_TEXT)
})

test('a pause shows its reason, capitalized, over any next time', () => {
  expect(autoRunView({ enabled: true, running: false, nextRunAt: null, cycleNextRunAt: null, pause: FIRST_CYCLE_TEXT }, now).detail).toBe(FIRST_CYCLE_TEXT)
  const view = autoRunView({ enabled: true, running: false, nextRunAt: now, cycleNextRunAt: null, pause: SESSION_EXPIRED_TEXT }, now)
  expect(view.tone).toBe('badge-warn')
  expect(view.detail.startsWith('Sessão')).toBe(true)
})

test('a next time shows an absolute and a relative future time', () => {
  const view = autoRunView({ enabled: true, running: false, nextRunAt: new Date('2026-11-02T14:30:00Z'), cycleNextRunAt: null, pause: null }, now)
  expect(view.detail).toContain('(em 2 h)')
  expect(view.detail).toContain('11:30')
})

test('enabled with nothing planned says so', () => {
  expect(autoRunView({ enabled: true, running: false, nextRunAt: null, cycleNextRunAt: null, pause: null }, now).detail).toBe(AUTO_RUN_UNSCHEDULED_TEXT)
})

test('a tick in flight shows running instead of a stale next time', () => {
  const view = autoRunView({ enabled: true, running: true, nextRunAt: new Date('2026-11-02T10:00:00Z'), cycleNextRunAt: null, pause: null }, now)
  expect(view.detail).toBe(AUTO_RUN_RUNNING_TEXT)
})

test('a planning failure is shown as a failure, not as nothing scheduled', () => {
  const view = autoRunView({ enabled: true, running: false, nextRunAt: null, cycleNextRunAt: null, pause: PLAN_FAILED_TEXT }, now)
  expect(view.label).toBe('Com falha')
  expect(view.detail).toBe(PLAN_FAILED_TEXT)
})
