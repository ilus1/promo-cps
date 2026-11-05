import { NextResponse } from 'next/server'
import { getSearch } from '@/db/searches'
import { errorText, redactQueries } from '@/ingestion/errors'
import { buscaActivity, requestBuscaRun } from '@/ingestion/search-run'
import { ConfirmRequest, rejectUnlessBrowser } from '@/lib/browser-post'
import { HTTP_ACCEPTED } from '@/lib/http-status'
import { isUuid } from '@/lib/query-params'
import { refuseIfHeld } from '@/ingestion/hold-guard'
import { notFound, withApi } from '@/lib/with-api'

const BUSCA_LOG_TAG = '[busca]'

export const POST = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const rejected = rejectUnlessBrowser(req)
  if (rejected) return rejected
  ConfirmRequest.parse(await req.json().catch(() => null))
  const { id } = await ctx.params
  if (!isUuid(id) || !(await getSearch(id))) return notFound()
  const held = await refuseIfHeld()
  if (held) return held
  requestBuscaRun(id).catch((e) => console.error(BUSCA_LOG_TAG, redactQueries(errorText(e))))
  return NextResponse.json(buscaActivity(id), { status: HTTP_ACCEPTED })
})
