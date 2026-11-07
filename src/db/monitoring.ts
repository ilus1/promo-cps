import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { isUuid } from '@/lib/query-params'
import { ML_RETAILER, type MatchKind, type WatchLastAlert, type WatchRetailer } from '@/lib/watch/types'
import { db } from './client'
import { ML_LINK_GONE } from './listing-outcome'
import { removedKey, type RemovedRefs } from './removed-refs'
import { liveListingCondition } from './watch-listings'
import { watchAlerts, watchedListings, watchedProducts } from './schema'

export interface RetailerListings { listings: number; unchecked: boolean; oldestCheckAt: Date | null; lastCheckAt: Date | null }

export interface MonitoringCounts { products: number; retailers: Partial<Record<WatchRetailer, RetailerListings>> }

const LINK: MatchKind = 'link'

export async function requestCheck(id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  return db.transaction(async (tx) => {
    const updated = await tx.update(watchedProducts).set({ resolvedAt: null })
      .where(and(eq(watchedProducts.id, id), eq(watchedProducts.active, true)))
      .returning({ id: watchedProducts.id })
    if (updated.length === 0) return false
    await tx.update(watchedListings).set({ checkedAt: null })
      .where(and(eq(watchedListings.productId, id), liveListingCondition(), ne(watchedListings.retailer, ML_RETAILER)))
    await tx.update(watchedListings).set({ lastError: null })
      .where(and(eq(watchedListings.productId, id), liveListingCondition(), eq(watchedListings.lastError, ML_LINK_GONE)))
    return true
  })
}

export async function activeProductExists(id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const [row] = await db.select({ id: watchedProducts.id }).from(watchedProducts)
    .where(and(eq(watchedProducts.id, id), eq(watchedProducts.active, true)))
    .limit(1)
  return row !== undefined
}

export async function removedRefs(productIds: readonly string[]): Promise<Map<string, RemovedRefs>> {
  if (productIds.length === 0) return new Map()
  const rows = await db.select({ productId: watchedListings.productId, retailer: watchedListings.retailer, ref: watchedListings.ref })
    .from(watchedListings)
    .where(inArray(watchedListings.productId, [...productIds]))
    .groupBy(watchedListings.productId, watchedListings.retailer, watchedListings.ref)
    .having(sql`bool_and(${watchedListings.removed})`)
  const byProduct = new Map<string, Set<string>>()
  for (const row of rows) {
    const refs = byProduct.get(row.productId) ?? new Set<string>()
    refs.add(removedKey(row.retailer, row.ref))
    byProduct.set(row.productId, refs)
  }
  return byProduct
}

export async function mlLinksGone(productIds: readonly string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set()
  const rows = await db.selectDistinct({ productId: watchedListings.productId }).from(watchedListings)
    .where(and(
      inArray(watchedListings.productId, [...productIds]),
      eq(watchedListings.retailer, ML_RETAILER),
      eq(watchedListings.match, LINK),
      or(eq(watchedListings.removed, true), eq(watchedListings.lastError, ML_LINK_GONE)),
    ))
  return new Set(rows.map((row) => row.productId))
}

export async function productNames(productIds: string[]): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map()
  const rows = await db.select({ id: watchedProducts.id, name: watchedProducts.name }).from(watchedProducts)
    .where(inArray(watchedProducts.id, productIds))
  return new Map(rows.map((row) => [row.id, row.name]))
}

export async function activeListing(id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const [row] = await db.select({ id: watchedListings.id }).from(watchedListings)
    .innerJoin(watchedProducts, eq(watchedProducts.id, watchedListings.productId))
    .where(and(eq(watchedListings.id, id), liveListingCondition(), eq(watchedProducts.active, true)))
    .limit(1)
  return row !== undefined
}

export async function monitoringCounts(): Promise<MonitoringCounts> {
  const [products, listings] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(watchedProducts).where(eq(watchedProducts.active, true)),
    db.select({
      retailer: watchedListings.retailer,
      listings: sql<number>`count(*)::int`,
      unchecked: sql<boolean>`bool_or(${watchedListings.checkedAt} is null)`,
      oldestCheckAt: sql<Date | null>`min(${watchedListings.checkedAt})`.mapWith(watchedListings.checkedAt),
      lastCheckAt: sql<Date | null>`max(${watchedListings.checkedAt})`.mapWith(watchedListings.checkedAt),
    }).from(watchedListings)
      .innerJoin(watchedProducts, eq(watchedProducts.id, watchedListings.productId))
      .where(and(liveListingCondition(), eq(watchedProducts.active, true)))
      .groupBy(watchedListings.retailer),
  ])
  return {
    products: products[0]?.total ?? 0,
    retailers: Object.fromEntries(listings.map(({ retailer, ...rest }) => [retailer, rest])),
  }
}

export async function lastWatchAlert(): Promise<WatchLastAlert | null> {
  const [row] = await db.select({
    productName: watchedProducts.name,
    kind: watchAlerts.kind,
    priceCents: watchAlerts.priceCents,
    sentAt: watchAlerts.sentAt,
  }).from(watchAlerts)
    .innerJoin(watchedProducts, eq(watchedProducts.id, watchAlerts.productId))
    .orderBy(desc(watchAlerts.sentAt), desc(watchAlerts.id))
    .limit(1)
  return row ?? null
}
