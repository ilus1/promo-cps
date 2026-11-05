import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { env } from '@/env'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FORBIDDEN, HTTP_INTERNAL_ERROR, HTTP_NOT_FOUND, HTTP_UNPROCESSABLE } from './http-status'
import { isLocalRequest, isSafeMethod } from './local-origin'

export function withApi<A extends unknown[]>(
  handler: (...a: A) => Promise<Response>,
) {
  return async (...a: A): Promise<Response> => {
    try {
      const req = a[0] as Request
      if (!isSafeMethod(req.method) && !isLocalRequest(req, env().PORT)) {
        return NextResponse.json({ error: 'forbidden_origin' }, { status: HTTP_FORBIDDEN })
      }
      return await handler(...a)
    } catch (e) {
      if (e instanceof ZodError) {
        return NextResponse.json({ error: 'invalid_request', details: e.flatten() }, { status: HTTP_BAD_REQUEST })
      }
      console.error(e)
      return NextResponse.json({ error: 'internal_error' }, { status: HTTP_INTERNAL_ERROR })
    }
  }
}

export function notFound(): Response {
  return NextResponse.json({ error: 'not_found' }, { status: HTTP_NOT_FOUND })
}

export function conflict(error: string): Response {
  return NextResponse.json({ error }, { status: HTTP_CONFLICT })
}

export function unprocessable(error: string): Response {
  return NextResponse.json({ error }, { status: HTTP_UNPROCESSABLE })
}
