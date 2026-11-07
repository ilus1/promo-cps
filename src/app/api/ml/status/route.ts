import { NextResponse } from 'next/server'
import { lastRun } from '@/db/runs'
import { cycleActivity } from '@/ingestion/cycle'
import { loginStatus } from '@/ingestion/login'
import { verifyStatus } from '@/ingestion/verify'
import type { MlStatus } from '@/lib/domain'
import { withApi } from '@/lib/with-api'

export const GET = withApi(async () => {
  const run = await lastRun('cycle')
  const status: MlStatus = {
    ...loginStatus(),
    verify: verifyStatus(),
    cycle: cycleActivity(),
    lastRun: run
      ? {
          status: run.status,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          error: run.error,
        }
      : null,
  }
  return NextResponse.json(status)
})
