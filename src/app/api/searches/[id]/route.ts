import { NextResponse } from 'next/server'
import { deleteSearch, searchByUrl, updateSearch } from '@/db/searches'
import { replanAutoRun } from '@/ingestion/auto-run'
import { isUniqueViolation } from '@/lib/pg-errors'
import { isUuid } from '@/lib/query-params'
import { DUPLICATE_BUSCA } from '@/lib/busca-rules'
import { UpdateBusca } from '@/lib/validation'
import { conflict, notFound, withApi } from '@/lib/with-api'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = withApi(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!isUuid(id)) return notFound()
  const patch = UpdateBusca.parse(await req.json().catch(() => null))
  const sameUrl = patch.url && await searchByUrl(patch.url.url)
  if (sameUrl && sameUrl.id !== id) return conflict(DUPLICATE_BUSCA)
  const row = await updateSearch(id, patch).catch((e: unknown) => {
    if (isUniqueViolation(e)) return null
    throw e
  })
  if (row === null) return conflict(DUPLICATE_BUSCA)
  replanAutoRun()
  return row ? NextResponse.json(row) : notFound()
})

export const DELETE = withApi(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!isUuid(id) || !(await deleteSearch(id))) return notFound()
  replanAutoRun()
  return NextResponse.json({ ok: true })
})
