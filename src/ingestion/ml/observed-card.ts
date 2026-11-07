import type { CouponHint } from '@/lib/coupon-hint'
import type { Basis } from '@/lib/domain'

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
