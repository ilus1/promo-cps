import { NextResponse } from 'next/server'
import { z } from 'zod'
import { HTTP_FORBIDDEN } from './http-status'

export const SEC_FETCH_SITE = 'sec-fetch-site'

export const ConfirmRequest = z.object({ confirm: z.literal(true) })

export function rejectUnlessBrowser(req: Request): Response | null {
  if (req.headers.get(SEC_FETCH_SITE) === 'same-origin') return null
  return NextResponse.json({ error: 'browser_only' }, { status: HTTP_FORBIDDEN })
}
