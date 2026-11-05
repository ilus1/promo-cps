import { NextResponse } from 'next/server'
import { alertByQuery, createAlert, hasUnknownBusca, listAlerts } from '@/db/alerts'
import { BUSCA_NOT_FOUND, DUPLICATE_ALERT } from '@/lib/alert-rules'
import { normalizeAlertQuery } from '@/lib/deal-query'
import { HTTP_CREATED } from '@/lib/http-status'
import { isUniqueViolation } from '@/lib/pg-errors'
import { CreateAlert } from '@/lib/validation'
import { conflict, unprocessable, withApi } from '@/lib/with-api'

export const GET = withApi(async () => NextResponse.json(await listAlerts()))

export const POST = withApi(async (req: Request) => {
  const input = CreateAlert.parse(await req.json().catch(() => null))
  const query = normalizeAlertQuery(new URLSearchParams(input.query))
  if (await hasUnknownBusca(query)) return unprocessable(BUSCA_NOT_FOUND)
  if (await alertByQuery(query)) return conflict(DUPLICATE_ALERT)
  const row = await createAlert({ name: input.name, query }).catch((e: unknown) => {
    if (isUniqueViolation(e)) return null
    throw e
  })
  if (!row) return conflict(DUPLICATE_ALERT)
  return NextResponse.json(row, { status: HTTP_CREATED })
})
