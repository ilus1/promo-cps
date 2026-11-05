import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { ObservedCard } from '@/ingestion/ml/observed-card'
import { chunks, lastByKey } from '@/lib/batch'
import type { BulkSeenTarget } from '@/lib/bulk-seen'
import { DAY_MS, HISTORY_DAYS } from '@/lib/constants'
import { STATUS_NOT_SEEN, STATUS_SEEN, type ItemStatus } from '@/lib/domain'
import {
  dropsByItem, idsByValue, planSegments, sourceLinks, type ObservationSource,
} from '@/lib/observations'
import { nfc } from '@/lib/text-search'
import { db, type Tx } from './client'
import { dealWhere } from './deals'
import { items, itemSources, priceSegments, searches } from './schema'
import { conflictUpdates, excluded, KEEP_KNOWN, meaningfulDrop, OVERWRITE, type OnConflict } from './sql'

const LINK_CHUNK_ROWS = 1000

const CARD_UPDATES = {
  title: OVERWRITE,
  priceCents: OVERWRITE,
  basis: OVERWRITE,
  basisText: OVERWRITE,
  listPriceCents: OVERWRITE,
  mlDiscountPct: OVERWRITE,
  couponHint: OVERWRITE,
  productId: KEEP_KNOWN,
  thumbnail: KEEP_KNOWN,
  url: KEEP_KNOWN,
  categoryId: KEEP_KNOWN,
  domainId: KEEP_KNOWN,
  sellerLabel: KEEP_KNOWN,
  soldQuantity: KEEP_KNOWN,
  full: KEEP_KNOWN,
  freeShipping: KEEP_KNOWN,
} as const satisfies Record<Exclude<keyof ObservedCard, 'id' | 'isPad'>, OnConflict>

const ITEM_UPDATES = { ...CARD_UPDATES, observedAt: OVERWRITE } as const

type ItemRow = typeof items.$inferInsert & Record<keyof typeof ITEM_UPDATES, unknown>

export function itemRow(card: ObservedCard, at: Date): ItemRow {
  return {
    id: card.id,
    productId: card.productId,
    title: nfc(card.title),
    thumbnail: card.thumbnail,
    url: card.url,
    categoryId: card.categoryId,
    domainId: card.domainId,
    sellerLabel: nfc(card.sellerLabel),
    priceCents: card.priceCents,
    basis: card.basis,
    basisText: card.basisText,
    listPriceCents: card.listPriceCents,
    mlDiscountPct: card.mlDiscountPct,
    soldQuantity: card.soldQuantity,
    full: card.full,
    freeShipping: card.freeShipping,
    couponHint: card.couponHint?.text ?? null,
    observedAt: at,
    firstSeenAt: at,
  }
}

export function reopenSeenOnDrop(): SQL {
  return sql`case when ${items.status} = ${STATUS_SEEN} and ${items.seenPriceCents} is not null
    and ${meaningfulDrop(excluded(items.priceCents), items.seenPriceCents)}
    then ${STATUS_NOT_SEEN} else ${items.status} end`
}

async function upsertItems(tx: Tx, cards: ObservedCard[], at: Date): Promise<void> {
  await tx.insert(items)
    .values(cards.map((card) => itemRow(card, at)))
    .onConflictDoUpdate({
      target: items.id,
      set: { ...conflictUpdates(items, ITEM_UPDATES), status: reopenSeenOnDrop() },
    })
}

async function writeSegments(tx: Tx, cards: ObservedCard[], at: Date): Promise<void> {
  const openSegments = await tx
    .selectDistinctOn([priceSegments.itemId], {
      id: priceSegments.id,
      itemId: priceSegments.itemId,
      priceCents: priceSegments.priceCents,
      basis: priceSegments.basis,
    })
    .from(priceSegments)
    .where(inArray(priceSegments.itemId, cards.map((c) => c.id)))
    .orderBy(priceSegments.itemId, desc(priceSegments.firstSeenAt), desc(priceSegments.id))
  const plan = planSegments(cards, openSegments, at)
  if (plan.extend.length > 0) {
    await tx.update(priceSegments).set({ lastSeenAt: at }).where(inArray(priceSegments.id, plan.extend))
  }
  if (plan.open.length > 0) await tx.insert(priceSegments).values(plan.open)
}

async function searchIsUnchanged(tx: Tx, source: Extract<ObservationSource, { type: 'search' }>): Promise<boolean> {
  const rows = await tx.select({ id: searches.id }).from(searches)
    .where(and(eq(searches.id, source.id), eq(searches.url, source.url)))
    .for('share')
  return rows.length > 0
}

async function linkSources(tx: Tx, cards: ObservedCard[], source: ObservationSource, at: Date): Promise<void> {
  if (source.type === 'search' && !(await searchIsUnchanged(tx, source))) return
  for (const rows of chunks(sourceLinks(cards, source, at), LINK_CHUNK_ROWS)) {
    await tx.insert(itemSources)
      .values(rows)
      .onConflictDoUpdate({
        target: [itemSources.itemId, itemSources.sourceType, itemSources.sourceId],
        set: { lastSeenAt: excluded(itemSources.lastSeenAt) },
      })
  }
}

async function refreshDrops(tx: Tx, itemIds: string[], now: Date): Promise<void> {
  const segments = await tx
    .select({
      id: priceSegments.id,
      itemId: priceSegments.itemId,
      priceCents: priceSegments.priceCents,
      basis: priceSegments.basis,
      firstSeenAt: priceSegments.firstSeenAt,
      lastSeenAt: priceSegments.lastSeenAt,
    })
    .from(priceSegments)
    .where(and(
      inArray(priceSegments.itemId, itemIds),
      gte(priceSegments.lastSeenAt, new Date(now.getTime() - HISTORY_DAYS * DAY_MS)),
    ))
  for (const [dropRatio, sameRatio] of idsByValue(dropsByItem(itemIds, segments, now))) {
    await tx.update(items).set({ dropRatio }).where(inArray(items.id, sameRatio))
  }
}

export async function recordObservations(
  cards: ObservedCard[], source: ObservationSource, at: Date,
): Promise<string[]> {
  const unique = lastByKey(cards, (c) => c.id)
  if (unique.length === 0) return []
  const ids = unique.map((c) => c.id)
  await db.transaction(async (tx) => {
    await upsertItems(tx, unique, at)
    await writeSegments(tx, unique, at)
    await refreshDrops(tx, ids, at)
    await linkSources(tx, unique, source, at)
  })
  return ids
}

export function statusChange(status: ItemStatus): { status: ItemStatus; seenPriceCents: SQL | null } {
  return { status, seenPriceCents: status === STATUS_NOT_SEEN ? null : sql`${items.priceCents}` }
}

export async function setItemStatus(id: string, status: ItemStatus): Promise<boolean> {
  const updated = await db.update(items).set(statusChange(status)).where(eq(items.id, id)).returning({ id: items.id })
  return updated.length > 0
}

export function seenWhere(target: BulkSeenTarget, now: Date): SQL {
  const asOf = lte(items.observedAt, target.asOf)
  if ('ids' in target) return and(inArray(items.id, target.ids), asOf) as SQL
  return and(dealWhere({ ...target.filters, tab: STATUS_NOT_SEEN }, now), asOf) as SQL
}

export async function markSeen(target: BulkSeenTarget, now: Date): Promise<number> {
  const locked = db.select({ id: items.id }).from(items)
    .where(and(eq(items.status, STATUS_NOT_SEEN), seenWhere(target, now)))
    .orderBy(items.id)
    .for('update', { skipLocked: true })
  const updated = await db.update(items).set(statusChange(STATUS_SEEN)).where(inArray(items.id, locked))
  return updated.count
}
