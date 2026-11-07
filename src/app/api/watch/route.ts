import { NextResponse } from 'next/server'
import { createProduct } from '@/db/watch-products'
import { wakeWatch, watchRunning } from '@/ingestion/watch/loops'
import { HTTP_CREATED } from '@/lib/http-status'
import { CreateWatch } from '@/lib/validation'
import { withApi } from '@/lib/with-api'

export const POST = withApi(async (req: Request) => {
  const input = CreateWatch.parse(await req.json().catch(() => null))
  const { name } = input.nameOrLink
  const id = await createProduct({
    name,
    query: name,
    ean: input.ean ?? null,
    eanSource: input.ean === undefined ? null : 'manual',
    targetPriceCents: input.targetPriceCents ?? null,
    dropPercent: input.dropPercent,
  }, new Date())
  wakeWatch()
  return NextResponse.json({ id, started: watchRunning() }, { status: HTTP_CREATED })
})
