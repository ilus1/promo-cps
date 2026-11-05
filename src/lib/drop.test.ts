import { describe, expect, it } from 'vitest'
import { DAY_MS, HISTORY_DAYS, HISTORY_MIN_DAYS, MIN_DROP_RATIO } from './constants'
import type { Basis } from './domain'
import { dropForSegments, dropRatio, splitOpenSegment, type Segment } from './drop'

const now = new Date('2026-11-30T12:00:00Z')
const THOUSAND_REAIS_CENTS = 100_000
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY_MS)
const seg = (priceCents: number, from: number, to: number, basis: Basis = 'none'): Segment => ({
  priceCents, basis, firstSeenAt: daysAgo(from), lastSeenAt: daysAgo(to),
})
const row = (id: number, priceCents: number, from: number, to: number, basis: Basis = 'none') => ({
  id, ...seg(priceCents, from, to, basis),
})

describe('dropRatio', () => {
  it('null without 7 days of history', () => {
    expect(dropRatio(seg(100, 3, 0), [seg(120, 5, 3)], now)).toBeNull()
  })
  it('null for a brand-new item first seen in the future', () => {
    expect(dropRatio(seg(100, -1, -1), [], now)).toBeNull()
  })
  it('drop below every earlier price in the window', () => {
    expect(dropRatio(seg(90, 2, 0), [seg(100, 20, 10), seg(120, 10, 2)], now)).toBeCloseTo(0.1, 5)
  })
  it('stays a drop while the new low holds', () => {
    expect(dropRatio(seg(90, 6, 0), [seg(100, 20, 6)], now)).toBeCloseTo(0.1, 5)
  })
  it('zero when equal to the earlier low', () => {
    expect(dropRatio(seg(100, 1, 0), [seg(100, 20, 10), seg(120, 10, 1)], now)).toBe(0)
  })
  it('zero when above the earlier low', () => {
    expect(dropRatio(seg(130, 1, 0), [seg(100, 20, 1)], now)).toBe(0)
  })
  it('zero when the price held 25 days and the lower price ended before the window', () => {
    expect(dropRatio(seg(100, 25, 0), [seg(50, 60, 40)], now)).toBe(0)
  })
  it('null when an item reappears after a gap at half the price', () => {
    expect(dropRatio(seg(50, 2, 0), [seg(100, 60, 40)], now)).toBeNull()
  })
  it('zero when the price never changed in 30 days', () => {
    expect(dropRatio(seg(100, 40, 0), [], now)).toBe(0)
  })
  it('zero when a new item held one price for 10 days', () => {
    expect(dropRatio(seg(100, 10, 0), [], now)).toBe(0)
  })
  it('null when a new item held one price for 5 days', () => {
    expect(dropRatio(seg(100, 5, 0), [], now)).toBeNull()
  })
  it('zero when the price held from exactly the window start', () => {
    expect(dropRatio(seg(100, HISTORY_DAYS, 0), [seg(50, 60, 40)], now)).toBe(0)
  })
  it('counts exactly HISTORY_MIN_DAYS of history', () => {
    expect(dropRatio(seg(90, 2, 0), [seg(100, HISTORY_MIN_DAYS, 2)], now)).toBeCloseTo(0.1, 5)
  })
  it('counts a segment that ended exactly on the window start', () => {
    expect(dropRatio(seg(90, 25, 0), [seg(100, 40, HISTORY_DAYS)], now)).toBeCloseTo(0.1, 5)
  })
  it('compares against the lowest of several earlier segments', () => {
    const earlier = [seg(150, 28, 20), seg(120, 20, 10), seg(140, 10, 2)]
    expect(dropRatio(seg(90, 2, 0), earlier, now)).toBeCloseTo(0.25, 5)
  })
  it('zero when the latest earlier segment had the same price', () => {
    expect(dropRatio(seg(100, 2, 0), [seg(130, 20, 10), seg(100, 10, 2)], now)).toBe(0)
  })
  it('zero for a 1 centavo drop on R$ 1.000', () => {
    const earlier = [seg(THOUSAND_REAIS_CENTS, 20, 2)]
    expect(dropRatio(seg(THOUSAND_REAIS_CENTS - 1, 2, 0), earlier, now)).toBe(0)
  })
  it('a drop of exactly MIN_DROP_RATIO counts', () => {
    const priceCents = THOUSAND_REAIS_CENTS - THOUSAND_REAIS_CENTS * MIN_DROP_RATIO
    const earlier = [seg(THOUSAND_REAIS_CENTS, 20, 2)]
    expect(dropRatio(seg(priceCents, 2, 0), earlier, now)).toBe(MIN_DROP_RATIO)
  })
})

describe('splitOpenSegment', () => {
  it('null for empty rows', () => {
    expect(splitOpenSegment([])).toBeNull()
  })
  it('takes the latest firstSeenAt as current and never puts it in earlier', () => {
    const split = splitOpenSegment([row(1, 100, 20, 5), row(2, 90, 5, 0), row(3, 120, 30, 20)])
    expect(split?.current.id).toBe(2)
    expect(split?.earlier.map((r) => r.id)).toEqual([1, 3])
  })
  it.each([[1, 2], [2, 1]])('breaks a firstSeenAt tie by the higher id (%i, %i)', (a, b) => {
    const rows = [row(a, 100, 5, 0), row(b, 90, 5, 0)]
    const split = splitOpenSegment(rows)
    expect(split?.current.id).toBe(Math.max(a, b))
    expect(split?.earlier).toHaveLength(rows.length - 1)
    expect(split?.earlier).not.toContain(split?.current)
  })
})

describe('dropForSegments', () => {
  it('null for empty rows', () => {
    expect(dropForSegments([], now)).toBeNull()
  })
  it('compares the open segment against the others', () => {
    expect(dropForSegments([row(2, 90, 2, 0), row(1, 100, 20, 2)], now)).toBeCloseTo(0.1, 5)
  })
  it('zero when the current basis is other', () => {
    expect(dropForSegments([row(1, 100, 20, 2), row(2, 90, 2, 0, 'other')], now)).toBe(0)
  })
  it('ignores earlier segments with basis other', () => {
    const rows = [row(1, 50, 20, 10, 'other'), row(2, 100, 10, 2, 'pix'), row(3, 90, 2, 0)]
    expect(dropForSegments(rows, now)).toBeCloseTo(0.1, 5)
  })
})

describe('dropForSegments window', () => {
  it('matches the result on only the segments seen inside the history window', () => {
    const windowStart = now.getTime() - HISTORY_DAYS * DAY_MS
    const rows = [row(1, 200, 90, 60), row(2, 100, 50, 20), row(3, 120, 20, 5), row(4, 80, 5, 0)]
    const inWindow = rows.filter((r) => r.lastSeenAt.getTime() >= windowStart)
    expect(inWindow).toHaveLength(3)
    expect(dropForSegments(rows, now)).toBe(dropForSegments(inWindow, now))
  })
})
