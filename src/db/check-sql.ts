import { and, eq, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { MARKET_CHECK_VALID_HOURS } from '@/lib/constants'
import type { PriceCheckStatus } from '@/lib/domain'
import { hoursBefore } from '@/lib/freshness'
import { CHECK_KEY_ITEM_PREFIX } from '@/lib/price-check-rules'
import { checkKeyOf } from './check-key'
import { items, priceChecks } from './schema'

const SETTLED_STATUSES = ['matched', 'no_match'] as const satisfies readonly PriceCheckStatus[]
const NO_KEYS = sql`false`

export const checkKeySql: SQL<string> = checkKeyOf(items.productId, items.id)

export function keysCondition(keys: readonly string[]): SQL {
  const itemIds = keys.filter((key) => key.startsWith(CHECK_KEY_ITEM_PREFIX)).map((key) => key.slice(CHECK_KEY_ITEM_PREFIX.length))
  const productIds = keys.filter((key) => !key.startsWith(CHECK_KEY_ITEM_PREFIX))
  return or(
    productIds.length > 0 ? inArray(items.productId, productIds) : undefined,
    itemIds.length > 0 ? and(isNull(items.productId), inArray(items.id, itemIds)) : undefined,
  ) ?? NO_KEYS
}

export function matchedSince(now: Date): Date {
  return hoursBefore(now, MARKET_CHECK_VALID_HOURS)
}

export function validCheckCondition(now: Date): SQL {
  return and(
    eq(priceChecks.key, checkKeySql),
    inArray(priceChecks.status, [...SETTLED_STATUSES]),
    gte(priceChecks.checkedAt, matchedSince(now)),
  ) as SQL
}
