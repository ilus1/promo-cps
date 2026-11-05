import { and, eq, getTableName, gt, gte, isNotNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { PERCENT_BASE, SIBLING_CHEAPER_PERCENT, SIBLING_EXCLUDED_BASIS_MARKER } from '@/lib/constants'
import { STATUS_SAVED } from '@/lib/domain'
import { freshSince } from '@/lib/freshness'
import { checkKeySql, matchedSince } from './check-sql'
import { items, priceChecks } from './schema'
import { finalPriceSql, showsSavingSql } from './saving'

const SIBLING_NAME = 'sibling'
export const sibling = alias(items, SIBLING_NAME)
const SIBLING_FROM = sql`${items} ${sql.identifier(getTableName(sibling))}`
const duplicate = alias(items, 'duplicate')
const DUPLICATE_FROM = sql`${items} ${sql.identifier(getTableName(duplicate))}`

function freshSibling(now: Date): SQL {
  return and(
    eq(sibling.productId, items.productId),
    sql`${sibling.id} <> ${items.id}`,
    sql`lower(${sibling.title}) = lower(${items.title})`,
    sql`(${sibling.basisText} is null or ${sibling.basisText} not ilike ${`%${SIBLING_EXCLUDED_BASIS_MARKER}%`})`,
    gte(sibling.observedAt, freshSince(now)),
  ) as SQL
}

function validHighCheckTerms(now: Date): SQL[] {
  return [
    eq(priceChecks.status, 'matched'),
    eq(priceChecks.confidence, 'high'),
    gte(priceChecks.checkedAt, matchedSince(now)),
    gt(priceChecks.marketLowCents, 0),
  ]
}

export function validHighCheck(now: Date): SQL {
  return and(eq(priceChecks.key, checkKeySql), ...validHighCheckTerms(now)) as SQL
}

export function cheapestSiblingSql(now: Date): SQL<{ id: string; url: string | null; priceCents: number } | null> {
  return sql`(select json_build_object('id', ${sibling.id}, 'url', ${sibling.url}, 'priceCents', ${sibling.priceCents})
    from ${SIBLING_FROM} where ${freshSibling(now)}
    order by ${sibling.priceCents} asc, ${sibling.id} limit 1)`
}

function sharesListing(): SQL {
  return sql`${items.productId} in (select ${duplicate.productId}
    from ${DUPLICATE_FROM} where ${isNotNull(duplicate.productId)}
    group by ${duplicate.productId} having count(*) > 1)`
}

export function cheaperSiblingSql(now: Date): SQL<boolean> {
  return sql<boolean>`(${sharesListing()} and exists (select 1 from ${SIBLING_FROM} where ${freshSibling(now)}
    and ${sibling.priceCents}::bigint * ${PERCENT_BASE}::int <= ${items.priceCents}::bigint * ${SIBLING_CHEAPER_PERCENT}::int))`
}

export function inflatedSql(now: Date): SQL<boolean> {
  const terms = validHighCheckTerms(now)
  return sql<boolean>`(${checkKeySql} in (select ${priceChecks.key} from ${priceChecks} where ${and(...terms)})
    and exists (select 1 from ${priceChecks} where ${and(
      eq(priceChecks.key, checkKeySql),
      ...terms,
      sql`${priceChecks.marketLowCents} <= ${finalPriceSql(now)}`,
    )}) and ${showsSavingSql(now)})`
}

export function realSavingSql(now: Date): SQL<number | null> {
  return sql<number | null>`(select ${priceChecks.marketLowCents} - ${finalPriceSql(now)}
    from ${priceChecks} where ${validHighCheck(now)})`
}

export function hiddenSql(now: Date): SQL<boolean> {
  return sql<boolean>`(${items.status} <> ${STATUS_SAVED} and (${and(isNotNull(items.productId), cheaperSiblingSql(now))} or ${inflatedSql(now)}))`
}

export function verifiedSql(now: Date): SQL<boolean> {
  return sql<boolean>`(${realSavingSql(now)} > 0)`
}
