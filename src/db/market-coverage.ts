import { sql } from 'drizzle-orm'
import type { MarketCoverage } from '@/lib/market/types'
import { db } from './client'
import { items, priceChecks } from './schema'
import { priorityNovosSql } from './target-tiers'
import { validHighCheck } from './verdict-sql'

export type CoverageCounts = Pick<MarketCoverage, 'matched' | 'total'>

export async function marketCoverage(now: Date): Promise<CoverageCounts> {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    matched: sql<number>`(count(*) filter (where exists (select 1 from ${priceChecks} where ${validHighCheck(now)})))::int`,
  }).from(items).where(priorityNovosSql(now))
  return { matched: row?.matched ?? 0, total: row?.total ?? 0 }
}
