import { setTimeout as sleep } from 'node:timers/promises'
import type { Page } from 'playwright'
import { activationCandidates, recordActivation } from '@/db/coupons'
import { env } from '@/env'
import type { ActivationOutcome } from '@/lib/domain'
import { applyCoupon, COUPON_WITHOUT_APPLY, matchOnPage } from '../ml/activate-click'
import { tryParseCouponPage } from '../ml/coupons'
import { loadPageProps, throwIfClosed } from '../ml/page-state'
import { clickBreaker, type LoadBreaker } from './breaker'
import { activationVisits, couponPageUrl } from './coupon-pages'

export interface ActivationResult {
  activated: number
  failed: number
  skipped: number
  pages: number
}

export async function activate(
  page: Page, limit: number, now: Date, couponPages: ReadonlyMap<string, number>, loads: LoadBreaker,
): Promise<ActivationResult> {
  const result: ActivationResult = { activated: 0, failed: 0, skipped: 0, pages: 0 }
  if (limit === 0) return result
  const record = async (campaignId: string, outcome: ActivationOutcome) => {
    await recordActivation(campaignId, outcome, new Date())
    if (outcome.ok) result.activated += 1
    else result.failed += 1
  }
  const candidates = await activationCandidates(limit, now, couponPages.size > 0 ? [...couponPages.keys()] : undefined)
  const clicks = clickBreaker()
  for (const visit of activationVisits(candidates, couponPages)) {
    result.pages += 1
    const loaded = await loads.load(() => loadPageProps(page, couponPageUrl(visit.pageNumber)).catch((e: unknown) => {
      throwIfClosed(page, e)
      throw e
    }))
    if (!loaded.ok) continue
    const parse = tryParseCouponPage(loaded.value.pageProps)
    if (!parse.ok) break
    const { applicable, notApplicable } = matchOnPage(visit.candidates, parse.page.coupons, now)
    for (const { campaignId } of notApplicable) await record(campaignId, { ok: false, error: COUPON_WITHOUT_APPLY })
    for (const { candidate, coupon } of applicable) {
      if (page.url() !== loaded.value.finalUrl) break
      await loads.checkHold()
      const applied = await applyCoupon(page, coupon)
      if (!applied.attempted) continue
      await record(candidate.campaignId, applied.outcome)
      clicks.saw(applied.click)
      await sleep(env().PAGE_DELAY_MS)
    }
  }
  result.skipped = candidates.length - result.activated - result.failed
  return result
}
