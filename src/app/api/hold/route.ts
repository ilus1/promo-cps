import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PRICE_CHECKS_PAUSED_KEY, REQUESTS_PAUSED_KEY, setHoldSetting } from '@/db/app-settings'
import { holdState } from '@/ingestion/request-hold'
import { withApi } from '@/lib/with-api'

const HoldChange = z.object({
  requestsPaused: z.boolean().optional(),
  priceChecksPaused: z.boolean().optional(),
}).strict().refine((change) => change.requestsPaused !== undefined || change.priceChecksPaused !== undefined)

export const GET = withApi(async () => NextResponse.json(await holdState(new Date())))

export const POST = withApi(async (req: Request) => {
  const change = HoldChange.parse(await req.json().catch(() => null))
  if (change.requestsPaused !== undefined) await setHoldSetting(REQUESTS_PAUSED_KEY, change.requestsPaused)
  if (change.priceChecksPaused !== undefined) await setHoldSetting(PRICE_CHECKS_PAUSED_KEY, change.priceChecksPaused)
  return NextResponse.json(await holdState(new Date()))
})
