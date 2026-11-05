import { hintMatches, type CouponHint, type CouponTerms } from '@/lib/coupon-hint'
import type { Basis } from '@/lib/domain'
import { COUPON_BASES } from './basis'

export interface ObservedCard {
  id: string
  productId: string | null
  title: string
  thumbnail: string | null
  url: string | null
  isPad: boolean
  priceCents: number
  basisText: string | null
  basis: Basis
  listPriceCents: number | null
  mlDiscountPct: number | null
  soldQuantity: number | null
  full: boolean | null
  freeShipping: boolean | null
  categoryId: string | null
  domainId: string | null
  sellerLabel: string | null
  couponHint: CouponHint | null
}

export type LinkableCard = Pick<ObservedCard, 'basis' | 'priceCents' | 'couponHint' | 'isPad'>

export function linksToCoupon(card: LinkableCard, coupon: CouponTerms, hintOnly: boolean): boolean {
  if (!hintOnly && COUPON_BASES.includes(card.basis)) return true
  return card.couponHint !== null && hintMatches(card.couponHint, card.priceCents, coupon)
}
