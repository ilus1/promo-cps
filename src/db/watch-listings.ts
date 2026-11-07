import { and, asc, desc, eq, inArray, isNull, lt, min, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { WATCH_REFRESH_HOURS } from '@/lib/constants'
import { hoursBefore } from '@/lib/freshness'
import { isUuid } from '@/lib/query-params'
import { storableOptionalText, storableText } from '@/lib/storable-text'
import { merchantKeyOf } from '@/lib/watch/merchant-key'
import type { ListingQuote, MatchKind, WatchRetailer } from '@/lib/watch/types'
import { db, type Tx } from './client'
import { listingPriceSegments, NO_MERCHANT, watchedListings, watchedProducts } from './schema'
import { takesQuote, type ListingUpsert } from './listing-outcome'

export { WATCH_REFRESH_HOURS }
export const LISTING_NOT_SAVED = 'O anúncio não foi salvo'

export interface NewListing {
  retailer: WatchRetailer
  ref: string
  url: string
  title: string
  merchant: string | null
  match: MatchKind
}

export type { ListingUpsert }

export interface DueListing {
  id: string
  productId: string
  retailer: WatchRetailer
  ref: string
  merchant: string | null
  url: string
  title: string
}

export interface ListingPage { retailer: WatchRetailer; ref: string; url: string; title: string; match: MatchKind }

export interface DuePage extends ListingPage { productId: string }

export function merchantName(merchant: string | null): string {
  return merchant === null ? NO_MERCHANT : storableText(merchant).trim()
}

export function merchantKey(merchant: string | null): string {
  return merchant === null ? NO_MERCHANT : merchantKeyOf(merchant)
}

export function merchantOf(merchant: string): string | null {
  return merchant === NO_MERCHANT ? null : merchant
}

export function liveListingCondition(): SQL {
  return sql`${watchedListings.removed} = false`
}

function unavailableFrom(now: Date): SQL {
  return sql`coalesce(${watchedListings.unavailableSince}, ${sql.param(now, watchedListings.unavailableSince)})`
}

function pageCondition(productId: string, retailer: WatchRetailer, ref: string): SQL {
  return and(eq(watchedListings.productId, productId), eq(watchedListings.retailer, retailer), eq(watchedListings.ref, storableText(ref)), liveListingCondition()) as SQL
}

interface StoreRow { id: string; ref: string; removed: boolean }

function existingOutcome(rows: readonly StoreRow[], ref: string): ListingUpsert | null {
  const same = rows.find((row) => row.ref === ref)
  if (same) return { id: same.id, status: same.removed ? 'removed' : 'updated' }
  const live = rows.find((row) => !row.removed)
  return live ? { id: live.id, status: 'kept' } : null
}

async function upsertListingIn(tx: Tx, productId: string, listing: NewListing, now: Date): Promise<ListingUpsert> {
  const key = merchantKey(listing.merchant)
  const ref = storableText(listing.ref)
  const store = and(eq(watchedListings.productId, productId), eq(watchedListings.retailer, listing.retailer), eq(watchedListings.merchantKey, key))
  const storeRows = () => tx.select({ id: watchedListings.id, ref: watchedListings.ref, removed: watchedListings.removed })
    .from(watchedListings).where(store).for('update')
  const details = { merchant: merchantName(listing.merchant), url: storableText(listing.url), title: storableText(listing.title) }
  const existing = existingOutcome(await storeRows(), ref)
  if (existing?.status === 'updated') await tx.update(watchedListings).set(details).where(eq(watchedListings.id, existing.id))
  if (existing) return existing
  const [inserted] = await tx.insert(watchedListings)
    .values({ productId, retailer: listing.retailer, merchantKey: key, ref, match: listing.match, createdAt: now, ...details })
    .onConflictDoNothing()
    .returning({ id: watchedListings.id })
  if (inserted) return { id: inserted.id, status: 'inserted' }
  const raced = existingOutcome(await storeRows(), ref)
  if (!raced) throw new Error(LISTING_NOT_SAVED)
  return raced
}

export function upsertListing(productId: string, listing: NewListing, now: Date): Promise<ListingUpsert> {
  return db.transaction((tx) => upsertListingIn(tx, productId, listing, now))
}

export async function removeListing(listingId: string): Promise<boolean> {
  if (!isUuid(listingId)) return false
  const removed = await db.update(watchedListings).set({ removed: true })
    .where(eq(watchedListings.id, listingId))
    .returning({ id: watchedListings.id })
  return removed.length > 0
}

export function dueForRefreshCondition(retailer: WatchRetailer, now: Date): SQL {
  return and(
    eq(watchedListings.retailer, retailer),
    liveListingCondition(),
    eq(watchedProducts.active, true),
    or(isNull(watchedListings.checkedAt), lt(watchedListings.checkedAt, hoursBefore(now, WATCH_REFRESH_HOURS))),
  ) as SQL
}

export async function listingsDueForRefresh(retailer: WatchRetailer, now: Date, limit: number): Promise<DueListing[]> {
  const rows = await db.select({
    id: watchedListings.id,
    productId: watchedListings.productId,
    retailer: watchedListings.retailer,
    ref: watchedListings.ref,
    merchant: watchedListings.merchant,
    url: watchedListings.url,
    title: watchedListings.title,
  }).from(watchedListings)
    .innerJoin(watchedProducts, eq(watchedProducts.id, watchedListings.productId))
    .where(dueForRefreshCondition(retailer, now))
    .orderBy(sql`${watchedListings.checkedAt} asc nulls first`, asc(watchedListings.id))
    .limit(limit)
  return rows.map((row) => ({ ...row, merchant: merchantOf(row.merchant) }))
}

export async function pagesDueForRefresh(retailer: WatchRetailer, now: Date, limit: number): Promise<DuePage[]> {
  const oldestCheck = sql`min(coalesce(${watchedListings.checkedAt}, '-infinity'::timestamptz))`
  const rows = await db.select({
    productId: watchedListings.productId,
    ref: watchedListings.ref,
    url: min(watchedListings.url),
    title: min(watchedListings.title),
    match: min(watchedListings.match),
  }).from(watchedListings)
    .innerJoin(watchedProducts, eq(watchedProducts.id, watchedListings.productId))
    .where(dueForRefreshCondition(retailer, now))
    .groupBy(watchedListings.productId, watchedListings.ref)
    .orderBy(oldestCheck, asc(watchedListings.productId), asc(watchedListings.ref))
    .limit(limit)
  return rows.flatMap((row) => (row.url === null || row.title === null || row.match === null
    ? []
    : [{ productId: row.productId, retailer, ref: row.ref, url: row.url, title: row.title, match: row.match }]))
}

interface Availability { unavailableSince: Date | null; inStock: boolean | null }

async function unavailableSinceOf(tx: Tx, listingId: string): Promise<Availability> {
  const [row] = await tx.select({ unavailableSince: watchedListings.unavailableSince, inStock: watchedListings.inStock }).from(watchedListings)
    .where(eq(watchedListings.id, listingId))
    .for('update')
  return row ?? { unavailableSince: null, inStock: null }
}

function stockOutSince({ unavailableSince, inStock }: Availability): Date | null {
  return inStock === false ? unavailableSince : null
}

async function writeSegment(tx: Tx, listingId: string, quote: ListingQuote, endedAt: Date | null, now: Date): Promise<void> {
  const [open] = await tx.select({
    id: listingPriceSegments.id,
    priceCents: listingPriceSegments.priceCents,
    finalCents: listingPriceSegments.finalCents,
  }).from(listingPriceSegments)
    .where(eq(listingPriceSegments.listingId, listingId))
    .orderBy(desc(listingPriceSegments.lastSeenAt), desc(listingPriceSegments.id))
    .limit(1)
  if (open && open.priceCents === quote.priceCents && open.finalCents === quote.finalCents) {
    await tx.update(listingPriceSegments).set({ lastSeenAt: now }).where(eq(listingPriceSegments.id, open.id))
    return
  }
  if (open && endedAt) await tx.update(listingPriceSegments).set({ endedAt }).where(eq(listingPriceSegments.id, open.id))
  await tx.insert(listingPriceSegments).values({
    listingId, priceCents: quote.priceCents, finalCents: quote.finalCents, firstSeenAt: now, lastSeenAt: now,
  })
}

async function recordQuoteIn(tx: Tx, listingId: string, quote: ListingQuote, now: Date): Promise<void> {
  const title = storableOptionalText(quote.title)
  const endedAt = quote.inStock ? stockOutSince(await unavailableSinceOf(tx, listingId)) : null
  await tx.update(watchedListings).set({
    priceCents: quote.priceCents,
    listPriceCents: quote.listPriceCents,
    finalCents: quote.finalCents,
    inStock: quote.inStock,
    checkedAt: now,
    unavailableSince: quote.inStock ? null : unavailableFrom(now),
    lastError: null,
    ...(title ? { title } : {}),
  }).where(eq(watchedListings.id, listingId))
  if (quote.inStock) await writeSegment(tx, listingId, quote, endedAt, now)
}

export function recordQuote(listingId: string, quote: ListingQuote, now: Date): Promise<void> {
  return db.transaction((tx) => recordQuoteIn(tx, listingId, quote, now))
}

export function recordPageQuotes(productId: string, page: ListingPage, quotes: readonly ListingQuote[], now: Date): Promise<ListingUpsert[]> {
  return db.transaction(async (tx) => {
    const outcomes: ListingUpsert[] = []
    for (const quote of quotes) {
      const listing: NewListing = { ...page, merchant: quote.merchant, title: quote.title ?? page.title }
      const outcome = await upsertListingIn(tx, productId, listing, now)
      outcomes.push(outcome)
      if (!takesQuote(outcome)) continue
      await recordQuoteIn(tx, outcome.id, quote, now)
    }
    const quoted = quotes.map((quote) => merchantKey(quote.merchant))
    await tx.update(watchedListings)
      .set({ inStock: false, checkedAt: now, unavailableSince: unavailableFrom(now), lastError: null })
      .where(and(pageCondition(productId, page.retailer, page.ref), notInArray(watchedListings.merchantKey, quoted)))
    return outcomes
  })
}

function errorColumns(error: string, now: Date) {
  return { lastError: storableText(error), checkedAt: now, unavailableSince: unavailableFrom(now) }
}

export async function recordListingError(listingId: string, error: string, now: Date): Promise<void> {
  await db.update(watchedListings).set(errorColumns(error, now)).where(eq(watchedListings.id, listingId))
}

export async function recordListingGone(listingId: string, error: string, now: Date): Promise<void> {
  await db.update(watchedListings).set({ ...errorColumns(error, now), inStock: false }).where(eq(watchedListings.id, listingId))
}

export async function recordPageError(productId: string, retailer: WatchRetailer, ref: string, error: string, now: Date): Promise<void> {
  await db.update(watchedListings).set(errorColumns(error, now)).where(pageCondition(productId, retailer, ref))
}

export async function liveListingsOf(productIds: readonly string[]) {
  if (productIds.length === 0) return []
  return db.select().from(watchedListings)
    .where(and(inArray(watchedListings.productId, [...productIds]), liveListingCondition()))
    .orderBy(asc(watchedListings.retailer), asc(watchedListings.merchant), asc(watchedListings.createdAt))
}
