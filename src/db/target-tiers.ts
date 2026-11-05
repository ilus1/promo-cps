import { eq, gte, sql, type SQL } from 'drizzle-orm'
import { PRICE_CHECK_PRIORITY_SAVING_PERCENT } from '@/lib/constants'
import { STATUS_NOT_SEEN, STATUS_SAVED } from '@/lib/domain'
import { freshSince } from '@/lib/freshness'
import { showsSavingSql } from './saving'
import { items } from './schema'

export interface TargetTier { where: SQL; order: SQL[] }

function priorityDiscount(): SQL {
  return sql`${items.mlDiscountPct} >= ${PRICE_CHECK_PRIORITY_SAVING_PERCENT}`
}

function fresh(now: Date): SQL {
  return gte(items.observedAt, freshSince(now))
}

function notSeen(): SQL {
  return eq(items.status, STATUS_NOT_SEEN)
}

export function priorityNovosSql(now: Date): SQL {
  return sql`(${fresh(now)} and ${notSeen()} and ${priorityDiscount()})`
}

export function targetTiers(now: Date): TargetTier[] {
  return [
    { where: sql`(${fresh(now)} and ${eq(items.status, STATUS_SAVED)})`, order: [sql`${items.observedAt} desc`] },
    { where: priorityNovosSql(now), order: [sql`${items.mlDiscountPct} desc`] },
    {
      where: sql`(${fresh(now)} and ${notSeen()} and coalesce(${items.mlDiscountPct}, 0) < ${PRICE_CHECK_PRIORITY_SAVING_PERCENT} and ${showsSavingSql(now)})`,
      order: [sql`${items.mlDiscountPct} desc nulls last`],
    },
  ]
}
