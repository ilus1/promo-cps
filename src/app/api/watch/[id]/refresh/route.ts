import { NextResponse } from 'next/server'
import { activeProductExists } from '@/db/monitoring'
import { requestHold } from '@/ingestion/request-hold'
import { requestWatchCheck, WATCH_OFF_TEXT, watchRunning } from '@/ingestion/watch/loops'
import { HTTP_ACCEPTED } from '@/lib/http-status'
import { isUuid } from '@/lib/query-params'
import { conflict, notFound, withApi } from '@/lib/with-api'

export const POST = withApi(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  if (!isUuid(id) || !(await activeProductExists(id))) return notFound()
  if (!watchRunning()) return conflict(WATCH_OFF_TEXT)
  const hold = await requestHold(new Date())
  if (hold) return conflict(hold.text)
  if (!(await requestWatchCheck(id))) return notFound()
  return NextResponse.json({ ok: true }, { status: HTTP_ACCEPTED })
})
