import { and, desc, eq, gte, inArray, lt, max, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { PricePoint, SentWatchAlert, WatchAlertKind } from '@/lib/watch/types'
import { db } from './client'
import { quotesPrice, type ListingState } from '@/lib/watch/listing-state'
import { liveListingCondition } from './watch-listings'
import { listingPriceSegments, watchAlerts, watchedListings } from './schema'

export interface ListingSegment {
  listingId: string
  finalCents: number
  firstSeenAt: Date
  endedAt: Date | null
  listing: ListingState & { checkedAt: Date | null; unavailableSince: Date | null }
}

export interface ProductSegment extends ListingSegment { productId: string }

interface Span { finalCents: number; start: number; end: number }

const earlier = alias(listingPriceSegments, 'earlier')

function lastSegmentEnd(segment: ListingSegment): number {
  const { listing } = segment
  if (quotesPrice(listing) && listing.finalCents === segment.finalCents) return Infinity
  return (listing.unavailableSince ?? listing.checkedAt ?? segment.firstSeenAt).getTime()
}

function spansOf(segments: readonly ListingSegment[]): Span[] {
  const ordered = [...segments].sort((left, right) => (left.listingId === right.listingId
    ? left.firstSeenAt.getTime() - right.firstSeenAt.getTime()
    : left.listingId.localeCompare(right.listingId)))
  return ordered.map((segment, index) => {
    const next = ordered[index + 1]
    const end = next?.listingId === segment.listingId
      ? Math.min(next.firstSeenAt.getTime(), segment.endedAt?.getTime() ?? Infinity)
      : lastSegmentEnd(segment)
    return { finalCents: segment.finalCents, start: segment.firstSeenAt.getTime(), end }
  })
}

export function bestSteps(segments: readonly ListingSegment[], since: Date, before?: Date): PricePoint[] {
  const windowStart = since.getTime()
  const windowEnd = before?.getTime() ?? Infinity
  const spans = spansOf(segments).filter((span) => span.start < span.end && span.end > windowStart)
  const times = [...new Set(spans.flatMap((span) => [Math.max(span.start, windowStart), span.end]))]
    .filter((time) => time < windowEnd)
    .sort((a, b) => a - b)
  const points: PricePoint[] = []
  for (const time of times) {
    const covering = spans.filter((span) => span.start <= time && time < span.end)
    if (covering.length === 0) continue
    const bestCents = Math.min(...covering.map((span) => span.finalCents))
    if (points.at(-1)?.finalCents === bestCents) continue
    points.push({ finalCents: bestCents, at: new Date(time) })
  }
  return points
}

function coversSince(since: Date): SQL {
  const lastSeenBefore = db.select({ at: max(earlier.lastSeenAt) }).from(earlier)
    .where(and(eq(earlier.listingId, listingPriceSegments.listingId), lt(earlier.lastSeenAt, since)))
  return or(gte(listingPriceSegments.lastSeenAt, since), eq(listingPriceSegments.lastSeenAt, lastSeenBefore)) as SQL
}

export async function productSegments(productIds: readonly string[], since: Date): Promise<ProductSegment[]> {
  if (productIds.length === 0) return []
  return db.select({
    productId: watchedListings.productId,
    listingId: listingPriceSegments.listingId,
    finalCents: listingPriceSegments.finalCents,
    firstSeenAt: listingPriceSegments.firstSeenAt,
    endedAt: listingPriceSegments.endedAt,
    listing: {
      inStock: watchedListings.inStock,
      finalCents: watchedListings.finalCents,
      lastError: watchedListings.lastError,
      checkedAt: watchedListings.checkedAt,
      unavailableSince: watchedListings.unavailableSince,
    },
  }).from(listingPriceSegments)
    .innerJoin(watchedListings, eq(watchedListings.id, listingPriceSegments.listingId))
    .where(and(inArray(watchedListings.productId, [...productIds]), liveListingCondition(), coversSince(since)))
}

export async function bestHistory(productId: string, since: Date, before?: Date): Promise<PricePoint[]> {
  return bestSteps(await productSegments([productId], since), since, before)
}

export interface AlertHistory { points: PricePoint[]; knownListingIds: Set<string> }

export function knownListingsOf(segments: readonly ListingSegment[], before: Date): Set<string> {
  return new Set(segments.filter((segment) => segment.firstSeenAt.getTime() < before.getTime()).map((segment) => segment.listingId))
}

export async function alertHistory(productId: string, since: Date, before: Date): Promise<AlertHistory> {
  const segments = await productSegments([productId], since)
  return { points: bestSteps(segments, since, before), knownListingIds: knownListingsOf(segments, before) }
}

export function sentAlerts(productId: string): Promise<SentWatchAlert[]> {
  return db.select({ kind: watchAlerts.kind, priceCents: watchAlerts.priceCents, sentAt: watchAlerts.sentAt })
    .from(watchAlerts)
    .where(eq(watchAlerts.productId, productId))
    .orderBy(desc(watchAlerts.sentAt))
}

export async function logAlert(
  productId: string, kind: WatchAlertKind, priceCents: number, listingId: string | null, now: Date,
): Promise<boolean> {
  const logged = await db.insert(watchAlerts)
    .values({ productId, kind, priceCents, listingId, sentAt: now })
    .onConflictDoNothing()
    .returning({ id: watchAlerts.id })
  return logged.length > 0
}
