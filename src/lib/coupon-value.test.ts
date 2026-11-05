import { describe, expect, test } from 'vitest'
import { TRIVIAL_SAVING_CENTS, UNCAPPED_FROM_CENTS } from './constants'
import { discountAtMinimum, fullPercentUpTo, effectiveLimitCents, isTrivialSaving, isUncapped, isUnboundedSaving, maxSavingCents } from './coupon-value'

describe('discountAtMinimum', () => {
  test('fixed coupon is value over minimum', () => {
    expect(discountAtMinimum('fixed', null, 20000, 40000, null)).toBe(0.5)
  })

  test('fixed coupon with a minimum below the value takes everything', () => {
    expect(discountAtMinimum('fixed', null, 1000, 1100, null)).toBeCloseTo(1000 / 1100)
    expect(discountAtMinimum('fixed', null, 1000, 500, null)).toBe(1)
  })

  test('fixed coupon with a null or zero minimum is 100%', () => {
    expect(discountAtMinimum('fixed', null, 500, null, null)).toBe(1)
    expect(discountAtMinimum('fixed', null, 500, 0, null)).toBe(1)
  })

  test('fixed coupon without a usable value has no number', () => {
    expect(discountAtMinimum('fixed', null, null, 1000, null)).toBeNull()
    expect(discountAtMinimum('fixed', null, 0, 1000, null)).toBeNull()
  })

  test('percent coupon under its cap is the percent', () => {
    expect(discountAtMinimum('percent', 10, null, 4000, 1500)).toBe(0.1)
  })

  test('percent coupon with the cap below percent x minimum is cap over minimum', () => {
    expect(discountAtMinimum('percent', 20, null, 10000, 1500)).toBe(0.15)
  })

  test('percent coupon with a null or zero minimum is the percent', () => {
    expect(discountAtMinimum('percent', 10, null, null, 1500)).toBe(0.1)
    expect(discountAtMinimum('percent', 10, null, 0, 1500)).toBe(0.1)
  })

  test('percent coupon with no cap is the percent', () => {
    expect(discountAtMinimum('percent', 10, null, 4000, null)).toBe(0.1)
  })

  test('placeholder cap counts as uncapped', () => {
    expect(discountAtMinimum('percent', 8, null, 100, UNCAPPED_FROM_CENTS)).toBe(0.08)
    expect(discountAtMinimum('percent', 8, null, UNCAPPED_FROM_CENTS * 2, UNCAPPED_FROM_CENTS)).toBe(0.08)
  })

  test('percent coupon with a zero cap gives nothing', () => {
    expect(discountAtMinimum('percent', 10, null, 4000, 0)).toBe(0)
  })

  test('percent coupon without a valid percent has no number', () => {
    expect(discountAtMinimum('percent', null, null, 4000, 1500)).toBeNull()
    expect(discountAtMinimum('percent', 0, null, 4000, 1500)).toBeNull()
    expect(discountAtMinimum('percent', 150, null, 4000, 1500)).toBeNull()
  })

  test('unparsed has no number', () => {
    expect(discountAtMinimum('unparsed', 10, 500, 4000, 1500)).toBeNull()
  })
})

describe('fullPercentUpTo', () => {
  test('is the cap over the percent', () => {
    expect(fullPercentUpTo(10, 1500)).toBe(15000)
    expect(fullPercentUpTo(7.5, 1500)).toBe(20000)
  })

  test('has no number without a percent, a cap, or with a placeholder cap', () => {
    expect(fullPercentUpTo(null, 1500)).toBeNull()
    expect(fullPercentUpTo(10, null)).toBeNull()
    expect(fullPercentUpTo(10, UNCAPPED_FROM_CENTS)).toBeNull()
  })
})

describe('isUncapped', () => {
  test('the threshold is inclusive', () => {
    expect(isUncapped(UNCAPPED_FROM_CENTS)).toBe(true)
    expect(isUncapped(UNCAPPED_FROM_CENTS - 1)).toBe(false)
    expect(isUncapped(null)).toBe(false)
  })
})

describe('maxSavingCents', () => {
  test('fixed coupon saves its value', () => {
    expect(maxSavingCents('fixed', 1000, null)).toBe(1000)
    expect(maxSavingCents('fixed', null, null)).toBeNull()
    expect(maxSavingCents('fixed', 0, null)).toBeNull()
  })

  test('percent coupon saves its cap, unbounded when missing or a placeholder', () => {
    expect(maxSavingCents('percent', null, 1500)).toBe(1500)
    expect(maxSavingCents('percent', null, 0)).toBe(0)
    expect(maxSavingCents('percent', null, null)).toBeNull()
    expect(maxSavingCents('percent', null, UNCAPPED_FROM_CENTS)).toBeNull()
  })

  test('unparsed has no number', () => {
    expect(maxSavingCents('unparsed', 500, 500)).toBeNull()
  })
})

describe('isTrivialSaving', () => {
  test('below the threshold only, unbounded is not trivial', () => {
    expect(isTrivialSaving(TRIVIAL_SAVING_CENTS - 1)).toBe(true)
    expect(isTrivialSaving(TRIVIAL_SAVING_CENTS)).toBe(false)
    expect(isTrivialSaving(null)).toBe(false)
  })
})

describe('isUnboundedSaving', () => {
  test('only percent coupons without a real cap', () => {
    expect(isUnboundedSaving('percent', null)).toBe(true)
    expect(isUnboundedSaving('percent', UNCAPPED_FROM_CENTS)).toBe(true)
    expect(isUnboundedSaving('percent', 1500)).toBe(false)
    expect(isUnboundedSaving('fixed', null)).toBe(false)
    expect(isUnboundedSaving('unparsed', null)).toBe(false)
  })
})

describe('effectiveLimitCents', () => {
  test('fixed coupon limit is its value, not a stray cap', () => {
    expect(effectiveLimitCents('fixed', 20000, UNCAPPED_FROM_CENTS)).toBe(20000)
    expect(effectiveLimitCents('fixed', null, 500)).toBeNull()
  })

  test('percent coupon limit is the cap, unbounded when uncapped or missing', () => {
    expect(effectiveLimitCents('percent', null, 1500)).toBe(1500)
    expect(effectiveLimitCents('percent', null, UNCAPPED_FROM_CENTS)).toBeNull()
    expect(effectiveLimitCents('percent', null, null)).toBeNull()
  })

  test('unparsed keeps whatever cap it has', () => {
    expect(effectiveLimitCents('unparsed', null, 700)).toBe(700)
    expect(effectiveLimitCents('unparsed', null, null)).toBeNull()
  })
})
