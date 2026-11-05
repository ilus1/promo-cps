import { and, asc, count, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm'
import { PAGE_SIZE } from '@/lib/constants'
import { couponLabel } from '@/lib/coupon-label'
import { couponFiltersOf } from '@/lib/coupon-query'
import type { DealListOptions, DealSort } from '@/lib/deal-query'
import { SOURCE_COUPON, SOURCE_SEARCH, STATUS_SAVED, type ItemStatus, type SourceType } from '@/lib/domain'
import { freshSince } from '@/lib/freshness'
import { savingThresholdRatio } from '@/lib/format'
import { pageOffset } from '@/lib/paging'
import { normalizeSearchText, wordRegexes } from '@/lib/text-search'
import { isUuid } from '@/lib/query-params'
import type { DealCoupon, DealPriceCheck, DealSibling } from '@/lib/deal-view'
import { cheaperSiblingOf } from '@/lib/price-compare/verdict'
import { priceHistory, type PriceHistory } from '@/lib/price-history'
import type { SegmentRow } from '@/lib/drop'
import { db } from './client'
import { filterConditions as couponConditions, freshCouponLink, freshLinkToLiveCoupon, linkedItemsCount, liveCoupon } from './coupons'
import { validCheckCondition } from './check-sql'
import { couponPartSql, finalPriceSql, savingRatioSql, savingSql } from './saving'
import { matchesAllWords } from './sql'
import { coupons, items, itemSources, priceChecks, priceSegments, searches, type Item } from './schema'
import { cheapestSiblingSql, hiddenSql, inflatedSql, realSavingSql, verifiedSql } from './verdict-sql'

const FACET_COUPON_LIMIT = 100

export type DealPageOptions = DealListOptions & { page: number; limit?: number }
export type DealRow = Item & {
  coupons: DealCoupon[]
  history: PriceHistory | null
  priceCheck: DealPriceCheck | null
  cheaperSibling: DealSibling | null
}

type CouponChipRow = Omit<DealCoupon, 'expiresAt'> & { expiresAt: string | null }

function linkedFrom(type: SourceType, sourceId: string, since: Date): SQL {
  return sql`exists (select 1 from ${itemSources} where ${and(
    eq(itemSources.itemId, items.id),
    eq(itemSources.sourceType, type),
    eq(itemSources.sourceId, sourceId),
    gte(itemSources.lastSeenAt, since),
  )})`
}

function linkedToCouponSet(couponSetQuery: string, now: Date): SQL {
  const matching = sql`select ${coupons.campaignId} from ${coupons}
    where ${and(liveCoupon(now), ...couponConditions(couponFiltersOf(couponSetQuery), now))}`
  return sql`exists (select 1 from ${itemSources}
    where ${and(eq(itemSources.itemId, items.id), freshCouponLink(now))}
      and ${itemSources.sourceId} in (${matching}))`
}

function knownSearch(searchId: string): SQL {
  return sql`exists (select 1 from ${searches} where ${eq(searches.id, searchId)})`
}

function matchesNothing(o: Pick<DealListOptions, 'searchId'>): boolean {
  return o.searchId !== undefined && !isUuid(o.searchId)
}

function offerCondition(now: Date): SQL {
  return or(gt(items.mlDiscountPct, 0), gt(items.dropRatio, 0), sql`${savingSql(now)} > 0`) as SQL
}

function filterConditions(o: Omit<DealListOptions, 'tab'>, now: Date): SQL[] {
  const since = freshSince(now)
  const conds: SQL[] = []
  if (!o.includeStale) conds.push(or(eq(items.status, STATUS_SAVED), gte(items.observedAt, since)) as SQL)
  if (o.observedSince) conds.push(gte(items.observedAt, o.observedSince))
  const regexes = wordRegexes(normalizeSearchText(o.text ?? ''))
  if (regexes.length > 0) conds.push(matchesAllWords(items.title, regexes))
  if (o.offersOnly) conds.push(offerCondition(now))
  if (o.searchId) conds.push(knownSearch(o.searchId), linkedFrom(SOURCE_SEARCH, o.searchId, since))
  if (o.couponId) conds.push(linkedFrom(SOURCE_COUPON, o.couponId, since))
  if (o.couponSetQuery) conds.push(linkedToCouponSet(o.couponSetQuery, now))
  if (o.priceMaxCents !== undefined) conds.push(lte(items.priceCents, o.priceMaxCents))
  if (o.discountMin) conds.push(gte(items.mlDiscountPct, o.discountMin))
  if (o.savingMin) conds.push(sql`${savingRatioSql(now)} >= ${savingThresholdRatio(o.savingMin)}::float8`)
  if (o.savingMinCents) conds.push(sql`${savingSql(now)} >= ${o.savingMinCents}::int`)
  if (o.onlyDrops) conds.push(gt(items.dropRatio, 0))
  if (o.soldMin) conds.push(gte(items.soldQuantity, o.soldMin))
  if (o.full) conds.push(eq(items.full, true))
  if (o.freeShipping) conds.push(eq(items.freeShipping, true))
  if (o.category) conds.push(eq(items.domainId, o.category))
  if (o.onlyVerified) conds.push(verifiedSql(now))
  if (!o.showInflated) conds.push(sql`not ${hiddenSql(now)}`)
  return conds
}

export function filterWhere(o: Omit<DealListOptions, 'tab'>, now: Date): SQL {
  if (matchesNothing(o)) return sql`false`
  return and(...filterConditions(o, now)) as SQL
}

export function dealWhere(o: DealListOptions, now: Date): SQL {
  const status = typeof o.tab === 'string' ? eq(items.status, o.tab) : inArray(items.status, [...o.tab])
  return and(status, filterWhere(o, now)) as SQL
}

export function dealOrder(sort: DealSort, now: Date): SQL[] {
  const order: Record<DealSort, () => SQL[]> = {
    desconto: () => [sql`${items.mlDiscountPct} desc nulls last`, desc(items.observedAt)],
    queda: () => [sql`${items.dropRatio} desc nulls last`],
    preco: () => [asc(items.priceCents)],
    recentes: () => [desc(items.firstSeenAt)],
    economia: () => [sql`${savingRatioSql(now)} desc nulls last`],
    economiaReais: () => [sql`${savingSql(now)} desc`],
    economiaCupom: () => [sql`${couponPartSql(now)} desc nulls last`],
    economiaReal: () => [sql`${realSavingSql(now)} desc nulls last`],
  }
  return order[sort]()
}

function couponChips(now: Date): SQL<CouponChipRow[]> {
  return sql<CouponChipRow[]>`coalesce((select json_agg(json_build_object(
      'campaignId', ${coupons.campaignId},
      'title', ${coupons.title},
      'isStore', ${coupons.isStore},
      'scopeLabel', ${coupons.scopeLabel},
      'expiresAt', ${coupons.expiresAt},
      'minPaymentCents', ${coupons.minPaymentCents},
      'kind', ${coupons.kind},
      'percentOff', ${coupons.percentOff},
      'amountOffCents', ${coupons.amountOffCents},
      'capCents', ${coupons.capCents}
    ) order by ${coupons.expiresAt} asc nulls last, ${coupons.campaignId})
    from ${itemSources} inner join ${coupons} on ${eq(coupons.campaignId, itemSources.sourceId)}
    where ${and(
      eq(itemSources.itemId, items.id),
      freshLinkToLiveCoupon(now),
    )}), '[]'::json)`
}

async function priceHistories(ids: string[], now: Date): Promise<Map<string, PriceHistory>> {
  if (ids.length === 0) return new Map()
  const rows = await db.select({
    itemId: priceSegments.itemId,
    id: priceSegments.id,
    priceCents: priceSegments.priceCents,
    basis: priceSegments.basis,
    firstSeenAt: priceSegments.firstSeenAt,
    lastSeenAt: priceSegments.lastSeenAt,
  })
    .from(priceSegments)
    .where(inArray(priceSegments.itemId, ids))
  const byItem = new Map<string, SegmentRow[]>()
  for (const { itemId, ...segment } of rows) byItem.set(itemId, [...(byItem.get(itemId) ?? []), segment])
  const histories = new Map<string, PriceHistory>()
  for (const [itemId, segments] of byItem) {
    const history = priceHistory(segments, now)
    if (history) histories.set(itemId, history)
  }
  return histories
}

interface CheckFacts {
  priceCheck: DealPriceCheck | null
  cheaperSibling: DealSibling | null
}

async function checkFacts(rows: Item[], now: Date): Promise<Map<string, CheckFacts>> {
  if (rows.length === 0) return new Map()
  const found = await db.select({
    id: items.id,
    status: priceChecks.status,
    confidence: priceChecks.confidence,
    marketLowCents: priceChecks.marketLowCents,
    marketStore: priceChecks.marketStore,
    storeCount: priceChecks.storeCount,
    finalCents: sql<number>`${finalPriceSql(now)}::int`,
    inflated: inflatedSql(now),
    realSavingCents: realSavingSql(now),
    sibling: cheapestSiblingSql(now),
  })
    .from(items)
    .leftJoin(priceChecks, validCheckCondition(now))
    .where(inArray(items.id, rows.map((row) => row.id)))
  const priceByItem = new Map(rows.map((row) => [row.id, row.priceCents]))
  return new Map(found.map((row) => [row.id, {
    priceCheck: row.status === null ? null : {
      status: row.status,
      confidence: row.confidence,
      marketLowCents: row.marketLowCents,
      marketStore: row.marketStore,
      storeCount: row.storeCount,
      finalCents: row.finalCents,
      inflated: row.inflated,
      realSavingCents: row.realSavingCents,
    },
    cheaperSibling: row.sibling && cheaperSiblingOf(priceByItem.get(row.id) ?? 0, row.sibling.priceCents) ? row.sibling : null,
  }]))
}

export async function earliestSegmentStart(): Promise<Date | null> {
  const [row] = await db.select({
    at: sql<Date | null>`min(${priceSegments.firstSeenAt})`.mapWith(priceSegments.firstSeenAt),
  }).from(priceSegments)
  return row?.at ?? null
}

export async function listDeals(o: DealPageOptions, now: Date): Promise<DealRow[]> {
  const limit = o.limit ?? PAGE_SIZE
  const rows = await db
    .select({ ...getTableColumns(items), coupons: couponChips(now) })
    .from(items)
    .where(dealWhere(o, now))
    .orderBy(...dealOrder(o.sort, now), asc(items.id))
    .limit(limit)
    .offset(pageOffset(o.page, limit))
  const [histories, facts] = await Promise.all([priceHistories(rows.map((row) => row.id), now), checkFacts(rows, now)])
  return rows.map((row) => ({
    ...row,
    history: histories.get(row.id) ?? null,
    priceCheck: facts.get(row.id)?.priceCheck ?? null,
    cheaperSibling: facts.get(row.id)?.cheaperSibling ?? null,
    coupons: row.coupons.map((c) => ({ ...c, expiresAt: c.expiresAt ? new Date(c.expiresAt) : null })),
  }))
}

export interface TabCounts {
  items: Record<ItemStatus, number>
  offers: Record<ItemStatus, number>
  hidden: Record<ItemStatus, number>
}

const HIDDEN_ALIAS = sql.identifier('flags')
const HIDDEN_COLUMN = sql.identifier('hidden')
const HIDDEN = sql`${HIDDEN_ALIAS}.${HIDDEN_COLUMN}`

export async function countDealsByTab(o: Omit<DealListOptions, 'tab'>, now: Date): Promise<TabCounts> {
  const totals: TabCounts = {
    items: { NOT_SEEN: 0, SAVED: 0, SEEN: 0 },
    offers: { NOT_SEEN: 0, SAVED: 0, SEEN: 0 },
    hidden: { NOT_SEEN: 0, SAVED: 0, SEEN: 0 },
  }
  const shown = o.showInflated ? sql`true` : sql`not ${HIDDEN}`
  const rows = await db.select({
    status: sql<ItemStatus>`${items.status}`,
    total: sql<number>`(count(*) filter (where ${shown}))::int`,
    offers: sql<number>`(count(*) filter (where ${shown} and ${offerCondition(now)}))::int`,
    hidden: sql<number>`(count(*) filter (where ${o.showInflated ? sql`false` : HIDDEN}))::int`,
  })
    .from(sql`${items} cross join lateral (select ${hiddenSql(now)} as ${HIDDEN_COLUMN} offset 0) ${HIDDEN_ALIAS}`)
    .where(filterWhere({ ...o, showInflated: true }, now))
    .groupBy(items.status)
  for (const row of rows) {
    totals.items[row.status] = row.total
    totals.offers[row.status] = row.offers
    totals.hidden[row.status] = row.hidden
  }
  return totals
}

export async function inflatedItemCount(now: Date): Promise<number> {
  const [row] = await db.select({ total: count() }).from(items)
    .where(and(gte(items.observedAt, freshSince(now)), inflatedSql(now)))
  return row?.total ?? 0
}

export interface DealFacets {
  searches: { id: string; name: string }[]
  coupons: { id: string; label: string; linked: number }[]
  categories: { id: string }[]
}

export async function dealFacets(now: Date, selectedCouponId?: string): Promise<DealFacets> {
  const since = freshSince(now)
  const linked = count()
  const [searchRows, couponRows, categoryRows] = await Promise.all([
    db.select({ id: searches.id, name: searches.name }).from(searches).orderBy(asc(searches.name)),
    db.select({ id: coupons.campaignId, title: coupons.title, isStore: coupons.isStore, scopeLabel: coupons.scopeLabel, linked })
      .from(itemSources)
      .innerJoin(coupons, eq(coupons.campaignId, itemSources.sourceId))
      .where(freshLinkToLiveCoupon(now))
      .groupBy(coupons.campaignId)
      .orderBy(desc(linked), asc(coupons.campaignId))
      .limit(FACET_COUPON_LIMIT),
    db.select({ id: items.domainId, linked })
      .from(items)
      .where(and(gte(items.observedAt, since), isNotNull(items.domainId)))
      .groupBy(items.domainId)
      .orderBy(desc(linked), asc(items.domainId)),
  ])
  const couponOptions = couponRows.map((r) => ({ id: r.id, label: couponLabel(r), linked: r.linked }))
  if (selectedCouponId && !couponOptions.some((c) => c.id === selectedCouponId)) {
    const [selected] = await db.select({
      id: coupons.campaignId, title: coupons.title, isStore: coupons.isStore, scopeLabel: coupons.scopeLabel,
      linked: linkedItemsCount(now),
    }).from(coupons).where(eq(coupons.campaignId, selectedCouponId))
    if (selected) couponOptions.push({ id: selected.id, label: couponLabel(selected), linked: selected.linked })
  }
  return {
    searches: searchRows,
    coupons: couponOptions,
    categories: categoryRows.flatMap((r) => (r.id === null ? [] : [{ id: r.id }])),
  }
}
