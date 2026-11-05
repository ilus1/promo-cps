import { describe, expect, it } from 'vitest'
import { UNCAPPED_FROM_CENTS } from './constants'
import { eachCents, minimumGap, type MinimumCoupon } from './minimum-gap'

const percent = (id: string, percentOff: number, minPaymentCents: number | null, capCents: number | null = null): MinimumCoupon => ({
  campaignId: id, kind: 'percent', percentOff, amountOffCents: null, minPaymentCents, capCents,
})
const fixed = (id: string, amountOffCents: number, minPaymentCents: number | null): MinimumCoupon => ({
  campaignId: id, kind: 'fixed', percentOff: null, amountOffCents, minPaymentCents, capCents: null,
})

describe('minimumGap', () => {
  it('is null exactly at the minimum, above it, or without one', () => {
    expect(minimumGap(10000, [percent('a', 10, 10000)])).toBeNull()
    expect(minimumGap(10000, [percent('a', 10, 9000)])).toBeNull()
    expect(minimumGap(10000, [percent('a', 10, null)])).toBeNull()
    expect(minimumGap(10000, [])).toBeNull()
    expect(minimumGap(0, [percent('a', 10, 100)])).toBeNull()
  })

  it('needs two units one centavo under the minimum', () => {
    expect(minimumGap(9999, [percent('a', 10, 10000)])).toEqual({
      campaignId: 'a', gapCents: 1, minimumCents: 10000, reach: { units: 2, valueCents: 2000 },
    })
  })

  it('reaches the minimum with exactly 3 units', () => {
    expect(minimumGap(10000, [percent('a', 10, 30000)])?.reach).toEqual({ units: 3, valueCents: 3000 })
  })

  it('shows nothing at 4 units', () => {
    expect(minimumGap(10000, [percent('a', 10, 30001)])).toBeNull()
  })

  it('values a capped coupon at its cap', () => {
    expect(minimumGap(10000, [percent('a', 50, 20000, 1500)])?.reach).toEqual({ units: 2, valueCents: 1500 })
    expect(minimumGap(10000, [percent('a', 50, 20000, UNCAPPED_FROM_CENTS)])?.reach).toEqual({ units: 2, valueCents: 10000 })
  })

  it('values a fixed coupon larger than the price at what the units cost at most', () => {
    expect(minimumGap(1000, [fixed('a', 5000, 2000)])?.reach).toEqual({ units: 2, valueCents: 2000 })
  })

  it('picks the reachable coupon worth the most', () => {
    const picked = minimumGap(10000, [percent('small', 5, 20000), percent('big', 10, 30000), percent('far', 90, 90000)])
    expect(picked?.campaignId).toBe('big')
    expect(picked?.reach).toEqual({ units: 3, valueCents: 3000 })
  })

  it('skips a nearer coupon that no quantity reaches', () => {
    expect(minimumGap(10000, [percent('near', 10, 40000), percent('reach', 10, 20000)])?.campaignId).toBe('reach')
  })

  it('shows nothing when the terms are unusable', () => {
    expect(minimumGap(10000, [{ ...percent('a', 10, 20000), kind: 'unparsed' }])).toBeNull()
  })

  it('ranks reachable coupons by value per unit, so 2 units at 10% beat 3 units at 8%', () => {
    const picked = minimumGap(10000, [percent('three', 8, 30000), percent('two', 10, 20000)])
    expect(picked?.campaignId).toBe('two')
    expect(picked?.reach).toEqual({ units: 2, valueCents: 2000 })
  })

  it('breaks a tie in value per unit with fewer units, then the smaller gap', () => {
    expect(minimumGap(10000, [fixed('three', 3000, 30000), percent('two', 10, 20000)])?.campaignId).toBe('two')
    expect(minimumGap(10000, [percent('wide', 10, 20000), percent('narrow', 10, 15000)])?.campaignId).toBe('narrow')
  })

  it('ignores a reachable coupon worth less than the trivial saving', () => {
    expect(minimumGap(1000, [percent('a', 10, 2000)])).toBeNull()
    expect(minimumGap(1000, [fixed('a', 499, 2000)])).toBeNull()
    expect(minimumGap(1000, [fixed('a', 500, 2000)])?.reach).toEqual({ units: 2, valueCents: 500 })
  })

  it('ignores coupons whose minimum the price already meets', () => {
    expect(minimumGap(10000, [percent('met', 50, 10000), percent('open', 10, 20000)])?.campaignId).toBe('open')
  })
})

describe('eachCents', () => {
  it('rounds the value per unit', () => {
    expect(eachCents({ units: 3, valueCents: 1000 })).toBe(333)
    expect(eachCents({ units: 2, valueCents: 1001 })).toBe(501)
  })
})
