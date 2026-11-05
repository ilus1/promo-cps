import { and, asc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm'
import { appBaseUrl } from '@/lib/app-url'
import { digestsOf, type AlertHit, type AlertHits } from '@/lib/alert-digest'
import { couponLabel } from '@/lib/coupon-label'
import { alertFilters, type DealFilters } from '@/lib/deal-query'
import type { DealDigest } from '@/lib/desktop-notify'
import { freshSince } from '@/lib/freshness'
import { ALERT_STATUSES } from '@/lib/domain'
import type { LabelFacets } from '@/lib/filter-labels'
import { isUuid } from '@/lib/query-params'
import { db, type Tx } from './client'
import { dealOrder, dealWhere } from './deals'
import { excluded, meaningfulDrop } from './sql'
import { getSearch } from './searches'
import { alertHits, alerts, coupons, items, searches, type Alert } from './schema'

const productKey = sql`coalesce(${items.productId}, ${items.id})`

export const ALERT_NOT_CREATED = 'O alerta não foi criado'

type Executor = Pick<typeof db, 'select'>

export function listAlerts(exec: Executor = db): Promise<Alert[]> {
  return exec.select().from(alerts).orderBy(asc(alerts.createdAt), asc(alerts.id))
}

export async function alertByQuery(query: string): Promise<Alert | undefined> {
  const [row] = await db.select().from(alerts).where(eq(alerts.query, query)).limit(1)
  return row
}

export async function createAlert(input: { name: string; query: string }): Promise<Alert> {
  const [row] = await db.insert(alerts).values(input).returning()
  if (!row) throw new Error(ALERT_NOT_CREATED)
  return row
}

export async function deleteAlert(id: string): Promise<boolean> {
  const removed = await db.delete(alerts).where(eq(alerts.id, id)).returning({ id: alerts.id })
  return removed.length > 0
}

export async function hasUnknownBusca(query: string): Promise<boolean> {
  const { searchId } = alertFilters(query)
  return searchId !== undefined && !(isUuid(searchId) && await getSearch(searchId))
}

export async function labelFacetsFor(filters: DealFilters[]): Promise<LabelFacets> {
  const searchIds = new Set<string>()
  const couponIds = new Set<string>()
  for (const f of filters) {
    if (f.searchId && isUuid(f.searchId)) searchIds.add(f.searchId)
    if (f.couponId) couponIds.add(f.couponId)
  }
  const [searchRows, couponRows] = await Promise.all([
    searchIds.size === 0 ? [] : db.select({ id: searches.id, name: searches.name }).from(searches)
      .where(inArray(searches.id, [...searchIds])),
    couponIds.size === 0 ? [] : db.select({
      id: coupons.campaignId, title: coupons.title, isStore: coupons.isStore, scopeLabel: coupons.scopeLabel,
    }).from(coupons).where(inArray(coupons.campaignId, [...couponIds])),
  ])
  return {
    searches: searchRows,
    coupons: couponRows.map((r) => ({ id: r.id, label: couponLabel(r) })),
  }
}

export function reannounceCondition(): SQL {
  return meaningfulDrop(excluded(items.priceCents), alertHits.priceCents)
}

export function announceableOffers(alertId: string, now: Date): SQL {
  return sql`
    prior as (
      select ${productKey} as key, min(${alertHits.priceCents}) as lo
      from ${alertHits} inner join ${items} on ${items.id} = ${alertHits.itemId}
      where ${and(eq(alertHits.alertId, alertId), gte(items.observedAt, freshSince(now)))}
      group by 1
    ),
    offer as (
      select distinct on (${productKey}) ${items.id} as item_id
      from hit inner join ${items} on ${items.id} = hit.item_id
      left join prior on prior.key = ${productKey}
      where prior.lo is null or ${meaningfulDrop(items.priceCents, sql`prior.lo`)}
      order by ${productKey}, ${items.priceCents}, ${items.id}
    )`
}

async function recordHits(tx: Tx, alert: Alert, observedSince: Date, now: Date): Promise<AlertHit[]> {
  const filters = alertFilters(alert.query)
  const where = dealWhere({ ...filters, tab: ALERT_STATUSES, observedSince, offersOnly: true }, now)
  const order = sql.join([...dealOrder(filters.sort, now), asc(items.id)], sql`, `)
  const rows = await tx.execute<AlertHit>(sql`
    with hit as (
      insert into ${alertHits} (alert_id, item_id, price_cents)
      select ${alert.id}::uuid, ${items.id}, ${items.priceCents} from ${items} where ${where}
      on conflict (alert_id, item_id) do update
        set price_cents = excluded.price_cents, alerted_at = now()
        where ${reannounceCondition()}
      returning item_id
    ),
    ${announceableOffers(alert.id, now)}
    select ${items.id} as "id", ${items.title} as "title", ${items.priceCents} as "priceCents",
      ${items.mlDiscountPct} as "mlDiscountPct", ${items.dropRatio} as "dropRatio"
    from offer inner join ${items} on ${items.id} = offer.item_id
    order by ${order}
  `)
  return Array.from(rows)
}

export async function collectDigests(observedSince: Date): Promise<DealDigest[]> {
  const now = new Date()
  const groups = await db.transaction(async (tx) => {
    const collected: AlertHits[] = []
    for (const alert of await listAlerts(tx)) {
      collected.push({ alert, hits: await recordHits(tx, alert, observedSince, now) })
    }
    return collected
  })
  return digestsOf(groups, appBaseUrl())
}
