import { describe, expect, it } from 'vitest'
import { FIRST_CYCLE_TEXT } from './domain'
import { formatDateTime } from './format'
import { PRIORITY_CURRENT_TEXT, PRIORITY_NONE_TEXT, PRIORITY_UNSCHEDULED_TEXT, priorityMessage } from './priority-view'

const NOW = new Date('2026-11-02T22:00:00Z')
const NEXT = '2026-11-03T01:31:00Z'
const result = (over: Partial<Parameters<typeof priorityMessage>[0]> = {}) =>
  ({ prioritized: 12, cycleNextRunAt: NEXT, pause: null, running: false, ...over })

describe('priorityMessage', () => {
  it('says how many were prioritized and when the next cycle runs', () => {
    expect(priorityMessage(result(), NOW))
      .toBe(`12 cupons priorizados; o próximo ciclo começa por eles (em 3 h, ${formatDateTime(new Date(NEXT))})`)
  })

  it('uses the singular for one coupon', () => {
    expect(priorityMessage(result({ prioritized: 1 }), NOW)).toMatch(/^1 cupom priorizado; o próximo ciclo começa por ele \(/)
  })

  it('shows the pause text instead of a time', () => {
    expect(priorityMessage(result({ cycleNextRunAt: null, pause: FIRST_CYCLE_TEXT }), NOW))
      .toBe(`12 cupons priorizados; o próximo ciclo começa por eles (${FIRST_CYCLE_TEXT})`)
  })

  it('says so when nothing is scheduled', () => {
    expect(priorityMessage(result({ cycleNextRunAt: null }), NOW)).toContain(`(${PRIORITY_UNSCHEDULED_TEXT})`)
  })

  it('never shows a past time: it names the running or next cycle instead', () => {
    const expected = `12 cupons priorizados; ${PRIORITY_CURRENT_TEXT} começa por eles`
    expect(priorityMessage(result({ cycleNextRunAt: '2026-11-02T21:00:00Z' }), NOW)).toBe(expected)
    expect(priorityMessage(result({ cycleNextRunAt: '2026-11-02T22:00:00Z' }), NOW)).toBe(expected)
  })

  it('names the running or next cycle while a cycle runs, even with a future time', () => {
    expect(priorityMessage(result({ running: true }), NOW)).toBe(`12 cupons priorizados; ${PRIORITY_CURRENT_TEXT} começa por eles`)
  })

  it('a pause wins over a running cycle', () => {
    expect(priorityMessage(result({ running: true, cycleNextRunAt: null, pause: FIRST_CYCLE_TEXT }), NOW)).toContain(`(${FIRST_CYCLE_TEXT})`)
  })

  it('says no coupon matched when the count is zero', () => {
    expect(priorityMessage(result({ prioritized: 0 }), NOW)).toBe(PRIORITY_NONE_TEXT)
  })
})
