import { describe, expect, it } from 'vitest'
import { couponCountLine } from './coupon-count'

describe('couponCountLine', () => {
  it('shows the total and the valid ones when no status filter is set', () => {
    expect(couponCountLine(2068, 1853, undefined)).toBe('2.068 cupons, 1.853 válidos')
    expect(couponCountLine(1, 1, undefined)).toBe('1 cupom, 1 válido')
    expect(couponCountLine(5, 0, undefined)).toBe('5 cupons, 0 válidos')
  })

  it('keeps the plain count when a status filter is set', () => {
    expect(couponCountLine(215, 0, 'ended')).toBe('215 cupons encontrados')
    expect(couponCountLine(1, 1, 'active')).toBe('1 cupom encontrado')
  })

  it('keeps the plain count when the valid count was not asked for', () => {
    expect(couponCountLine(7, null, undefined)).toBe('7 cupons encontrados')
  })
})
