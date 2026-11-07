import { NextResponse } from 'next/server'
import { env } from '@/env'
import { lastRun } from '@/db/runs'
import { autoRunStatus } from '@/ingestion/auto-run'
import { errorText } from '@/ingestion/errors'
import { requestHold } from '@/ingestion/request-hold'
import { watchStatus } from '@/ingestion/watch/loops'
import { SECOND_MS } from '@/lib/constants'
import { healthReport } from '@/lib/health-view'
import type { WatchSourceStatus } from '@/lib/watch/types'
import { withApi } from '@/lib/with-api'

const LOG_TAG = '[health]'

async function readWatch(now: Date): Promise<WatchSourceStatus[] | null> {
  try {
    return (await watchStatus(now)).sources
  } catch (e) {
    console.error(LOG_TAG, 'watch status failed:', errorText(e))
    return null
  }
}

export const GET = withApi(async () => {
  const now = new Date()
  const [cycle, hold, watch] = await Promise.all([lastRun('cycle'), requestHold(now), readWatch(now)])
  const auto = autoRunStatus()
  return NextResponse.json(healthReport({
    schedulerEnabled: env().AUTO_RUN === 'on',
    serverStartedAt: new Date(Date.now() - process.uptime() * SECOND_MS),
    lastCycle: cycle ?? null,
    pause: auto.pause,
    nextRunAt: auto.nextRunAt,
    runEveryHours: env().RUN_EVERY_HOURS,
    hold,
    watch,
  }))
})
