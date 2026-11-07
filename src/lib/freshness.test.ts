import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS } from './constants'
import { daysBefore, hoursBefore } from './freshness'

const NOW = new Date('2026-11-04T12:00:00Z')

describe('cutoffs before now', () => {
  it('subtracts whole hours and days', () => {
    expect(hoursBefore(NOW, 12)).toEqual(new Date(NOW.getTime() - 12 * HOUR_MS))
    expect(daysBefore(NOW, 30)).toEqual(new Date(NOW.getTime() - 30 * DAY_MS))
    expect(daysBefore(NOW, 0)).toEqual(NOW)
  })
})
