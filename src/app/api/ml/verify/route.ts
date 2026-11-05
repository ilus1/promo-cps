import { NextResponse } from 'next/server'
import { startVerify, verifyStatus } from '@/ingestion/verify'
import { ConfirmRequest, rejectUnlessBrowser } from '@/lib/browser-post'
import { HTTP_ACCEPTED } from '@/lib/http-status'
import { refuseIfHeld } from '@/ingestion/hold-guard'
import { withApi } from '@/lib/with-api'

export const POST = withApi(async (req: Request) => {
  const rejected = rejectUnlessBrowser(req)
  if (rejected) return rejected
  ConfirmRequest.parse(await req.json().catch(() => null))
  const held = await refuseIfHeld()
  if (held) return held
  startVerify()
  return NextResponse.json(verifyStatus(), { status: HTTP_ACCEPTED })
})
