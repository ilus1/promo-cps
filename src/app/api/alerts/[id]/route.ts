import { NextResponse } from 'next/server'
import { deleteAlert } from '@/db/alerts'
import { isUuid } from '@/lib/query-params'
import { notFound, withApi } from '@/lib/with-api'

type Ctx = { params: Promise<{ id: string }> }

export const DELETE = withApi(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!isUuid(id) || !(await deleteAlert(id))) return notFound()
  return NextResponse.json({ ok: true })
})
