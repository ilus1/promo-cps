import { NextResponse } from 'next/server'
import { loginStatus, startLogin } from '@/ingestion/login'
import { ConfirmRequest, rejectUnlessBrowser, SEC_FETCH_SITE } from '@/lib/browser-post'
import { HTTP_ACCEPTED } from '@/lib/http-status'
import { refuseIfHeld } from '@/ingestion/hold-guard'
import { withApi } from '@/lib/with-api'

const LOGGED_HEADERS = ['origin', 'referer', SEC_FETCH_SITE, 'user-agent']

export const POST = withApi(async (req: Request) => {
  console.info('[login] request', Object.fromEntries(LOGGED_HEADERS.map((h) => [h, req.headers.get(h)])))
  const rejected = rejectUnlessBrowser(req)
  if (rejected) return rejected
  ConfirmRequest.parse(await req.json().catch(() => null))
  const held = await refuseIfHeld()
  if (held) return held
  startLogin()
  return NextResponse.json(loginStatus(), { status: HTTP_ACCEPTED })
})
