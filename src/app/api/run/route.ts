import { NextResponse } from 'next/server'
import { cycleActivity, requestCycle } from '@/ingestion/cycle'
import { errorText, redactQueries } from '@/ingestion/errors'
import { ConfirmRequest, rejectUnlessBrowser } from '@/lib/browser-post'
import { HTTP_ACCEPTED } from '@/lib/http-status'
import { refuseIfHeld } from '@/ingestion/hold-guard'
import { withApi } from '@/lib/with-api'

const CYCLE_LOG_TAG = '[cycle]'

export const POST = withApi(async (req: Request) => {
  const rejected = rejectUnlessBrowser(req)
  if (rejected) return rejected
  ConfirmRequest.parse(await req.json().catch(() => null))
  const held = await refuseIfHeld()
  if (held) return held
  requestCycle().catch((e) => console.error(CYCLE_LOG_TAG, redactQueries(errorText(e))))
  return NextResponse.json(cycleActivity(), { status: HTTP_ACCEPTED })
})
