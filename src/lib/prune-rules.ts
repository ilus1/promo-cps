import { MARKET_OFFER_PRUNE_DAYS, PRICE_CHECK_PRUNE_DAYS, SECOND_MS } from './constants'
import { daysBefore } from './freshness'

export const PRUNE_ITEM_DAYS = 90
export const PRUNE_COUPON_DAYS = 60
export const PRUNE_RUN_DAYS = 180
export const PRUNE_LOCK_TIMEOUT_MS = 5 * SECOND_MS
export const PRUNE_BATCH = 5000
export const PRUNE_MAX_BATCHES = 20

export interface PruneCutoffs { items: Date; coupons: Date; runs: Date; priceChecks: Date; marketOffers: Date }
export interface PruneCounts { items: number; coupons: number; runs: number; priceChecks: number; marketOffers: number }

export function pruneCutoffs(now: Date): PruneCutoffs {
  return {
    items: daysBefore(now, PRUNE_ITEM_DAYS),
    coupons: daysBefore(now, PRUNE_COUPON_DAYS),
    runs: daysBefore(now, PRUNE_RUN_DAYS),
    priceChecks: daysBefore(now, PRICE_CHECK_PRUNE_DAYS),
    marketOffers: daysBefore(now, MARKET_OFFER_PRUNE_DAYS),
  }
}

export function pruneLine({ items, coupons, runs, priceChecks, marketOffers }: PruneCounts): string {
  return `${items} item(ns), ${coupons} cupom(ns), ${runs} execução(ões), ${priceChecks} verificação(ões) de preço, ${marketOffers} oferta(s) de mercado`
}

export function pruneAnotherBatch(lastDeleted: number, batchesDone: number): boolean {
  return lastDeleted >= PRUNE_BATCH && batchesDone < PRUNE_MAX_BATCHES
}
