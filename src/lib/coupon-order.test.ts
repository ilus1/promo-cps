import { describe, expect, it } from 'vitest'
import { compareDiscoveryRotation, discoveryRotation, isDiscoveryPending } from './coupon-order'

type Row = {
  id: string; isStore: boolean; kind: 'percent' | 'fixed' | 'unparsed'; percentOff: number | null
  amountOffCents: number | null; minPaymentCents: number | null; discoveryTriedAt: Date | null
  discoveryPriorityAt: Date | null
}

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id, isStore: false, kind: 'percent', percentOff: 10, amountOffCents: null, minPaymentCents: null,
  discoveryTriedAt: null, discoveryPriorityAt: null, ...over,
})
const at = (iso: string) => new Date(iso)
const ids = (rows: Row[]) => rows.map((r) => r.id)

describe('discoveryRotation', () => {
  const rows = [
    row('old-strong', { discoveryTriedAt: at('2026-11-01T10:00:00Z'), percentOff: 40 }),
    row('never-weak', { percentOff: 5 }),
    row('recent', { discoveryTriedAt: at('2026-11-02T10:00:00Z'), percentOff: 50 }),
    row('never-strong', { percentOff: 30 }),
    row('old-weak', { discoveryTriedAt: at('2026-11-01T10:00:00Z'), percentOff: 10 }),
  ]
  it('puts never-tried coupons first, then the oldest attempt, strongest within a tie', () => {
    expect(ids(discoveryRotation(rows, 10)))
      .toEqual(['never-strong', 'never-weak', 'old-strong', 'old-weak', 'recent'])
  })
  it('cuts by rotation then strength, not by input order', () => {
    expect(ids(discoveryRotation(rows, 3))).toEqual(['never-strong', 'never-weak', 'old-strong'])
  })
  it('ranks an earlier attempt before a stronger later one', () => {
    const earlier = row('earlier', { discoveryTriedAt: at('2026-11-01T00:00:00Z'), percentOff: 1 })
    const later = row('later', { discoveryTriedAt: at('2026-11-01T00:00:01Z'), percentOff: 90 })
    expect(compareDiscoveryRotation(earlier, later)).toBeLessThan(0)
  })
})

describe('isDiscoveryPending', () => {
  it('is false without a priority, true with one never tried, or tried before it', () => {
    expect(isDiscoveryPending(row('a'))).toBe(false)
    expect(isDiscoveryPending(row('a', { discoveryTriedAt: at('2026-11-02T10:00:00Z') }))).toBe(false)
    expect(isDiscoveryPending(row('a', { discoveryPriorityAt: at('2026-11-02T10:00:00Z') }))).toBe(true)
    expect(isDiscoveryPending(row('a', {
      discoveryPriorityAt: at('2026-11-02T10:00:00Z'), discoveryTriedAt: at('2026-11-02T09:59:59Z'),
    }))).toBe(true)
  })
  it('stops when the attempt is at or after the priority', () => {
    const priority = at('2026-11-02T10:00:00Z')
    expect(isDiscoveryPending(row('a', { discoveryPriorityAt: priority, discoveryTriedAt: priority }))).toBe(false)
    expect(isDiscoveryPending(row('a', { discoveryPriorityAt: priority, discoveryTriedAt: at('2026-11-02T11:00:00Z') }))).toBe(false)
  })
})

describe('discoveryRotation with priority', () => {
  const early = at('2026-11-02T08:00:00Z')
  const late = at('2026-11-02T09:00:00Z')
  const tried = at('2026-11-02T10:00:00Z')
  const rows = [
    row('never-strong', { percentOff: 90 }),
    row('prio-early-strong', { percentOff: 80, discoveryPriorityAt: early }),
    row('prio-late-weak', { percentOff: 5, discoveryPriorityAt: late }),
    row('prio-late-strong', { percentOff: 40, discoveryPriorityAt: late }),
    row('prio-done', { percentOff: 99, discoveryPriorityAt: early, discoveryTriedAt: tried }),
    row('old', { percentOff: 10, discoveryTriedAt: at('2026-10-30T00:00:00Z') }),
  ]
  it('puts pending coupons first, newest priority first, then strength, then the normal rotation', () => {
    expect(ids(discoveryRotation(rows, 10))).toEqual([
      'prio-late-strong', 'prio-late-weak', 'prio-early-strong', 'never-strong', 'old', 'prio-done',
    ])
  })
  it('a coupon whose attempt passed its priority goes back to the normal rotation', () => {
    expect(ids(discoveryRotation(rows, 10)).slice(-2)).toEqual(['old', 'prio-done'])
  })
  it('cuts pending coupons ahead of never-tried ones', () => {
    expect(ids(discoveryRotation(rows, 2))).toEqual(['prio-late-strong', 'prio-late-weak'])
  })
  it('falls back to the attempt time when priority and strength tie', () => {
    const tie = [
      row('b', { discoveryPriorityAt: late, discoveryTriedAt: early }),
      row('a', { discoveryPriorityAt: late }),
    ]
    expect(ids(discoveryRotation(tie, 10))).toEqual(['a', 'b'])
  })
})
