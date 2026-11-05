import { NextResponse } from 'next/server'
import { env } from '@/env'
import { lastRun } from '@/db/runs'
import { autoRunStatus } from '@/ingestion/auto-run'
import { errorText } from '@/ingestion/errors'
import { marketStatus } from '@/ingestion/market/crawlers'
import { requestHold } from '@/ingestion/request-hold'
import { SECOND_MS } from '@/lib/constants'
import { healthReport } from '@/lib/health-view'
import type { MarketStatus } from '@/lib/market/types'
import { withApi } from '@/lib/with-api'

const LOG_TAG = '[health]'

function readMarket(now: Date): Promise<MarketStatus | null> {
  return marketStatus(now).catch((e: unknown) => {
    console.error(LOG_TAG, 'market status failed:', errorText(e))
    return null
  })
}

export const GET = withApi(async () => {
  const now = new Date()
  const [cycle, hold, market] = await Promise.all([lastRun('cycle'), requestHold(now), readMarket(now)])
  const auto = autoRunStatus()
  return NextResponse.json(healthReport({
    schedulerEnabled: env().AUTO_RUN === 'on',
    serverStartedAt: new Date(Date.now() - process.uptime() * SECOND_MS),
    lastCycle: cycle ?? null,
    pause: auto.pause,
    nextRunAt: auto.nextRunAt,
    runEveryHours: env().RUN_EVERY_HOURS,
    hold,
    market,
  }))
})
