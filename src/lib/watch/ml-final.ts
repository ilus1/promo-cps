import { COUPON_BASES } from '@/ingestion/ml/basis'
import type { ObservedCard } from '@/ingestion/ml/observed-card'
import type { CouponHint } from '../coupon-hint'
import { PERCENT_BASE } from '../constants'
import { storableOptionalText, storableText } from '../storable-text'
import { mlItemUrl } from './links'
import { ML_RETAILER, type ListingCandidate, type ListingQuote } from './types'

const NO_DISCOUNT = 0

function couponDiscountCents(priceCents: number, hint: CouponHint): number {
  if (hint.priceAfterCents !== null) return priceCents - hint.priceAfterCents
  if (hint.percentOff !== null) return Math.round((priceCents * hint.percentOff) / PERCENT_BASE)
  return hint.amountOffCents ?? NO_DISCOUNT
}

export function mlFinalCents(priceCents: number, couponHint: CouponHint | null): number {
  if (!couponHint) return priceCents
  const discount = couponDiscountCents(priceCents, couponHint)
  return discount > NO_DISCOUNT && discount < priceCents ? priceCents - discount : priceCents
}

export function mlCandidate(card: ObservedCard): ListingCandidate {
  return {
    retailer: ML_RETAILER,
    ref: card.id,
    url: storableText(card.url ?? mlItemUrl(card.id)),
    title: storableText(card.title),
    ean: null,
    merchant: storableOptionalText(card.sellerLabel),
    priceCents: card.priceCents,
    listPriceCents: card.listPriceCents,
    inStock: true,
  }
}

export function mlQuote(card: ObservedCard): ListingQuote {
  return {
    ref: card.id,
    merchant: storableOptionalText(card.sellerLabel),
    title: storableText(card.title),
    priceCents: card.priceCents,
    listPriceCents: card.listPriceCents,
    finalCents: COUPON_BASES.includes(card.basis) ? card.priceCents : mlFinalCents(card.priceCents, card.couponHint),
    inStock: true,
  }
}
