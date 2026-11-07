import { NextResponse } from 'next/server'
import { activeProductExists } from '@/db/monitoring'
import { deactivateProduct, updateProduct, type WatchProductPatch } from '@/db/watch-products'
import { requestWatchCheck } from '@/ingestion/watch/loops'
import { isUuid } from '@/lib/query-params'
import { UpdateWatch } from '@/lib/validation'
import { notFound, withApi } from '@/lib/with-api'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = withApi(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!isUuid(id)) return notFound()
  const input = UpdateWatch.parse(await req.json().catch(() => null))
  if (input.active !== true && !(await activeProductExists(id))) return notFound()
  const patch: WatchProductPatch = {
    ...(input.name === undefined ? {} : { name: input.name, query: input.name }),
    ...(input.ean === undefined ? {} : { ean: input.ean, eanSource: input.ean === null ? null : 'manual' }),
    targetPriceCents: input.targetPriceCents,
    dropPercent: input.dropPercent,
    active: input.active,
  }
  if (!(await updateProduct(id, patch))) return notFound()
  if (input.name !== undefined || input.ean !== undefined || input.active === true) await requestWatchCheck(id)
  return NextResponse.json({ ok: true })
})

export const DELETE = withApi(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!isUuid(id) || !(await activeProductExists(id)) || !(await deactivateProduct(id))) return notFound()
  return NextResponse.json({ ok: true })
})
