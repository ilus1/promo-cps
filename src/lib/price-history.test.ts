import { describe, expect, it } from 'vitest'
import { DAY_MS, HISTORY_DAYS, LIST_NEVER_PRACTICED_DAYS, LIST_NEVER_PRACTICED_RATIO } from './constants'
import type { Basis } from './domain'
import type { SegmentRow } from './drop'
import { neverPracticedList, priceHistory, type PriceHistory } from './price-history'

const NOW = new Date('2026-12-01T12:00:00Z')
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY_MS)
let nextId = 1
const seg = (priceCents: number, from: number, to: number, basis: Basis = 'none'): SegmentRow => ({
  id: nextId++, priceCents, basis, firstSeenAt: at(from), lastSeenAt: at(to),
})

describe('priceHistory', () => {
  it('is null without segments', () => {
    expect(priceHistory([], NOW)).toBeNull()
  })

  it('reports one segment as unchanged since its start', () => {
    expect(priceHistory([seg(1000, 3, 0)], NOW)).toEqual({
      segments: 1, lowestCents: 1000, highestCents: 1000, firstReadAt: at(3), currentSince: at(3),
    })
  })

  it('reports the range, the first read and the segment count', () => {
    const history = priceHistory([seg(1000, 10, 6), seg(1500, 6, 2), seg(1200, 2, 0)], NOW)
    expect(history).toEqual({ segments: 3, lowestCents: 1000, highestCents: 1500, firstReadAt: at(10), currentSince: at(2) })
  })

  it('counts only segments still inside the window, keeping the start of one that began before it', () => {
    const history = priceHistory([
      seg(900, HISTORY_DAYS + 20, HISTORY_DAYS + 5),
      seg(2000, HISTORY_DAYS + 5, HISTORY_DAYS - 2),
      seg(1500, HISTORY_DAYS - 2, 0),
    ], NOW)
    expect(history).toEqual({
      segments: 2, lowestCents: 1500, highestCents: 2000, firstReadAt: at(HISTORY_DAYS + 5), currentSince: at(HISTORY_DAYS - 2),
    })
  })

  it('keeps the start of the run at the current price across a basis-only change', () => {
    const history = priceHistory([seg(2000, 12, 9), seg(1500, 9, 6, 'none'), seg(1500, 6, 0, 'pix')], NOW)
    expect(history?.currentSince).toEqual(at(9))
  })

  it('restarts the run when the price was different in between', () => {
    const history = priceHistory([seg(1500, 12, 9), seg(2000, 9, 6), seg(1500, 6, 0)], NOW)
    expect(history?.currentSince).toEqual(at(6))
  })

  it('falls back to the current run when no segment is inside the window', () => {
    const history = priceHistory([seg(1500, HISTORY_DAYS + 9, HISTORY_DAYS + 2)], NOW)
    expect(history).toEqual({
      segments: 1, lowestCents: null, highestCents: null, firstReadAt: at(HISTORY_DAYS + 9), currentSince: at(HISTORY_DAYS + 9),
    })
  })
})

describe('neverPracticedList', () => {
  const LIST = 10000
  const history = (highestCents: number | null, firstReadDaysAgo: number): PriceHistory => ({
    segments: 2, lowestCents: 5000, highestCents, firstReadAt: at(firstReadDaysAgo), currentSince: at(1),
  })

  it('needs the highest price below the ratio of the list price', () => {
    const edge = LIST * LIST_NEVER_PRACTICED_RATIO
    expect(neverPracticedList(history(edge - 1, 40), LIST, NOW)).toBe(true)
    expect(neverPracticedList(history(edge, 40), LIST, NOW)).toBe(false)
  })

  it('needs the minimum history, to the day', () => {
    expect(neverPracticedList(history(5000, LIST_NEVER_PRACTICED_DAYS), LIST, NOW)).toBe(true)
    expect(neverPracticedList(history(5000, LIST_NEVER_PRACTICED_DAYS - 1), LIST, NOW)).toBe(false)
  })

  it('is false without history, a list price or readings in the window', () => {
    expect(neverPracticedList(null, LIST, NOW)).toBe(false)
    expect(neverPracticedList(history(5000, 40), null, NOW)).toBe(false)
    expect(neverPracticedList(history(null, 40), LIST, NOW)).toBe(false)
  })
})
