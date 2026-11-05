import { NextResponse } from 'next/server'
import { prioritizeCoupons } from '@/db/coupons'
import { autoRunStatus } from '@/ingestion/auto-run'
import { cycleActivity } from '@/ingestion/cycle'
import { couponFiltersOf, hasCouponFilters } from '@/lib/coupon-query'
import { PRIORITY_FILTER_REQUIRED } from '@/lib/coupon-rules'
import { PrioritizeCoupons } from '@/lib/validation'
import { unprocessable, withApi } from '@/lib/with-api'

export const POST = withApi(async (req: Request) => {
  const input = PrioritizeCoupons.parse(await req.json().catch(() => null))
  const filters = couponFiltersOf(input.query)
  if (!hasCouponFilters(filters)) return unprocessable(PRIORITY_FILTER_REQUIRED)
  const prioritized = await prioritizeCoupons(filters, new Date())
  const { cycleNextRunAt, pause, running } = autoRunStatus()
  return NextResponse.json({
    prioritized, cycleNextRunAt, pause, running: running || cycleActivity().phase !== 'idle',
  })
})
