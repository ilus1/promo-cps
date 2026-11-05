import { NextResponse } from 'next/server'
import { z } from 'zod'
import { setItemStatus } from '@/db/items'
import { ITEM_STATUSES } from '@/lib/domain'
import { notFound, withApi } from '@/lib/with-api'

const ItemPatch = z.object({ status: z.enum(ITEM_STATUSES) })

export const PATCH = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const { status } = ItemPatch.parse(await req.json().catch(() => null))
  if (!(await setItemStatus(id, status))) return notFound()
  return NextResponse.json({ ok: true })
})
