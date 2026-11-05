import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS, STALE_AFTER_HOURS } from './constants'
import { daysBefore, freshSince, hoursBefore } from './freshness'

const NOW = new Date('2026-11-04T12:00:00Z')

describe('cutoffs before now', () => {
  it('subtracts whole hours and days', () => {
    expect(hoursBefore(NOW, 12)).toEqual(new Date(NOW.getTime() - 12 * HOUR_MS))
    expect(daysBefore(NOW, 30)).toEqual(new Date(NOW.getTime() - 30 * DAY_MS))
    expect(daysBefore(NOW, 0)).toEqual(NOW)
  })
  it('keeps listings fresh for STALE_AFTER_HOURS', () => {
    expect(freshSince(NOW)).toEqual(hoursBefore(NOW, STALE_AFTER_HOURS))
  })
})
