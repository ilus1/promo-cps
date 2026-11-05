import { and, asc, between, desc, eq, gte, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import { chunks, lastByKey } from '@/lib/batch'
import { AMAZON_OFFER_VALID_DAYS, KABUM_OFFER_VALID_DAYS, MARKET_CANDIDATE_LIMIT } from '@/lib/constants'
import { daysBefore } from '@/lib/freshness'
import { hasRetrievalTerms, offerTokens } from '@/lib/market/tokens'
import { RETAILERS, type MarketOffer, type Retailer, type RetrievalTerms } from '@/lib/market/types'
import { priceBand } from '@/lib/price-compare/match'
import { pruneCutoffs } from '@/lib/prune-rules'
import { db, type Tx } from './client'
import { marketOffers } from './schema'
import { conflictUpdates, OVERWRITE } from './sql'

const OFFER_VALID_DAYS: Record<Retailer, number> = { kabum: KABUM_OFFER_VALID_DAYS, amazon: AMAZON_OFFER_VALID_DAYS }
export const OFFER_UPSERT_CHUNK = 500

const OFFER_UPDATES = {
  title: OVERWRITE,
  tokens: OVERWRITE,
  priceCents: OVERWRITE,
  listPriceCents: OVERWRITE,
  regularPriceCents: OVERWRITE,
  priceUntil: OVERWRITE,
  inStock: OVERWRITE,
  seller: OVERWRITE,
  brand: OVERWRITE,
  url: OVERWRITE,
  lastSeenAt: OVERWRITE,
} as const

export type MarketOfferRow = typeof marketOffers.$inferInsert
export type CandidateOffer = Pick<typeof marketOffers.$inferSelect, 'retailer' | 'title' | 'brand' | 'seller' | 'priceCents' | 'url'>

export function offerKey(offer: Pick<MarketOffer, 'retailer' | 'listingId'>): string {
  return `${offer.retailer}:${offer.listingId}`
}

export function offerRow(offer: MarketOffer, now: Date): MarketOfferRow {
  return {
    key: offerKey(offer),
    retailer: offer.retailer,
    listingId: offer.listingId,
    title: offer.title,
    brand: offer.brand,
    seller: offer.seller,
    priceCents: offer.priceCents,
    listPriceCents: offer.listPriceCents,
    regularPriceCents: offer.regularPriceCents,
    priceUntil: offer.priceUntil,
    inStock: offer.inStock,
    url: offer.url,
    source: offer.source,
    tokens: offerTokens(offer.title),
    firstSeenAt: now,
    lastSeenAt: now,
  }
}

export async function upsertOffers(offers: readonly MarketOffer[], now: Date): Promise<number> {
  const rows = lastByKey(offers.map((offer) => offerRow(offer, now)), (row) => row.key)
  for (const chunk of chunks(rows, OFFER_UPSERT_CHUNK)) {
    await db.insert(marketOffers).values(chunk).onConflictDoUpdate({
      target: marketOffers.key,
      set: conflictUpdates(marketOffers, OFFER_UPDATES),
    })
  }
  return rows.length
}

export function validOfferCondition(now: Date): SQL {
  return and(
    eq(marketOffers.inStock, true),
    or(...RETAILERS.map((retailer) => and(
      eq(marketOffers.retailer, retailer),
      gte(marketOffers.lastSeenAt, daysBefore(now, OFFER_VALID_DAYS[retailer])),
    ))),
  ) as SQL
}

function tokenArray(tokens: readonly string[]): SQL {
  return sql`${sql.param([...tokens], marketOffers.tokens)}::text[]`
}

export function effectivePriceSql(now: Date): SQL<number> {
  return sql<number>`(case when ${marketOffers.priceUntil} is not null and ${lte(marketOffers.priceUntil, now)}
    then coalesce(${marketOffers.regularPriceCents}, ${marketOffers.priceCents}) else ${marketOffers.priceCents} end)`
}

export function anyTermHitsSql(any: readonly string[]): SQL<number> {
  return sql<number>`cardinality(array(select unnest(${marketOffers.tokens}) intersect select unnest(${tokenArray(any)})))`
}

export function candidateCondition({ all, any }: RetrievalTerms, finalCents: number, now: Date): SQL {
  const { minCents, maxCents } = priceBand(finalCents)
  return and(
    sql`${marketOffers.tokens} @> ${tokenArray(all)}`,
    sql`(cardinality(${tokenArray(any)}) = 0 or ${marketOffers.tokens} && ${tokenArray(any)})`,
    between(effectivePriceSql(now), minCents, maxCents),
    validOfferCondition(now),
  ) as SQL
}

function candidateOrder({ any }: RetrievalTerms, now: Date): SQL[] {
  const cheapestFirst = [asc(effectivePriceSql(now)), asc(marketOffers.key)]
  return any.length > 0 ? [desc(anyTermHitsSql(any)), ...cheapestFirst] : cheapestFirst
}

export async function candidateOffers(terms: RetrievalTerms, finalCents: number, now: Date): Promise<CandidateOffer[]> {
  if (!hasRetrievalTerms(terms)) return []
  return db.select({
    retailer: marketOffers.retailer,
    title: marketOffers.title,
    brand: marketOffers.brand,
    seller: marketOffers.seller,
    priceCents: effectivePriceSql(now),
    url: marketOffers.url,
  }).from(marketOffers)
    .where(candidateCondition(terms, finalCents, now))
    .orderBy(...candidateOrder(terms, now))
    .limit(MARKET_CANDIDATE_LIMIT)
}

export async function validOfferCounts(now: Date): Promise<Record<Retailer, number>> {
  const rows = await db.select({ retailer: marketOffers.retailer, total: sql<number>`count(*)::int` })
    .from(marketOffers).where(validOfferCondition(now)).groupBy(marketOffers.retailer)
  const counts = Object.fromEntries(RETAILERS.map((retailer) => [retailer, 0])) as Record<Retailer, number>
  for (const row of rows) counts[row.retailer] = row.total
  return counts
}

export async function pruneOffers(now: Date, executor: Pick<Tx, 'delete'> = db): Promise<number> {
  const pruned = await executor.delete(marketOffers)
    .where(lt(marketOffers.lastSeenAt, pruneCutoffs(now).marketOffers))
    .returning({ key: marketOffers.key })
  return pruned.length
}
