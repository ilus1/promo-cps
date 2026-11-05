import { NextResponse } from 'next/server'
import { createSearch, listSearches, searchByUrl } from '@/db/searches'
import { replanAutoRun } from '@/ingestion/auto-run'
import { DUPLICATE_BUSCA } from '@/lib/busca-rules'
import { HTTP_CREATED } from '@/lib/http-status'
import { isUniqueViolation } from '@/lib/pg-errors'
import { CreateBusca } from '@/lib/validation'
import { conflict, withApi } from '@/lib/with-api'

export const GET = withApi(async () => NextResponse.json(await listSearches()))

export const POST = withApi(async (req: Request) => {
  const input = CreateBusca.parse(await req.json().catch(() => null))
  if (await searchByUrl(input.url.url)) return conflict(DUPLICATE_BUSCA)
  const row = await createSearch(input).catch((e: unknown) => {
    if (isUniqueViolation(e)) return null
    throw e
  })
  if (!row) return conflict(DUPLICATE_BUSCA)
  replanAutoRun()
  return NextResponse.json(row, { status: HTTP_CREATED })
})
