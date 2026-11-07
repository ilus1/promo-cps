import { NextResponse } from 'next/server'
import { activeListing } from '@/db/monitoring'
import { removeListing } from '@/db/watch-listings'
import { notFound, withApi } from '@/lib/with-api'

export const DELETE = withApi(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  if (!(await activeListing(id)) || !(await removeListing(id))) return notFound()
  return NextResponse.json({ ok: true })
})
