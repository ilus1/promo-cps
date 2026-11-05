import type { ParsedCoupon } from '@/ingestion/ml/coupons'
import { CENTS_PER_REAL, PERCENT_BASE } from './constants'

const LOST_CENTAVOS_FROM_REAIS = 1000
export const LOST_CENTAVOS_FROM_CENTS = LOST_CENTAVOS_FROM_REAIS * CENTS_PER_REAL
export const LOST_CENTAVOS_TOLERANCE_CENTS = CENTS_PER_REAL
export const HINT_ROUNDING_TOLERANCE_CENTS = 2
export const PERCENT_OFF = /(\d+(?:,\d+)?)\s*%\s*OFF\b/i
const AMOUNT_OFF = /^R\$\s*([\d.]+(?:,\d{1,2})?)\s*OFF\b/i
const PRICE_AFTER = /^R\$\s*([\d.]+(?:,\d{1,2})?)\s*com cupom\b/i
const THOUSANDS_SEPARATOR = /\./g

export interface CouponHint {
  text: string
  percentOff: number | null
  amountOffCents: number | null
  priceAfterCents: number | null
}

export type CouponTerms = Pick<ParsedCoupon, 'kind' | 'percentOff' | 'amountOffCents' | 'capCents'>

function discountOn(priceCents: number, coupon: CouponTerms): number | null {
  if (coupon.kind === 'percent' && coupon.percentOff !== null) {
    const discount = Math.round((priceCents * coupon.percentOff) / PERCENT_BASE)
    return coupon.capCents === null ? discount : Math.min(discount, coupon.capCents)
  }
  if (coupon.kind === 'fixed' && coupon.amountOffCents !== null) return coupon.amountOffCents
  return null
}

function hintTolerance(priceCents: number): number {
  return priceCents >= LOST_CENTAVOS_FROM_CENTS ? LOST_CENTAVOS_TOLERANCE_CENTS : HINT_ROUNDING_TOLERANCE_CENTS
}

export function hintMatches(hint: CouponHint, priceCents: number, coupon: CouponTerms): boolean {
  if (hint.percentOff !== null && coupon.kind === 'percent' && hint.percentOff === coupon.percentOff) return true
  if (hint.amountOffCents !== null && coupon.kind === 'fixed' && hint.amountOffCents === coupon.amountOffCents) {
    return true
  }
  if (hint.priceAfterCents === null) return false
  const discount = discountOn(priceCents, coupon)
  return discount !== null && Math.abs(priceCents - discount - hint.priceAfterCents) <= hintTolerance(priceCents)
}

function centsOfText(amount: string): number {
  return Math.round(Number(amount.replace(THOUSANDS_SEPARATOR, '').replace(',', '.')) * CENTS_PER_REAL)
}

export function hintOfText(hintText: string): CouponHint {
  const percent = hintText.match(PERCENT_OFF)
  const amountOff = hintText.match(AMOUNT_OFF)
  const priceAfter = hintText.match(PRICE_AFTER)
  return {
    text: hintText,
    percentOff: percent ? Number(percent[1].replace(',', '.')) : null,
    amountOffCents: amountOff ? centsOfText(amountOff[1]) : null,
    priceAfterCents: priceAfter ? centsOfText(priceAfter[1]) : null,
  }
}

export function hintIsPrice(hint: CouponHint): boolean {
  return hint.priceAfterCents !== null
}
