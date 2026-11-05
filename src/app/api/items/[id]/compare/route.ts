import { NextResponse } from 'next/server'
import { prioritizeSearch } from '@/db/market-searches'
import { itemToCheck } from '@/db/price-checks'
import { matchItemLocally } from '@/ingestion/market/match-local'
import type { CompareResponse, SearchPriority } from '@/lib/market/types'
import { compareQuery } from '@/lib/price-compare/clean-title'
import { checkKey } from '@/lib/price-check-rules'
import { notFound, withApi } from '@/lib/with-api'

const NOT_QUEUED: SearchPriority = { queued: false, searchedAt: null }

export const POST = withApi(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const now = new Date()
  const item = await itemToCheck(id, now)
  if (!item) return notFound()
  const status = await matchItemLocally(item, now)
  const query = compareQuery(item.title)
  const priority = query === '' ? NOT_QUEUED : await prioritizeSearch(checkKey(item), query, now)
  const body: CompareResponse = { status, amazonQueued: priority.queued, amazonSearchedAt: priority.searchedAt?.toISOString() ?? null }
  return NextResponse.json(body)
})
