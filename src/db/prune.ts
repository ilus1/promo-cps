import { and, eq, inArray, isNotNull, lt, ne, notExists, notInArray, or, sql } from 'drizzle-orm'
import { SOURCE_COUPON, STATUS_SAVED } from '@/lib/domain'
import { PRUNE_BATCH, PRUNE_LOCK_TIMEOUT_MS, pruneAnotherBatch, pruneCutoffs, type PruneCounts } from '@/lib/prune-rules'
import { db, type Tx } from './client'
import { pruneOffers } from './market-offers'
import { coupons, itemSources, items, priceChecks, runs } from './schema'

function limitLocks(tx: Tx) {
  return tx.execute(sql.raw(`set local lock_timeout = ${PRUNE_LOCK_TIMEOUT_MS}`))
}

function pruneItemBatch(cutoff: Date): Promise<number> {
  return db.transaction(async (tx) => {
    await limitLocks(tx)
    const batch = tx.select({ id: items.id }).from(items)
      .where(and(lt(items.observedAt, cutoff), ne(items.status, STATUS_SAVED)))
      .orderBy(items.id)
      .limit(PRUNE_BATCH)
    const pruned = await tx.delete(items)
      .where(and(inArray(items.id, batch), lt(items.observedAt, cutoff), ne(items.status, STATUS_SAVED)))
      .returning({ id: items.id })
    return pruned.length
  })
}

async function pruneItems(cutoff: Date): Promise<number> {
  let total = 0
  let batches = 0
  let last: number
  do {
    last = await pruneItemBatch(cutoff)
    total += last
    batches += 1
  } while (pruneAnotherBatch(last, batches))
  return total
}

export async function pruneOld(now: Date): Promise<PruneCounts> {
  const cutoffs = pruneCutoffs(now)
  const prunedItems = await pruneItems(cutoffs.items)
  return db.transaction(async (tx) => {
    await limitLocks(tx)
    const prunedCoupons = await tx.delete(coupons)
      .where(and(
        or(
          and(isNotNull(coupons.endedAt), lt(coupons.endedAt, cutoffs.coupons)),
          and(isNotNull(coupons.expiresAt), lt(coupons.expiresAt, cutoffs.coupons)),
        ),
        notExists(tx.select({ one: sql`1` }).from(itemSources)
          .where(and(eq(itemSources.sourceType, SOURCE_COUPON), eq(itemSources.sourceId, coupons.campaignId)))),
      ))
      .returning({ id: coupons.campaignId })
    const latestPerKind = tx.selectDistinctOn([runs.kind], { id: runs.id }).from(runs).orderBy(runs.kind, sql`${runs.startedAt} desc`)
    const prunedRuns = await tx.delete(runs)
      .where(and(lt(runs.startedAt, cutoffs.runs), notInArray(runs.id, latestPerKind)))
      .returning({ id: runs.id })
    const prunedChecks = await tx.delete(priceChecks)
      .where(lt(priceChecks.checkedAt, cutoffs.priceChecks))
      .returning({ key: priceChecks.key })
    const prunedOffers = await pruneOffers(now, tx)
    return {
      items: prunedItems,
      coupons: prunedCoupons.length,
      runs: prunedRuns.length,
      priceChecks: prunedChecks.length,
      marketOffers: prunedOffers,
    }
  })
}
