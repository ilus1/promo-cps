import { describe, expect, it } from 'vitest'
import type { Basis } from '@/lib/domain'
import {
  HINT_ROUNDING_TOLERANCE_CENTS, LOST_CENTAVOS_FROM_CENTS, LOST_CENTAVOS_TOLERANCE_CENTS, type CouponHint, type CouponTerms,
} from '@/lib/coupon-hint'
import { linksToCoupon, type LinkableCard } from './observed-card'

const hint = (over: Partial<CouponHint>): CouponHint => ({
  text: 'com Cupom', percentOff: null, amountOffCents: null, priceAfterCents: null, ...over,
})
const card = (basis: Basis, couponHint: CouponHint | null = null, priceCents = 10000): LinkableCard => ({
  basis, priceCents, couponHint, isPad: false,
})
const linked = (c: LinkableCard, t: CouponTerms, hintOnly = false) => linksToCoupon(c, t, hintOnly)
const percent = (percentOff: number, capCents: number | null = null): CouponTerms => ({
  kind: 'percent', percentOff, amountOffCents: null, capCents,
})
const fixed = (amountOffCents: number): CouponTerms => ({ kind: 'fixed', percentOff: null, amountOffCents, capCents: null })
const unparsed: CouponTerms = { kind: 'unparsed', percentOff: null, amountOffCents: null, capCents: null }

describe('linksToCoupon by basis', () => {
  it.each<[Basis, boolean]>([
    ['coupon', true], ['pix_coupon', true], ['pix', false], ['none', false], ['other', false],
  ])('basis %s without a hint links: %s', (basis, links) => {
    expect(linked(card(basis), percent(15))).toBe(links)
  })
  it('links a coupon-priced card even when its hint names another coupon', () => {
    expect(linked(card('coupon', hint({ percentOff: 40 })), percent(15))).toBe(true)
    expect(linked(card('pix_coupon'), unparsed)).toBe(true)
  })
  it('does not link a hint with no recognized value', () => {
    expect(linked(card('none', hint({})), percent(15))).toBe(false)
  })
})

describe('linksToCoupon hint only', () => {
  it('ignores a coupon basis without a matching hint', () => {
    expect(linked(card('coupon'), percent(15), true)).toBe(false)
    expect(linked(card('coupon', hint({ percentOff: 40 })), percent(15), true)).toBe(false)
  })

  it('keeps a matching hint', () => {
    expect(linked(card('coupon', hint({ percentOff: 15 })), percent(15), true)).toBe(true)
  })
})

describe('linksToCoupon by percent hint', () => {
  const card15 = card('none', hint({ text: '15% OFF com Cupom', percentOff: 15 }))
  it('links when the percent equals the coupon percent', () => {
    expect(linked(card15, percent(15))).toBe(true)
  })
  it('does not link another percent or a fixed coupon', () => {
    expect(linked(card15, percent(20))).toBe(false)
    expect(linked(card15, fixed(1500))).toBe(false)
    expect(linked(card15, unparsed)).toBe(false)
  })
})

describe('linksToCoupon by amount hint', () => {
  const card20 = card('pix', hint({ text: 'R$ 20 OFF com Cupom', amountOffCents: 2000 }))
  it('links when the amount equals the coupon amount', () => {
    expect(linked(card20, fixed(2000))).toBe(true)
  })
  it('does not link another amount or a percent coupon', () => {
    expect(linked(card20, fixed(3000))).toBe(false)
    expect(linked(card20, percent(20))).toBe(false)
  })
})

describe('linksToCoupon by price after the coupon', () => {
  const after = (priceAfterCents: number, priceCents = 10000) =>
    card('none', hint({ text: 'R$ 85 com Cupom', priceAfterCents }), priceCents)
  it('links a percent coupon whose discount on the price gives the hinted price', () => {
    expect(linked(after(8500), percent(15))).toBe(true)
  })
  it('rounds the percent discount to whole centavos', () => {
    expect(linked(after(849, 999), percent(15))).toBe(true)
  })
  it('links a fixed coupon whose amount off the price gives the hinted price', () => {
    expect(linked(after(30000, 50000), fixed(20000))).toBe(true)
    expect(linked(after(30000, 50000), fixed(10000))).toBe(false)
  })
  it('caps a percent discount at the coupon cap on an expensive item', () => {
    const capped = after(300000 - 5000, 300000)
    expect(linked(capped, percent(15, 5000))).toBe(true)
    expect(linked(capped, percent(15))).toBe(false)
  })
  it('uses the percent discount when it is below the cap', () => {
    expect(linked(after(8500), percent(15, 5000))).toBe(true)
  })
  it('tolerates prices that lost their centavos above R$ 1.000', () => {
    expect(linked(after(110100, 122300), percent(10))).toBe(true)
  })
  it('accepts a rounding difference below R$ 1.000 and rejects one centavo more', () => {
    expect(linked(after(8500 + HINT_ROUNDING_TOLERANCE_CENTS), percent(15))).toBe(true)
    expect(linked(after(8500 - HINT_ROUNDING_TOLERANCE_CENTS), percent(15))).toBe(true)
    expect(linked(after(8500 + HINT_ROUNDING_TOLERANCE_CENTS + 1), percent(15))).toBe(false)
    expect(linked(after(8500 - HINT_ROUNDING_TOLERANCE_CENTS - 1), percent(15))).toBe(false)
  })
  it('tells 15% from 16% on R$ 50', () => {
    const hinted = after(4250, 5000)
    expect(linked(hinted, percent(15))).toBe(true)
    expect(linked(hinted, percent(16))).toBe(false)
  })
  it('accepts R$ 1 of lost centavos from R$ 1.000 up and rejects one centavo more', () => {
    const price = LOST_CENTAVOS_FROM_CENTS
    expect(linked(after(90000 + LOST_CENTAVOS_TOLERANCE_CENTS, price), percent(10))).toBe(true)
    expect(linked(after(90000 - LOST_CENTAVOS_TOLERANCE_CENTS, price), percent(10))).toBe(true)
    expect(linked(after(90000 + LOST_CENTAVOS_TOLERANCE_CENTS + 1, price), percent(10))).toBe(false)
    expect(linked(after(90000 - LOST_CENTAVOS_TOLERANCE_CENTS - 1, price), percent(10))).toBe(false)
  })
  it('keeps the rounding tolerance one centavo below R$ 1.000', () => {
    const price = LOST_CENTAVOS_FROM_CENTS - 1
    expect(linked(after(89999 + HINT_ROUNDING_TOLERANCE_CENTS, price), percent(10))).toBe(true)
    expect(linked(after(89999 + HINT_ROUNDING_TOLERANCE_CENTS + 1, price), percent(10))).toBe(false)
  })
  it('does not link another percent or an unparsed coupon', () => {
    expect(linked(after(8500), percent(25))).toBe(false)
    expect(linked(after(8500), unparsed)).toBe(false)
  })
})
