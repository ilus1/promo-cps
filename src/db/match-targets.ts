import { and, asc, desc, eq, gte, inArray, or, type SQL } from 'drizzle-orm'
import { STATUS_NOT_SEEN, STATUS_SAVED } from '@/lib/domain'
import { freshSince } from '@/lib/freshness'
import { checkKey, uniqueByKey, type CheckItem } from '@/lib/price-check-rules'
import { db } from './client'
import { keysCondition } from './check-sql'
import { checkItemColumns } from './price-checks'
import { items } from './schema'

const MOST_RECENT_FIRST = [desc(items.observedAt), asc(items.id)]

export function rematchTargetCondition(now: Date): SQL {
  return or(
    eq(items.status, STATUS_SAVED),
    and(eq(items.status, STATUS_NOT_SEEN), gte(items.observedAt, freshSince(now))),
  ) as SQL
}

export function firstPerKey<T extends Pick<CheckItem, 'id' | 'productId'>>(rows: readonly T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = checkKey(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function targetItemIds(now: Date): Promise<string[]> {
  const rows = await db.select({ id: items.id, productId: items.productId }).from(items)
    .where(rematchTargetCondition(now))
    .orderBy(...MOST_RECENT_FIRST)
  return firstPerKey(rows).map((row) => row.id)
}

export async function checkItemsByIds(ids: readonly string[], now: Date): Promise<CheckItem[]> {
  if (ids.length === 0) return []
  return db.select(checkItemColumns(now)).from(items).where(inArray(items.id, [...ids]))
}

export async function keyItems(keys: readonly string[], now: Date): Promise<CheckItem[]> {
  if (keys.length === 0) return []
  const rows = await db.select(checkItemColumns(now)).from(items)
    .where(keysCondition(keys))
    .orderBy(...MOST_RECENT_FIRST)
  return uniqueByKey([rows], Infinity)
}
