import { and, asc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm'
import { lastByKey } from '@/lib/batch'
import { HOUR_MS, PRICE_CHECK_SUMMARY_HOURS } from '@/lib/constants'
import { alertFilters } from '@/lib/deal-query'
import { ALERT_STATUSES, PRICE_CHECK_STATUSES, type PriceCheckStatus } from '@/lib/domain'
import type { PriceCheckSummaryView } from '@/lib/price-check-view'
import { uniqueByKey, type CheckItem } from '@/lib/price-check-rules'
import { db } from './client'
import { dealOrder, dealWhere } from './deals'
import { validCheckCondition } from './check-sql'
import { finalPriceSql, showsSavingSql } from './saving'
import { listAlerts } from './alerts'
import { conflictUpdates, meaningfulDrop, OVERWRITE } from './sql'
import { alertHits, items, priceChecks } from './schema'

const CHECK_OVERFETCH = 4

export type PriceCheckRow = typeof priceChecks.$inferInsert

const CHECK_UPDATES = {
  itemId: OVERWRITE,
  checkedAt: OVERWRITE,
  status: OVERWRITE,
  confidence: OVERWRITE,
  query: OVERWRITE,
  mlPriceCents: OVERWRITE,
  marketLowCents: OVERWRITE,
  secondLowCents: OVERWRITE,
  marketStore: OVERWRITE,
  storeCount: OVERWRITE,
  offers: OVERWRITE,
  sourceUrl: OVERWRITE,
  reason: OVERWRITE,
} as const satisfies Record<Exclude<keyof PriceCheckRow, 'key'>, typeof OVERWRITE>

export async function saveCheck(row: PriceCheckRow): Promise<void> {
  await db.insert(priceChecks).values(row).onConflictDoUpdate({ target: priceChecks.key, set: row })
}

export async function saveChecks(rows: readonly PriceCheckRow[]): Promise<void> {
  const unique = lastByKey(rows, (row) => row.key)
  if (unique.length === 0) return
  await db.insert(priceChecks).values(unique).onConflictDoUpdate({ target: priceChecks.key, set: conflictUpdates(priceChecks, CHECK_UPDATES) })
}

export function needsCheckCondition(now: Date): SQL {
  return sql`not exists (select 1 from ${priceChecks} where ${validCheckCondition(now)})`
}

export function checkItemColumns(now: Date) {
  return {
    id: items.id,
    productId: items.productId,
    title: items.title,
    finalCents: sql<number>`${finalPriceSql(now)}::int`,
    showsSaving: showsSavingSql(now),
  }
}

function notYetAnnounced(alertId: string): SQL {
  return sql`not exists (select 1 from ${alertHits} where ${and(
    eq(alertHits.alertId, alertId),
    eq(alertHits.itemId, items.id),
    sql`not ${meaningfulDrop(items.priceCents, alertHits.priceCents)}`,
  )})`
}

export async function alertCandidatesToCheck(
  observedSince: Date, now: Date, perAlert: number, total: number,
): Promise<CheckItem[]> {
  const collected: CheckItem[][] = []
  for (const alert of await listAlerts()) {
    const filters = alertFilters(alert.query)
    const where = dealWhere({ ...filters, tab: ALERT_STATUSES, observedSince, offersOnly: true, onlyVerified: false }, now)
    const rows = await db.select(checkItemColumns(now)).from(items)
      .where(and(where, needsCheckCondition(now), notYetAnnounced(alert.id)))
      .orderBy(...dealOrder(filters.sort, now), asc(items.id))
      .limit(perAlert * CHECK_OVERFETCH)
    collected.push(uniqueByKey([rows], perAlert))
  }
  return uniqueByKey(collected, total)
}

export async function itemToCheck(id: string, now: Date): Promise<CheckItem | null> {
  const [row] = await db.select(checkItemColumns(now)).from(items).where(eq(items.id, id)).limit(1)
  return row ?? null
}

export async function priceCheckSummary(now: Date): Promise<PriceCheckSummaryView> {
  const dayAgo = new Date(now.getTime() - PRICE_CHECK_SUMMARY_HOURS * HOUR_MS)
  const [last] = await db.select({ at: sql<Date | null>`max(${priceChecks.checkedAt})`.mapWith(priceChecks.checkedAt) })
    .from(priceChecks).where(inArray(priceChecks.status, ['matched', 'no_match']))
  const rows = await db.select({ status: priceChecks.status, total: sql<number>`count(*)::int` })
    .from(priceChecks).where(gte(priceChecks.checkedAt, dayAgo)).groupBy(priceChecks.status)
  const counts = Object.fromEntries(PRICE_CHECK_STATUSES.map((s) => [s, 0])) as Record<PriceCheckStatus, number>
  for (const row of rows) counts[row.status] = row.total
  return { lastCheckedAt: last?.at ?? null, counts }
}
