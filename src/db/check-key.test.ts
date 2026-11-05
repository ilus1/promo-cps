import { sql, type SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { expect, test } from 'vitest'
import { checkKeyOf } from './check-key'
import { checkKeySql } from './check-sql'
import { items } from './schema'

const dialect = new PgDialect()
const CHECK_KEY_INDEX = 'items_check_key_idx'

test('the check key renders the item prefix as a literal, with no parameter', () => {
  expect(dialect.sqlToQuery(checkKeySql)).toMatchObject({ sql: `coalesce("items"."product_id", 'item:' || "items"."id")`, params: [] })
})

test('the items index is built from the same key expression as the queries', () => {
  const index = getTableConfig(items).indexes.find((candidate) => candidate.config.name === CHECK_KEY_INDEX)
  expect(index?.config.columns).toHaveLength(1)
  const expression = index?.config.columns[0] as SQL
  expect(dialect.sqlToQuery(expression)).toEqual(dialect.sqlToQuery(checkKeySql))
  expect(dialect.sqlToQuery(expression, 'indexes')).toMatchObject({ sql: `coalesce("product_id", 'item:' || "id")`, params: [] })
})

test('a key expression over other columns keeps the same literal prefix', () => {
  expect(dialect.sqlToQuery(checkKeyOf(sql.identifier('p'), sql.identifier('i'))).sql).toBe(`coalesce("p", 'item:' || "i")`)
})
