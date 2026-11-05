import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { AMAZON_SEARCH_VALID_DAYS, AMAZON_UNKNOWN_RETRY_HOURS } from '@/lib/constants'
import { daysBefore, hoursBefore } from '@/lib/freshness'
import type { PageKind, SearchPriority } from '@/lib/market/types'
import { compareQuery } from '@/lib/price-compare/clean-title'
import { db } from './client'
import { checkKeySql } from './check-sql'
import { targetTiers, type TargetTier } from './target-tiers'
import { items, marketSearches } from './schema'
import { excluded } from './sql'

const RANKED = 'ranked'
const DUE_KEYS = sql.identifier('due_keys')
const KEY_COLUMN = sql.identifier('key')
const UNKNOWN_PAGE: PageKind = 'unknown'
const QUEUED_CTE = sql.identifier('queued')
const QUEUED_COLUMN = sql.identifier('queued')
const SEARCHED_AT_COLUMN = sql.identifier('searched_at')

export interface DueSearch { key: string; query: string }
export interface SearchCounts { searched: number; due: number }

function searchedAt(at: Date): SQL {
  return sql`${sql.param(at, marketSearches.searchedAt)}::timestamptz`
}

export function searchFreshSince(now: Date): SQL {
  return sql`(case when ${eq(marketSearches.status, UNKNOWN_PAGE)} then ${searchedAt(hoursBefore(now, AMAZON_UNKNOWN_RETRY_HOURS))}
    else ${searchedAt(daysBefore(now, AMAZON_SEARCH_VALID_DAYS))} end)`
}

export function searchDueCondition(now: Date): SQL {
  return or(isNull(marketSearches.searchedAt), lt(marketSearches.searchedAt, searchFreshSince(now))) as SQL
}

function freshSearchSql(key: SQL, now: Date): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${marketSearches} where ${and(
    eq(marketSearches.key, key),
    gte(marketSearches.searchedAt, searchFreshSince(now)),
  )})`
}

function queuedKeysCondition(now: Date): SQL {
  return and(isNotNull(marketSearches.priorityAt), searchDueCondition(now)) as SQL
}

function queuedSearches(now: Date, limit: number): Promise<DueSearch[]> {
  return db.select({ key: marketSearches.key, query: marketSearches.query }).from(marketSearches)
    .where(queuedKeysCondition(now))
    .orderBy(asc(marketSearches.priorityAt), asc(marketSearches.key))
    .limit(limit)
}

function tierSearchesQuery(now: Date, { where, order }: TargetTier, limit: number) {
  const ranked = db.select({
    key: checkKeySql.as('key'),
    id: items.id,
    title: items.title,
    observedAt: items.observedAt,
    rank: sql<number>`row_number() over (order by ${sql.join([...order, asc(items.id)], sql`, `)})`.as('rank'),
  }).from(items)
    .where(and(where, sql`not ${freshSearchSql(checkKeySql, now)}`))
    .as(RANKED)
  const recent = sql`order by ${ranked.observedAt} desc, ${ranked.id}`
  return db.select({
    key: ranked.key,
    title: sql<string>`(array_agg(${ranked.title} ${recent}))[1]`,
  }).from(ranked)
    .groupBy(ranked.key)
    .orderBy(sql`min(${ranked.rank})`)
    .limit(limit)
}

export async function dueSearches(now: Date, limit: number): Promise<DueSearch[]> {
  const due = await queuedSearches(now, limit)
  const seen = new Set(due.map((search) => search.key))
  for (const tier of targetTiers(now)) {
    if (due.length >= limit) break
    const rows = await tierSearchesQuery(now, tier, limit)
    for (const row of rows) {
      const query = compareQuery(row.title)
      if (seen.has(row.key) || query === '') continue
      seen.add(row.key)
      due.push({ key: row.key, query })
    }
  }
  return due.slice(0, limit)
}

export async function recordSearch(key: string, query: string, status: PageKind, resultCount: number, now: Date): Promise<void> {
  const row = { query, searchedAt: now, status, resultCount, priorityAt: null }
  await db.insert(marketSearches).values({ key, ...row }).onConflictDoUpdate({ target: marketSearches.key, set: row })
}

type PriorityRow = { queued: boolean; searched_at: string | null }

export async function prioritizeSearch(key: string, query: string, now: Date): Promise<SearchPriority> {
  const upsert = db.insert(marketSearches).values({ key, query, priorityAt: now })
    .onConflictDoUpdate({
      target: marketSearches.key,
      set: { query, priorityAt: sql`coalesce(${marketSearches.priorityAt}, ${excluded(marketSearches.priorityAt)})` },
      setWhere: searchDueCondition(now),
    })
    .returning({ key: marketSearches.key })
  const [row] = await db.execute<PriorityRow>(sql`with ${QUEUED_CTE} as (${upsert.getSQL()})
    select exists (select 1 from ${QUEUED_CTE}) as ${QUEUED_COLUMN},
      (select ${marketSearches.searchedAt} from ${marketSearches} where ${eq(marketSearches.key, key)}) as ${SEARCHED_AT_COLUMN}`)
  const searchedAt = row?.searched_at ?? null
  return { queued: row?.queued === true, searchedAt: searchedAt === null ? null : new Date(searchedAt) }
}

export async function searchCounts(now: Date): Promise<SearchCounts> {
  const targets = or(...targetTiers(now).map((tier) => tier.where))
  const keys = sql`(select ${checkKeySql} as ${KEY_COLUMN} from ${items} where ${targets}
    union select ${marketSearches.key} from ${marketSearches} where ${queuedKeysCondition(now)}) ${DUE_KEYS}`
  const fresh = freshSearchSql(sql`${DUE_KEYS}.${KEY_COLUMN}`, now)
  const [row] = await db.select({
    searched: sql<number>`(count(*) filter (where ${fresh}))::int`,
    due: sql<number>`(count(*) filter (where not ${fresh}))::int`,
  }).from(keys)
  return { searched: row?.searched ?? 0, due: row?.due ?? 0 }
}
