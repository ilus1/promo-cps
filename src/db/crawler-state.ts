import { eq, sql } from 'drizzle-orm'
import type { Retailer } from '@/lib/market/types'
import { db } from './client'
import { crawlerState } from './schema'

export type CrawlerStateRow = typeof crawlerState.$inferSelect

export type CrawlerStatePatch = Partial<Omit<typeof crawlerState.$inferInsert, 'site' | 'updatedAt'>>

async function readCrawlerState(site: Retailer): Promise<CrawlerStateRow | undefined> {
  const [row] = await db.select().from(crawlerState).where(eq(crawlerState.site, site)).limit(1)
  return row
}

export async function loadCrawlerState(site: Retailer): Promise<CrawlerStateRow> {
  const existing = await readCrawlerState(site)
  if (existing) return existing
  const [created] = await db.insert(crawlerState).values({ site }).onConflictDoNothing().returning()
  if (created) return created
  const raced = await readCrawlerState(site)
  if (!raced) throw new Error(`crawler_state row for ${site} is missing`)
  return raced
}

export async function saveCrawlerState(site: Retailer, patch: CrawlerStatePatch): Promise<void> {
  await db.insert(crawlerState).values({ ...patch, site }).onConflictDoUpdate({
    target: crawlerState.site,
    set: { ...patch, updatedAt: sql`now()` },
  })
}
