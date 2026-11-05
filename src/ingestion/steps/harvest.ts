import type { Page } from 'playwright'
import { upsertCoupons } from '@/db/coupons'
import { loadWithRetry } from '../ml/page-state'
import type { LoadBreaker } from './breaker'
import { couponPageUrl } from './coupon-pages'
import { readCouponPages, type HarvestResult } from './harvest-pages'

export type { HarvestResult }

export async function harvest(page: Page, breaker: LoadBreaker): Promise<HarvestResult> {
  return readCouponPages({
    load: async (pageNumber) => {
      const loaded = await breaker.load(() => loadWithRetry(page, couponPageUrl(pageNumber)))
      return loaded.ok ? { ok: true, value: loaded.value.pageProps } : loaded
    },
    store: async (coupons) => (await upsertCoupons(coupons, new Date())).inserted,
  })
}
