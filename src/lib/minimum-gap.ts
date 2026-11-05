import { MAX_MINIMUM_UNITS, TRIVIAL_SAVING_CENTS } from './constants'
import { couponDiscountCents, type LinkedCouponTerms } from './deal-saving'

export interface MinimumCoupon extends LinkedCouponTerms {
  campaignId: string
}

export interface MinimumReach {
  units: number
  valueCents: number
}

export interface MinimumGap {
  campaignId: string
  gapCents: number
  minimumCents: number
  reach: MinimumReach
}

export function eachCents(reach: MinimumReach): number {
  return Math.round(reach.valueCents / reach.units)
}

function reachOf(priceCents: number, minimumCents: number, coupon: LinkedCouponTerms): MinimumReach | null {
  const units = Math.ceil(minimumCents / priceCents)
  if (units > MAX_MINIMUM_UNITS) return null
  const valueCents = couponDiscountCents(units * priceCents, coupon)
  return valueCents === null || valueCents < TRIVIAL_SAVING_CENTS ? null : { units, valueCents }
}

function candidateOf(priceCents: number, coupon: MinimumCoupon): MinimumGap | null {
  const minimum = coupon.minPaymentCents
  if (minimum === null || priceCents >= minimum) return null
  const reach = reachOf(priceCents, minimum, coupon)
  return reach && { campaignId: coupon.campaignId, gapCents: minimum - priceCents, minimumCents: minimum, reach }
}

function reachRank(a: MinimumGap, b: MinimumGap): number {
  return eachCents(b.reach) - eachCents(a.reach) || a.reach.units - b.reach.units || a.gapCents - b.gapCents
}

export function minimumGap(priceCents: number, coupons: readonly MinimumCoupon[]): MinimumGap | null {
  if (priceCents <= 0) return null
  return coupons.flatMap((coupon) => candidateOf(priceCents, coupon) ?? []).sort(reachRank)[0] ?? null
}
