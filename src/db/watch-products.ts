import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { WATCH_LOW_WINDOW_DAYS, WATCH_RESOLVE_DAYS } from '@/lib/constants'
import { daysBefore } from '@/lib/freshness'
import { isUuid } from '@/lib/query-params'
import { storableOptionalText, storableText } from '@/lib/storable-text'
import type { BestOffer, EanSource, WatchListingView, WatchProductView } from '@/lib/watch/types'
import { db } from './client'
import { bestSteps, productSegments, type ProductSegment } from './watch-alerts'
import { quotesPrice } from '@/lib/watch/listing-state'
import { liveListingsOf, merchantOf } from './watch-listings'
import { watchedListings, watchedProducts } from './schema'

export { WATCH_LOW_WINDOW_DAYS, WATCH_RESOLVE_DAYS }
export const PRODUCT_NOT_CREATED = 'O produto não foi criado'

export interface NewWatchProduct {
  name: string
  query: string
  ean: string | null
  eanSource: EanSource | null
  targetPriceCents: number | null
  dropPercent?: number
}

export type WatchProductPatch = Partial<NewWatchProduct & { active: boolean }>

export interface ProductToResolve {
  id: string
  name: string
  query: string
  ean: string | null
  eanSource: EanSource | null
  resolvedAt: Date | null
}

type ProductRow = typeof watchedProducts.$inferSelect
type ListingRow = typeof watchedListings.$inferSelect

function optionalText(text: string | undefined): string | undefined {
  return text === undefined ? undefined : storableText(text)
}

function patchColumns(patch: WatchProductPatch) {
  return {
    name: optionalText(patch.name),
    query: optionalText(patch.query),
    ean: patch.ean === undefined ? undefined : storableOptionalText(patch.ean),
    eanSource: patch.eanSource,
    targetPriceCents: patch.targetPriceCents,
    dropPercent: patch.dropPercent,
    active: patch.active,
  }
}

export async function createProduct(input: NewWatchProduct, now: Date): Promise<string> {
  const [row] = await db.insert(watchedProducts).values({
    name: storableText(input.name),
    query: storableText(input.query),
    ean: storableOptionalText(input.ean),
    eanSource: input.eanSource,
    targetPriceCents: input.targetPriceCents,
    dropPercent: input.dropPercent,
    createdAt: now,
  }).returning({ id: watchedProducts.id })
  if (!row) throw new Error(PRODUCT_NOT_CREATED)
  return row.id
}

export async function updateProduct(id: string, patch: WatchProductPatch): Promise<boolean> {
  if (!isUuid(id)) return false
  const columns = patchColumns(patch)
  const set = Object.fromEntries(Object.entries(columns).filter(([, value]) => value !== undefined)) as Partial<typeof columns>
  if (Object.keys(set).length === 0) {
    const [found] = await db.select({ id: watchedProducts.id }).from(watchedProducts).where(eq(watchedProducts.id, id)).limit(1)
    return found !== undefined
  }
  const updated = await db.update(watchedProducts).set(set).where(eq(watchedProducts.id, id)).returning({ id: watchedProducts.id })
  return updated.length > 0
}

export function deactivateProduct(id: string): Promise<boolean> {
  return updateProduct(id, { active: false })
}

const RESOLVE_COLUMNS = {
  id: watchedProducts.id,
  name: watchedProducts.name,
  query: watchedProducts.query,
  ean: watchedProducts.ean,
  eanSource: watchedProducts.eanSource,
  resolvedAt: watchedProducts.resolvedAt,
}

export function activeProducts(): Promise<ProductToResolve[]> {
  return db.select(RESOLVE_COLUMNS).from(watchedProducts)
    .where(eq(watchedProducts.active, true))
    .orderBy(asc(watchedProducts.createdAt), asc(watchedProducts.id))
}

export function productsDueForResolve(now: Date): Promise<ProductToResolve[]> {
  return db.select(RESOLVE_COLUMNS).from(watchedProducts)
    .where(and(
      eq(watchedProducts.active, true),
      or(isNull(watchedProducts.resolvedAt), lt(watchedProducts.resolvedAt, daysBefore(now, WATCH_RESOLVE_DAYS))),
    ))
    .orderBy(sql`${watchedProducts.resolvedAt} asc nulls first`, asc(watchedProducts.createdAt), asc(watchedProducts.id))
}

export async function markResolved(id: string, now: Date): Promise<void> {
  await db.update(watchedProducts).set({ resolvedAt: now }).where(eq(watchedProducts.id, id))
}

export function listingView(row: ListingRow): WatchListingView {
  return {
    id: row.id,
    retailer: row.retailer,
    merchant: merchantOf(row.merchant),
    title: row.title,
    url: row.url,
    match: row.match,
    priceCents: row.priceCents,
    listPriceCents: row.listPriceCents,
    finalCents: row.finalCents,
    inStock: row.inStock,
    checkedAt: row.checkedAt,
    lastError: row.lastError,
  }
}

export function bestOffer(listings: readonly WatchListingView[]): BestOffer | null {
  let best: BestOffer | null = null
  for (const listing of listings) {
    if (!quotesPrice(listing)) continue
    if (best !== null && best.finalCents <= listing.finalCents) continue
    best = { listingId: listing.id, retailer: listing.retailer, merchant: listing.merchant, finalCents: listing.finalCents, url: listing.url }
  }
  return best
}

function latestCheck(listings: readonly WatchListingView[]): Date | null {
  const times = listings.flatMap((listing) => (listing.checkedAt ? [listing.checkedAt.getTime()] : []))
  return times.length > 0 ? new Date(Math.max(...times)) : null
}

export function productView(product: ProductRow, listings: readonly WatchListingView[], low30dCents: number | null): WatchProductView {
  return {
    id: product.id,
    name: product.name,
    query: product.query,
    ean: product.ean,
    eanSource: product.eanSource,
    targetPriceCents: product.targetPriceCents,
    dropPercent: product.dropPercent,
    best: bestOffer(listings),
    low30dCents,
    lastCheckedAt: latestCheck(listings),
    resolvedAt: product.resolvedAt,
    listings: [...listings],
  }
}

async function lowsOf(productIds: readonly string[], now: Date): Promise<Map<string, number>> {
  const since = daysBefore(now, WATCH_LOW_WINDOW_DAYS)
  const byProduct = new Map<string, ProductSegment[]>()
  for (const segment of await productSegments(productIds, since)) {
    const segments = byProduct.get(segment.productId)
    if (segments) segments.push(segment)
    else byProduct.set(segment.productId, [segment])
  }
  return new Map([...byProduct].flatMap(([productId, segments]) => {
    const points = bestSteps(segments, since)
    return points.length === 0 ? [] : [[productId, Math.min(...points.map((point) => point.finalCents))] as const]
  }))
}

async function viewsOf(products: readonly ProductRow[], now: Date): Promise<WatchProductView[]> {
  const ids = products.map((product) => product.id)
  const [listings, lows] = await Promise.all([liveListingsOf(ids), lowsOf(ids, now)])
  return products.map((product) => productView(
    product,
    listings.filter((listing) => listing.productId === product.id).map(listingView),
    lows.get(product.id) ?? null,
  ))
}

export async function listWatchedProducts(now: Date): Promise<WatchProductView[]> {
  const products = await db.select().from(watchedProducts)
    .where(eq(watchedProducts.active, true))
    .orderBy(desc(watchedProducts.createdAt), asc(watchedProducts.id))
  return viewsOf(products, now)
}

export async function watchedProduct(id: string, now: Date): Promise<WatchProductView | null> {
  if (!isUuid(id)) return null
  const products = await db.select().from(watchedProducts)
    .where(and(eq(watchedProducts.id, id), eq(watchedProducts.active, true)))
    .limit(1)
  const [view] = await viewsOf(products, now)
  return view ?? null
}
