import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { COUPON_BASES } from '@/ingestion/ml/basis'
import { PERCENT_BASE } from '@/lib/constants'
import { COUPON_PART_BASIS } from '@/lib/deal-saving'
import type { CouponKind } from '@/lib/domain'
import { freshLinkToLiveCoupon, maxSavingSql, validPercentSql } from './coupons'
import { coupons, items, itemSources } from './schema'

const PERCENT_KIND: CouponKind = 'percent'
const PERCENT_BASE_SQL = sql`${PERCENT_BASE}::int`
const APPLIED_ALIAS = sql.identifier('applied')
const DISCOUNT_ALIAS = sql.identifier('discount')
const DISCOUNT = sql`${APPLIED_ALIAS}.${DISCOUNT_ALIAS}`

function percentOfPrice(percent: PgColumn): SQL {
  return sql`round(${items.priceCents}::numeric * ${percent} / ${PERCENT_BASE_SQL})`
}

function couponDiscountSql(): SQL {
  return sql`(case
    when ${eq(coupons.kind, 'percent')} then ${percentOfPrice(coupons.percentOff)}
    else ${coupons.amountOffCents}
  end)`
}

function usableCouponSql(): SQL {
  return sql`((${eq(coupons.kind, 'percent')} and ${validPercentSql(coupons.percentOff)})
    or (${eq(coupons.kind, 'fixed')} and ${coupons.amountOffCents} > 0))`
}

function bestCouponDiscountSql(now: Date): SQL {
  const discount = sql`least(${couponDiscountSql()}, ${maxSavingSql()}, ${items.priceCents})`
  return sql`(select max(${discount})::int
    from ${itemSources} inner join ${coupons} on ${eq(coupons.campaignId, itemSources.sourceId)}
    where ${and(
      eq(itemSources.itemId, items.id),
      freshLinkToLiveCoupon(now),
    )} and ${usableCouponSql()} and ${items.priceCents} >= coalesce(${coupons.minPaymentCents}, 0)
    having max(${discount}) > 0)`
}

function appliedDiscountSql(now: Date): SQL {
  return sql`(case
    when ${inArray(items.basis, [...COUPON_BASES])} then 0
    else coalesce(${bestCouponDiscountSql(now)}, 0)
  end)`
}

function onceSql<T>(now: Date, body: SQL): SQL<T> {
  return sql<T>`(select ${body} from (select ${appliedDiscountSql(now)} as ${DISCOUNT_ALIAS} offset 0) ${APPLIED_ALIAS})`
}

export function savingSql(now: Date): SQL<number> {
  return onceSql<number>(now, sql`case
    when ${items.listPriceCents} > ${items.priceCents} - ${DISCOUNT}
      then ${items.listPriceCents} - ${items.priceCents} + ${DISCOUNT}
    else ${DISCOUNT}
  end`)
}

export function savingRatioSql(now: Date): SQL<number | null> {
  return onceSql<number | null>(now, sql`case
    when ${items.listPriceCents} > ${items.priceCents} - ${DISCOUNT}
      then (${items.listPriceCents} - ${items.priceCents} + ${DISCOUNT})::float8 / ${items.listPriceCents}::float8
    else ${DISCOUNT}::float8 / nullif(${items.priceCents}, 0)::float8
  end`)
}

const SOLE_ALIAS = sql.identifier('sole')
const PART_ALIAS = sql.identifier('part')
const PART_CENTS = sql.identifier('cents')
const SOLE_KIND = sql.identifier('kind')
const SOLE_PERCENT = sql.identifier('percent_off')
const SOLE_AMOUNT = sql.identifier('amount_off')
const SOLE_LIMIT = sql.identifier('max_saving')
const SOLE_USABLE = sql.identifier('usable')
const SOLE_LINKED = sql.identifier('linked')

function sole(column: typeof SOLE_KIND): SQL {
  return sql`${SOLE_ALIAS}.${column}`
}

function soleLinkedCouponSql(now: Date): SQL {
  return sql`select ${coupons.kind} as ${SOLE_KIND}, ${coupons.percentOff} as ${SOLE_PERCENT}, ${coupons.amountOffCents} as ${SOLE_AMOUNT},
      ${maxSavingSql()} as ${SOLE_LIMIT},
      ${usableCouponSql()} and ${coupons.percentOff} is distinct from ${PERCENT_BASE_SQL} as ${SOLE_USABLE},
      count(*) over () as ${SOLE_LINKED}
    from ${itemSources} inner join ${coupons} on ${eq(coupons.campaignId, itemSources.sourceId)}
    where ${and(eq(itemSources.itemId, items.id), freshLinkToLiveCoupon(now))}`
}

function couponBasisPartSql(now: Date): SQL {
  const percentPart = sql`least(round(${items.priceCents}::numeric * ${sole(SOLE_PERCENT)} / (${PERCENT_BASE_SQL} - ${sole(SOLE_PERCENT)})), ${sole(SOLE_LIMIT)})`
  const applied = sql`case when ${sole(SOLE_KIND)} = ${PERCENT_KIND} then ${percentPart} else ${sole(SOLE_AMOUNT)} end`
  return sql`(select case when ${PART_ALIAS}.${PART_CENTS} > 0 then ${PART_ALIAS}.${PART_CENTS} end
    from (select least(${applied}, ${items.listPriceCents} - ${items.priceCents})::int as ${PART_CENTS}
      from (${soleLinkedCouponSql(now)}) ${SOLE_ALIAS}
      where ${sole(SOLE_LINKED)} = 1 and ${sole(SOLE_USABLE)} and ${isNull(items.couponHint)}) ${PART_ALIAS})`
}

export function couponPartSql(now: Date): SQL<number | null> {
  return sql<number | null>`(case
    when ${eq(items.basis, COUPON_PART_BASIS)} then ${couponBasisPartSql(now)}
    when ${inArray(items.basis, [...COUPON_BASES])} then null
    else ${bestCouponDiscountSql(now)}
  end)`
}

export function finalPriceSql(now: Date): SQL<number> {
  return onceSql<number>(now, sql`${items.priceCents} - ${DISCOUNT}`)
}

export function showsSavingSql(now: Date): SQL<boolean> {
  return sql<boolean>`(coalesce(${items.mlDiscountPct}, 0) > 0 or ${savingSql(now)} > 0)`
}
