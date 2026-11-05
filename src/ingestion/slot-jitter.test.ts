import { expect, test } from 'vitest'
import { MINUTE_MS, SCHEDULE_JITTER_MINUTES } from '@/lib/constants'
import { slotJitterMs } from './slot-jitter'

const start = new Date('2026-10-01T09:00:00Z')

test('a never-run cycle has no offset', () => {
  expect(slotJitterMs(null, 3)).toBe(0)
})

test('the offset is the same for the same slot, and within the window', () => {
  const offset = slotJitterMs(start, 3)
  expect(slotJitterMs(new Date(start), 3)).toBe(offset)
  expect(Math.abs(offset)).toBeLessThanOrEqual(SCHEDULE_JITTER_MINUTES * MINUTE_MS)
})

test('different slots spread over the window', () => {
  const offsets = Array.from({ length: 50 }, (_, i) => slotJitterMs(new Date(start.getTime() + i * 3 * 60 * MINUTE_MS), 3))
  expect(new Set(offsets).size).toBeGreaterThan(30)
  expect(Math.min(...offsets)).toBeLessThan(-SCHEDULE_JITTER_MINUTES * MINUTE_MS / 2)
  expect(Math.max(...offsets)).toBeGreaterThan(SCHEDULE_JITTER_MINUTES * MINUTE_MS / 2)
})
