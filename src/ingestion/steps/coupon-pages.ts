import { ML_COUPONS_URL } from '@/lib/constants'
import type { CouponPage } from '../ml/coupons'

export const FIRST_COUPON_PAGE = 1
const EXTRA_PAGES = 1

export interface FirstPageTotals {
  totalCoupons: number
  totalPages: number
  firstPageCount: number
}

export interface HarvestTotals extends FirstPageTotals {
  failedPages: number
  seen: number
  skipped: number
}

export interface PageVisit<T> {
  pageNumber: number
  candidates: T[]
}

export function couponPageUrl(pageNumber: number): string {
  return pageNumber > FIRST_COUPON_PAGE ? `${ML_COUPONS_URL}&page=${pageNumber}` : ML_COUPONS_URL
}

export function rawPageSize({ coupons, skipped }: Pick<CouponPage, 'coupons' | 'skipped'>): number {
  return coupons.length + skipped
}

function pagesNeeded({ totalCoupons, firstPageCount }: FirstPageTotals): number {
  return Math.ceil(totalCoupons / firstPageCount)
}

export function lastPageToRead(totals: FirstPageTotals): number {
  if (totals.firstPageCount === 0) return FIRST_COUPON_PAGE
  return Math.min(totals.totalPages, pagesNeeded(totals) + EXTRA_PAGES)
}

export function emptyPageEndsHarvest(totals: FirstPageTotals, pageNumber: number): boolean {
  return totals.firstPageCount > 0 && pageNumber >= pagesNeeded(totals)
}

export function isFullHarvest(totals: HarvestTotals): boolean {
  const { failedPages, totalCoupons, totalPages, firstPageCount, seen, skipped } = totals
  return failedPages === 0 && skipped === 0 && seen > 0 && totalCoupons > 0 && firstPageCount > 0
    && totalPages >= pagesNeeded(totals)
    && totalCoupons - seen < firstPageCount
}

export function activationVisits<T extends { campaignId: string }>(
  candidates: readonly T[], couponPages: ReadonlyMap<string, number>,
): PageVisit<T>[] {
  const visits = new Map<number, T[]>()
  for (const candidate of candidates) {
    const pageNumber = couponPages.get(candidate.campaignId) ?? FIRST_COUPON_PAGE
    visits.set(pageNumber, [...(visits.get(pageNumber) ?? []), candidate])
  }
  return [...visits].map(([pageNumber, onPage]) => ({ pageNumber, candidates: onPage }))
}
