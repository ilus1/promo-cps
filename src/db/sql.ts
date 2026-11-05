import { getTableColumns, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { REALERT_MIN_DROP_CENTS } from '@/lib/constants'
import { BASIS_POINTS, REALERT_KEEP_BASIS_POINTS } from '@/lib/price-drop'

type ColumnsOf<T extends PgTable> = T['_']['columns']

export const OVERWRITE = 'overwrite'
export const KEEP_KNOWN = 'keepKnown'
export type OnConflict = typeof OVERWRITE | typeof KEEP_KNOWN

export function excluded(column: PgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`
}

export function conflictUpdates<T extends PgTable, K extends keyof ColumnsOf<T> & string>(
  table: T, policies: Record<K, OnConflict>,
): Record<K, SQL> {
  const columns: Record<string, PgColumn> = getTableColumns(table)
  const entries = Object.entries<OnConflict>(policies).map(([key, policy]) => {
    const column = columns[key]
    return [key, policy === OVERWRITE ? excluded(column) : sql`coalesce(${excluded(column)}, ${column})`]
  })
  return Object.fromEntries(entries) as Record<K, SQL>
}

export function columnsWithout<T extends PgTable, K extends keyof ColumnsOf<T> & string>(
  table: T, omitted: K,
): Omit<ColumnsOf<T>, K> {
  const columns: Record<string, PgColumn> = getTableColumns(table)
  return Object.fromEntries(Object.entries(columns).filter(([key]) => key !== omitted)) as Omit<ColumnsOf<T>, K>
}

export function textArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`
}

export function matchesAllWords(value: PgColumn | SQL, regexes: readonly string[]): SQL {
  return sql`${value} ~* all (${textArray(regexes)})`
}

export function meaningfulDrop(price: SQL | PgColumn, reference: SQL | PgColumn): SQL {
  return sql`(${price}::bigint * ${BASIS_POINTS}::int <= ${reference}::bigint * ${REALERT_KEEP_BASIS_POINTS}::int
    and ${price} <= ${reference} - ${REALERT_MIN_DROP_CENTS}::int)`
}
