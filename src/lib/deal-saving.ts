import { COUPON_BASES } from '@/ingestion/ml/basis'
import { CENTS_PER_REAL, PERCENT_BASE } from './constants'
import { maxSavingCents, validPercent } from './coupon-value'
import type { Basis, CouponKind } from './domain'

export interface LinkedCouponTerms {
  kind: CouponKind
  percentOff: number | null
  amountOffCents: number | null
  minPaymentCents: number | null
  capCents: number | null
}

export interface PricedItem {
  priceCents: number
  listPriceCents: number | null
  basis: Basis
}

export interface FinalPrice {
  cents: number
  estimated: boolean
}

export interface CouponPart {
  couponCents: number
  sellerCents: number
}

export interface TotalSaving {
  finalCents: number
  referenceCents: number
  savingCents: number
  ratio: number | null
  estimated: boolean
}

function percentOf(priceCents: number, percent: number): number {
  return Math.round((priceCents * percent) / PERCENT_BASE)
}

function baseDiscountCents(priceCents: number, coupon: LinkedCouponTerms): number | null {
  if (coupon.kind === 'percent') return validPercent(coupon.percentOff) ? percentOf(priceCents, coupon.percentOff) : null
  if (coupon.kind === 'fixed') return coupon.amountOffCents !== null && coupon.amountOffCents > 0 ? coupon.amountOffCents : null
  return null
}

export function couponDiscountCents(priceCents: number, coupon: LinkedCouponTerms): number | null {
  const base = baseDiscountCents(priceCents, coupon)
  if (base === null || priceCents < (coupon.minPaymentCents ?? 0)) return null
  const limit = maxSavingCents(coupon.kind, coupon.amountOffCents, coupon.capCents)
  return Math.min(base, limit ?? base, priceCents)
}

function bestCouponDiscountCents(priceCents: number, coupons: readonly LinkedCouponTerms[]): number | null {
  const discounts = coupons
    .map((coupon) => couponDiscountCents(priceCents, coupon))
    .filter((discount): discount is number => discount !== null && discount > 0)
  return discounts.length > 0 ? Math.max(...discounts) : null
}

export function finalPrice(item: PricedItem, coupons: readonly LinkedCouponTerms[]): FinalPrice {
  if (COUPON_BASES.includes(item.basis)) return { cents: item.priceCents, estimated: false }
  const discount = bestCouponDiscountCents(item.priceCents, coupons) ?? 0
  return { cents: item.priceCents - discount, estimated: discount > 0 }
}

export function referencePriceCents(item: Pick<PricedItem, 'priceCents' | 'listPriceCents'>, finalCents: number): number {
  return item.listPriceCents !== null && item.listPriceCents > finalCents ? item.listPriceCents : item.priceCents
}

export function totalSaving(item: PricedItem, final: FinalPrice): TotalSaving {
  const referenceCents = referencePriceCents(item, final.cents)
  const savingCents = referenceCents - final.cents
  return {
    finalCents: final.cents,
    referenceCents,
    savingCents,
    ratio: referenceCents > 0 ? savingCents / referenceCents : null,
    estimated: final.estimated,
  }
}

export const COUPON_PART_BASIS: Basis = 'coupon'
const SELLER_ROUNDING_CENTS = CENTS_PER_REAL

function percentPartCents(priceCents: number, coupon: LinkedCouponTerms): number | null {
  if (!validPercent(coupon.percentOff) || coupon.percentOff >= PERCENT_BASE) return null
  const estimate = Math.round((priceCents * coupon.percentOff) / (PERCENT_BASE - coupon.percentOff))
  const limit = maxSavingCents(coupon.kind, coupon.amountOffCents, coupon.capCents)
  return Math.min(estimate, limit ?? estimate)
}

function appliedCouponCents(priceCents: number, coupon: LinkedCouponTerms): number | null {
  if (coupon.kind === 'percent') return percentPartCents(priceCents, coupon)
  if (coupon.kind === 'fixed') return maxSavingCents(coupon.kind, coupon.amountOffCents, coupon.capCents)
  return null
}

export function couponPart(item: PricedItem & { couponHint: string | null }, coupons: readonly LinkedCouponTerms[]): CouponPart | null {
  if (item.basis !== COUPON_PART_BASIS || item.couponHint !== null || coupons.length !== 1) return null
  const applied = appliedCouponCents(item.priceCents, coupons[0])
  if (applied === null) return null
  const listGap = item.listPriceCents === null ? null : item.listPriceCents - item.priceCents
  const couponCents = Math.min(applied, listGap ?? applied)
  if (couponCents <= 0) return null
  const sellerCents = listGap === null ? 0 : listGap - couponCents
  return { couponCents, sellerCents: sellerCents < SELLER_ROUNDING_CENTS ? 0 : sellerCents }
}
