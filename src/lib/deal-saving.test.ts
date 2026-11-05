import { describe, expect, it } from 'vitest'
import { UNCAPPED_FROM_CENTS } from './constants'
import {
  couponDiscountCents, couponPart, finalPrice, referencePriceCents, totalSaving, type LinkedCouponTerms, type PricedItem,
} from './deal-saving'

const percent = (percentOff: number, extra: Partial<LinkedCouponTerms> = {}): LinkedCouponTerms => ({
  kind: 'percent', percentOff, amountOffCents: null, minPaymentCents: null, capCents: null, ...extra,
})
const fixed = (amountOffCents: number, extra: Partial<LinkedCouponTerms> = {}): LinkedCouponTerms => ({
  kind: 'fixed', percentOff: null, amountOffCents, minPaymentCents: null, capCents: null, ...extra,
})
const item = (extra: Partial<PricedItem> = {}): PricedItem => ({
  priceCents: 10000, listPriceCents: null, basis: 'none', ...extra,
})

describe('couponDiscountCents', () => {
  it('takes the percent of the price', () => {
    expect(couponDiscountCents(10000, percent(15))).toBe(1500)
    expect(couponDiscountCents(10001, percent(12.5))).toBe(1250)
  })

  it('rounds an exact half up', () => {
    expect(couponDiscountCents(1005, percent(10))).toBe(101)
  })

  it('caps a percent at its limit, and an unbounded limit means no cap', () => {
    expect(couponDiscountCents(10000, percent(20, { capCents: 1500 }))).toBe(1500)
    expect(couponDiscountCents(10000, percent(20, { capCents: UNCAPPED_FROM_CENTS }))).toBe(2000)
    expect(couponDiscountCents(10000, percent(20, { capCents: null }))).toBe(2000)
  })

  it('never exceeds the price for a fixed coupon', () => {
    expect(couponDiscountCents(3000, fixed(5000))).toBe(3000)
    expect(couponDiscountCents(10000, fixed(1000))).toBe(1000)
  })

  it('treats a null minimum as zero and refuses a price below the minimum', () => {
    expect(couponDiscountCents(10000, percent(10, { minPaymentCents: null }))).toBe(1000)
    expect(couponDiscountCents(10000, percent(10, { minPaymentCents: 10000 }))).toBe(1000)
    expect(couponDiscountCents(9999, percent(10, { minPaymentCents: 10000 }))).toBeNull()
  })

  it.each([
    ['unparsed', { ...percent(10), kind: 'unparsed' as const }],
    ['a zero percent', percent(0)],
    ['a percent above 100', percent(101)],
    ['a null percent', percent(10, { percentOff: null })],
    ['a zero fixed amount', fixed(0)],
    ['a null fixed amount', fixed(0, { amountOffCents: null })],
  ])('has no discount for %s', (_, coupon) => {
    expect(couponDiscountCents(10000, coupon)).toBeNull()
  })
})

describe('finalPrice', () => {
  it.each(['coupon', 'pix_coupon'] as const)('keeps the shown price on the %s basis', (basis) => {
    expect(finalPrice(item({ basis }), [percent(50)])).toEqual({ cents: 10000, estimated: false })
  })

  it('applies the best linked coupon and marks it estimated', () => {
    expect(finalPrice(item(), [percent(10), fixed(2500), percent(20, { capCents: 1200 })]))
      .toEqual({ cents: 7500, estimated: true })
  })

  it('applies a linked coupon on top of the pix basis', () => {
    expect(finalPrice(item({ basis: 'pix' }), [percent(20)])).toEqual({ cents: 8000, estimated: true })
  })

  it('keeps the shown price when no linked coupon qualifies', () => {
    expect(finalPrice(item(), [percent(30, { minPaymentCents: 20000 })])).toEqual({ cents: 10000, estimated: false })
    expect(finalPrice(item(), [{ ...percent(10), kind: 'unparsed' }])).toEqual({ cents: 10000, estimated: false })
  })

  it('keeps the shown price with no linked coupon', () => {
    expect(finalPrice(item(), [])).toEqual({ cents: 10000, estimated: false })
    expect(finalPrice(item({ priceCents: 1500, listPriceCents: 3500 }), [])).toEqual({ cents: 1500, estimated: false })
  })

  it('never goes below zero', () => {
    expect(finalPrice(item({ priceCents: 2000 }), [fixed(9000)]).cents).toBe(0)
  })
})

describe('referencePriceCents and totalSaving', () => {
  it('uses the list price only when it is above the final price', () => {
    expect(referencePriceCents(item({ listPriceCents: 15000 }), 8000)).toBe(15000)
    expect(referencePriceCents(item({ listPriceCents: null }), 8000)).toBe(10000)
    expect(referencePriceCents(item({ listPriceCents: 8000 }), 8000)).toBe(10000)
    expect(referencePriceCents(item({ listPriceCents: 7000 }), 8000)).toBe(10000)
  })

  it('measures the saving against the list price', () => {
    const total = totalSaving(item({ listPriceCents: 20000, basis: 'coupon' }), { cents: 10000, estimated: false })
    expect(total).toEqual({ finalCents: 10000, referenceCents: 20000, savingCents: 10000, ratio: 0.5, estimated: false })
  })

  it('counts an estimated coupon on top of a list price', () => {
    const total = totalSaving(item({ listPriceCents: 12500 }), { cents: 7500, estimated: true })
    expect(total.savingCents).toBe(5000)
    expect(total.ratio).toBeCloseTo(0.4)
    expect(total.estimated).toBe(true)
  })

  it('measures against the shown price without a list price', () => {
    expect(totalSaving(item(), { cents: 8500, estimated: true })).toMatchObject({ savingCents: 1500, ratio: 0.15 })
  })

  it('has no saving when the list price is below the final price', () => {
    expect(totalSaving(item({ listPriceCents: 5000 }), { cents: 10000, estimated: false }))
      .toMatchObject({ savingCents: 0, ratio: 0 })
  })

  it('has a null ratio for a zero reference', () => {
    expect(totalSaving(item({ priceCents: 0 }), { cents: 0, estimated: false })).toMatchObject({ savingCents: 0, ratio: null })
  })
})

describe('couponPart', () => {
  const shown = (extra: Partial<PricedItem> = {}) => ({ ...item({ basis: 'coupon', ...extra }), couponHint: null })

  it('recovers a percent coupon from the price it already includes', () => {
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: 12000 }), [percent(10)])).toEqual({ couponCents: 1000, sellerCents: 2000 })
  })

  it('caps a percent coupon at its limit', () => {
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: 12000 }), [percent(20, { capCents: 500 })])).toEqual({ couponCents: 500, sellerCents: 2500 })
    expect(couponPart(shown({ priceCents: 8000, listPriceCents: 12000 }), [percent(20, { capCents: UNCAPPED_FROM_CENTS })]))
      .toEqual({ couponCents: 2000, sellerCents: 2000 })
  })

  it('takes a fixed coupon at its value', () => {
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: 12000 }), [fixed(700)])).toEqual({ couponCents: 700, sellerCents: 2300 })
  })

  it('clamps the coupon to the gap to the list price and leaves nothing for the seller', () => {
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: 9400 }), [fixed(700)])).toEqual({ couponCents: 400, sellerCents: 0 })
  })

  it('counts a seller part under one real as rounding', () => {
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: 9750 }), [fixed(700)])).toEqual({ couponCents: 700, sellerCents: 0 })
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: 9800 }), [fixed(700)])).toEqual({ couponCents: 700, sellerCents: 100 })
  })

  it('rounds an exact half up and gives null for a percent that rounds to nothing', () => {
    expect(couponPart(shown({ priceCents: 6, listPriceCents: null }), [percent(20)])).toEqual({ couponCents: 2, sellerCents: 0 })
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: null }), [percent(0.001)])).toBeNull()
  })

  it('has no seller part without a list price', () => {
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: null }), [fixed(700)])).toEqual({ couponCents: 700, sellerCents: 0 })
  })

  it('is null when the list price is not above the shown price', () => {
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: 9000 }), [fixed(700)])).toBeNull()
    expect(couponPart(shown({ priceCents: 9000, listPriceCents: 8000 }), [fixed(700)])).toBeNull()
  })

  it('is null for unusable terms', () => {
    expect(couponPart(shown(), [percent(0)])).toBeNull()
    expect(couponPart(shown(), [percent(100)])).toBeNull()
    expect(couponPart(shown(), [fixed(0)])).toBeNull()
    expect(couponPart(shown(), [{ ...fixed(100), kind: 'unparsed' }])).toBeNull()
  })

  it('is null when the listing carries a coupon hint, which may name another coupon', () => {
    expect(couponPart({ ...shown({ priceCents: 9000, listPriceCents: 12000 }), couponHint: 'R$ 10 OFF com Cupom' }, [fixed(700)])).toBeNull()
  })

  it('only applies to the coupon basis with exactly one linked coupon', () => {
    const priced = { priceCents: 9000, listPriceCents: 12000 }
    expect(couponPart({ ...item({ ...priced, basis: 'pix_coupon' }), couponHint: null }, [fixed(700)])).toBeNull()
    expect(couponPart({ ...item({ ...priced, basis: 'none' }), couponHint: null }, [fixed(700)])).toBeNull()
    expect(couponPart(shown(priced), [])).toBeNull()
    expect(couponPart(shown(priced), [fixed(700), fixed(300)])).toBeNull()
  })
})
