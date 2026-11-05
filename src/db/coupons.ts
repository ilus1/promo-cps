import {
  and, asc, count, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL,
} from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import {
  ACTIVATION_EU_QUERO, COUPON_STATUS_ACTIVE, COUPON_STATUS_INACTIVE, STORE_SCOPE_PREFIX, type ParsedCoupon, type RawCoupon,
} from '@/ingestion/ml/coupons'
import { lastByKey } from '@/lib/batch'
import {
  ACTIVATION_RETRY_HOURS, DAY_MS, HOUR_MS, MAX_DISCOUNT_PERCENT, ML_IMAGE_HOST, PAGE_SIZE, PERCENT_BASE, TRIVIAL_SAVING_CENTS, UNCAPPED_FROM_CENTS,
} from '@/lib/constants'
import { discoveryRotation } from '@/lib/coupon-order'
import { COUPON_PREVIEW_FETCH_LIMIT, type CouponPreview } from '@/lib/coupon-preview'
import {
  COUPON_LIST_STATUSES, DEFAULT_COUPON_SORT, SOURCE_COUPON, type ActivationOutcome, type CouponKind, type CouponListStatus,
  type CouponScope, type CouponSort,
} from '@/lib/domain'
import { freshSince } from '@/lib/freshness'
import { discountThresholdRatio } from '@/lib/format'
import { pageOffset } from '@/lib/paging'
import { escapeRegex, nfc, normalizeSearchText, wordRegexes } from '@/lib/text-search'
import { db } from './client'
import { coupons, itemSources, type Coupon } from './schema'
import { columnsWithout, conflictUpdates, excluded, matchesAllWords, OVERWRITE, type OnConflict } from './sql'

export type CouponSummary = Omit<Coupon, 'raw'>
export type DiscoveryTarget = CouponSummary & { listingUrl: string }
export type CouponListRow = CouponSummary & { listStatus: CouponListStatus; linkedItems: number; previews: CouponPreview[] }

export interface CouponFilters {
  status?: CouponListStatus
  scope?: CouponScope
  kind?: CouponKind
  expiringWithinDays?: number
  minimumMaxCents?: number
  limitMinCents?: number
  discountMin?: number
  withOffers?: boolean
  text?: string
}

const summaryColumns = columnsWithout(coupons, 'raw')

const PARSED_UPDATES = {
  title: OVERWRITE,
  kind: OVERWRITE,
  percentOff: OVERWRITE,
  amountOffCents: OVERWRITE,
  minPaymentCents: OVERWRITE,
  capCents: OVERWRITE,
  scopeLabel: OVERWRITE,
  isStore: OVERWRITE,
  status: OVERWRITE,
  activationType: OVERWRITE,
  activateCode: OVERWRITE,
  startsAt: OVERWRITE,
  expiresAt: OVERWRITE,
} as const satisfies Record<Exclude<keyof ParsedCoupon, 'campaignId' | 'listingUrl'>, OnConflict>

const HARVEST_UPDATES = { ...PARSED_UPDATES, raw: OVERWRITE, lastSeenAt: OVERWRITE } as const

const keepActiveListingUrl = sql`coalesce(
  ${excluded(coupons.listingUrl)},
  case when ${eq(coupons.status, COUPON_STATUS_ACTIVE)} then ${coupons.listingUrl} end
)`

export function liveCoupon(now: Date): SQL {
  return sql`(${isNull(coupons.endedAt)}
    and (${isNull(coupons.expiresAt)} or ${gt(coupons.expiresAt, now)})
    and (${isNull(coupons.startsAt)} or ${lte(coupons.startsAt, now)}))`
}

function endedOrExpired(now: Date): SQL {
  return sql`(${isNotNull(coupons.endedAt)} or (${isNotNull(coupons.expiresAt)} and ${lte(coupons.expiresAt, now)}))`
}

function listStatusConditions(now: Date): Record<CouponListStatus, SQL> {
  const ended = endedOrExpired(now)
  const active = sql`(${liveCoupon(now)} and ${eq(coupons.status, COUPON_STATUS_ACTIVE)})`
  return { active, ended, inactive: sql`(not ${ended} and not ${active})` }
}

function listStatusOf(now: Date): SQL<CouponListStatus> {
  const conditions = listStatusConditions(now)
  const branches = COUPON_LIST_STATUSES.map((status) => sql`when ${conditions[status]} then ${status}`)
  return sql<CouponListStatus>`case ${sql.join(branches, sql` `)} end`
}

export function freshCouponLink(now: Date): SQL {
  return and(eq(itemSources.sourceType, SOURCE_COUPON), gte(itemSources.lastSeenAt, freshSince(now))) as SQL
}

export function freshLinkToLiveCoupon(now: Date): SQL {
  return and(freshCouponLink(now), liveCoupon(now)) as SQL
}

export function linkedItemsCount(now: Date): SQL<number> {
  return sql<number>`(select count(*)::int from ${itemSources} where ${and(
    freshCouponLink(now),
    eq(itemSources.sourceId, coupons.campaignId),
  )})`
}

const PERCENT_BASE_FLOAT = sql`${PERCENT_BASE}::float8`
const MAX_PERCENT_SQL = sql`${MAX_DISCOUNT_PERCENT}::int`

export function validPercentSql(percent: PgColumn): SQL {
  return sql`(${percent} > 0 and ${percent} <= ${MAX_PERCENT_SQL})`
}

export function discountAtMinimumSql(): SQL<number | null> {
  const minimum = sql`coalesce(${coupons.minPaymentCents}, 0)`
  const ratio = sql`(${coupons.percentOff}::float8 / ${PERCENT_BASE_FLOAT})`
  return sql<number | null>`(case
    when ${eq(coupons.kind, 'fixed')} and ${coupons.amountOffCents} > 0
      then ${coupons.amountOffCents}::float8 / greatest(${minimum}, ${coupons.amountOffCents})::float8
    when ${eq(coupons.kind, 'percent')} and ${validPercentSql(coupons.percentOff)}
      then case
        when ${minimum} <= 0 or ${isNull(coupons.capCents)} or ${coupons.capCents} >= ${UNCAPPED_FROM_CENTS}::int
          then ${ratio}
        else least(${ratio}, ${coupons.capCents}::float8 / ${minimum}::float8)
      end
  end)`
}

export function maxSavingSql(): SQL<number | null> {
  return sql<number | null>`(case
    when ${eq(coupons.kind, 'fixed')} and ${coupons.amountOffCents} > 0 then ${coupons.amountOffCents}
    when ${eq(coupons.kind, 'percent')} and ${coupons.capCents} < ${UNCAPPED_FROM_CENTS}::int then ${coupons.capCents}
  end)`
}

function trivialSavingSql(): SQL<boolean> {
  return sql<boolean>`coalesce(${maxSavingSql()} < ${TRIVIAL_SAVING_CENTS}::int, false)`
}

function effectiveLimitSql(): SQL<number | null> {
  return sql<number | null>`(case
    when ${eq(coupons.kind, 'fixed')} and ${coupons.amountOffCents} > 0 then ${coupons.amountOffCents}
    when ${eq(coupons.kind, 'percent')}
      then case
        when ${isNull(coupons.capCents)} or ${coupons.capCents} >= ${UNCAPPED_FROM_CENTS}::int then ${UNCAPPED_FROM_CENTS}::int
        else ${coupons.capCents}
      end
    when ${eq(coupons.kind, 'unparsed')} then ${coupons.capCents}
  end)`
}

const IMAGE_URL_ON_ML_HOST = `^https?://${escapeRegex(ML_IMAGE_HOST)}([/?#]|$)`

function previewItemsSql(): SQL {
  return sql`(case when jsonb_typeof(${coupons.raw} -> 'items') = 'array' then ${coupons.raw} -> 'items' else '[]'::jsonb end)`
}

function previewsSql(): SQL<CouponPreview[]> {
  return sql<CouponPreview[]>`coalesce((
    select json_agg(json_build_object('imageUrl', preview.item ->> 'image_url', 'altText', coalesce(preview.item ->> 'alt_text', ''))
      order by preview.ord)
    from jsonb_array_elements(${previewItemsSql()}) with ordinality as preview(item, ord)
    where preview.ord <= ${COUPON_PREVIEW_FETCH_LIMIT}::int
  ), '[]'::json)`
}

function searchableTextSql(): SQL {
  const storeName = sql`substr(${coupons.scopeLabel}, ${STORE_SCOPE_PREFIX.length + 1}::int)`
  return sql`concat_ws(' ', ${coupons.title}, case when ${coupons.isStore} then ${storeName} end, (
    select string_agg(preview.item ->> 'alt_text', ' ')
    from jsonb_array_elements(${previewItemsSql()}) with ordinality as preview(item, ord)
    where preview.ord <= ${COUPON_PREVIEW_FETCH_LIMIT}::int and preview.item ->> 'image_url' ~* ${IMAGE_URL_ON_ML_HOST}
  ))`
}

export function filterConditions(f: CouponFilters, now: Date): SQL[] {
  const conds: SQL[] = []
  if (f.status) conds.push(listStatusConditions(now)[f.status])
  if (f.scope) conds.push(eq(coupons.isStore, f.scope === 'store'))
  if (f.kind) conds.push(eq(coupons.kind, f.kind))
  if (f.expiringWithinDays !== undefined) {
    const until = new Date(now.getTime() + f.expiringWithinDays * DAY_MS)
    conds.push(liveCoupon(now), lte(coupons.expiresAt, until))
  }
  if (f.minimumMaxCents) conds.push(sql`coalesce(${coupons.minPaymentCents}, 0) <= ${f.minimumMaxCents}`)
  if (f.limitMinCents) conds.push(sql`${effectiveLimitSql()} >= ${f.limitMinCents}`)
  if (f.discountMin) conds.push(sql`${discountAtMinimumSql()} >= ${discountThresholdRatio(f.discountMin)}::float8`)
  if (f.withOffers) conds.push(sql`${linkedItemsCount(now)} > 0`)
  const text = f.text ? normalizeSearchText(f.text) : ''
  const regexes = wordRegexes(text)
  if (regexes.length > 0) conds.push(matchesAllWords(searchableTextSql(), regexes))
  return conds
}

export async function upsertCoupons(
  rows: { parsed: ParsedCoupon; raw: RawCoupon }[], seenAt: Date,
): Promise<{ inserted: number }> {
  const unique = lastByKey(rows, (r) => r.parsed.campaignId)
  if (unique.length === 0) return { inserted: 0 }
  const written = await db.insert(coupons)
    .values(unique.map(({ parsed, raw }) => ({
      ...parsed, title: nfc(parsed.title), scopeLabel: nfc(parsed.scopeLabel), raw: nfc(raw), firstSeenAt: seenAt, lastSeenAt: seenAt, endedAt: null,
    })))
    .onConflictDoUpdate({
      target: coupons.campaignId,
      set: { ...conflictUpdates(coupons, HARVEST_UPDATES), listingUrl: keepActiveListingUrl, endedAt: null },
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` })
  return { inserted: written.filter((r) => r.inserted).length }
}

function notSeenSince(harvestStartedAt: Date, now: Date): SQL {
  return and(
    isNull(coupons.endedAt),
    or(isNull(coupons.expiresAt), gt(coupons.expiresAt, now)),
    lt(coupons.lastSeenAt, harvestStartedAt),
  ) as SQL
}

export async function countEndingCandidates(harvestStartedAt: Date, now: Date): Promise<{ endable: number; live: number }> {
  const [row] = await db.select({
    endable: sql<number>`(count(*) filter (where ${notSeenSince(harvestStartedAt, now)}))::int`,
    live: sql<number>`(count(*) filter (where ${liveCoupon(now)}))::int`,
  }).from(coupons)
  return row
}

export async function endCouponsNotSeenSince(harvestStartedAt: Date, now: Date): Promise<number> {
  const ended = await db.update(coupons)
    .set({ endedAt: now })
    .where(notSeenSince(harvestStartedAt, now))
    .returning({ campaignId: coupons.campaignId })
  return ended.length
}

export function activationOrderBy(): SQL[] {
  return [
    sql`${trivialSavingSql()} asc`,
    sql`${effectiveLimitSql()} desc nulls last`,
    asc(coupons.campaignId),
  ]
}

export async function activationCandidates(
  limit: number, now: Date, onlyIds?: readonly string[],
): Promise<CouponSummary[]> {
  if (!(limit > 0)) return []
  const retryBefore = new Date(now.getTime() - ACTIVATION_RETRY_HOURS * HOUR_MS)
  return db.select(summaryColumns).from(coupons)
    .where(and(
      liveCoupon(now),
      eq(coupons.status, COUPON_STATUS_INACTIVE),
      eq(coupons.activationType, ACTIVATION_EU_QUERO),
      isNotNull(coupons.activateCode),
      or(isNull(coupons.activationTriedAt), lt(coupons.activationTriedAt, retryBefore)),
      onlyIds ? inArray(coupons.campaignId, [...onlyIds]) : undefined,
    ))
    .orderBy(...activationOrderBy())
    .limit(limit)
}

export async function recordActivation(campaignId: string, outcome: ActivationOutcome, at: Date): Promise<void> {
  await db.update(coupons)
    .set(outcome.ok
      ? { activationTriedAt: at, activationError: null, status: COUPON_STATUS_ACTIVE }
      : { activationTriedAt: at, activationError: outcome.error })
    .where(eq(coupons.campaignId, campaignId))
}

function hasListingUrl(c: CouponSummary): c is DiscoveryTarget {
  return c.listingUrl !== null
}

export async function discoveryTargets(limit: number | undefined, now: Date): Promise<DiscoveryTarget[]> {
  const rows = await db.select(summaryColumns).from(coupons)
    .where(and(liveCoupon(now), isNotNull(coupons.listingUrl)))
    .orderBy(asc(coupons.campaignId))
  return discoveryRotation(rows.filter(hasListingUrl), limit)
}

export async function markDiscoveryAttempt(campaignIds: string[], at: Date, succeeded: boolean): Promise<void> {
  if (campaignIds.length === 0) return
  const stamps = succeeded ? { discoveryTriedAt: at, lastDiscoveredAt: at } : { discoveryTriedAt: at }
  await db.update(coupons).set(stamps).where(inArray(coupons.campaignId, campaignIds))
}

export function prioritizeWhere(filters: CouponFilters, now: Date): SQL {
  return and(liveCoupon(now), isNotNull(coupons.listingUrl), ...filterConditions(filters, now)) as SQL
}

export async function prioritizeCoupons(filters: CouponFilters, now: Date): Promise<number> {
  const prioritized = await db.update(coupons)
    .set({ discoveryPriorityAt: now })
    .where(prioritizeWhere(filters, now))
    .returning({ campaignId: coupons.campaignId })
  return prioritized.length
}

export function couponOrderBy(sort: CouponSort, now: Date): SQL[] {
  const discount = discountAtMinimumSql()
  const keys: Record<CouponSort, SQL[]> = {
    desconto: [sql`${trivialSavingSql()} asc`, sql`${discount} desc nulls last`],
    economia: [sql`${maxSavingSql()} desc nulls first`, sql`${discount} desc nulls last`],
    minimo: [sql`coalesce(${coupons.minPaymentCents}, 0) asc`],
    limite: [sql`${effectiveLimitSql()} desc nulls last`],
    ofertas: [sql`${linkedItemsCount(now)} desc`],
    vence: [sql`${coupons.expiresAt} asc nulls last`],
  }
  return [asc(endedOrExpired(now)), sql`(${discount} is null) asc`, ...keys[sort], asc(coupons.campaignId)]
}

export async function listCoupons(
  opts: CouponFilters & { page: number; order?: CouponSort }, now: Date,
): Promise<CouponListRow[]> {
  return db.select({ ...summaryColumns, listStatus: listStatusOf(now), linkedItems: linkedItemsCount(now), previews: previewsSql() })
    .from(coupons)
    .where(and(...filterConditions(opts, now)))
    .orderBy(...couponOrderBy(opts.order ?? DEFAULT_COUPON_SORT, now))
    .limit(PAGE_SIZE)
    .offset(pageOffset(opts.page))
}

export function validConditions(f: CouponFilters, now: Date): SQL[] {
  return [...filterConditions(f, now), liveCoupon(now)]
}

export async function countValidCoupons(filters: CouponFilters, now: Date): Promise<number> {
  const [row] = await db.select({ total: count() }).from(coupons).where(and(...validConditions(filters, now)))
  return row.total
}

export async function countCoupons(filters: CouponFilters, now: Date): Promise<number> {
  const [row] = await db.select({ total: count() }).from(coupons).where(and(...filterConditions(filters, now)))
  return row.total
}
