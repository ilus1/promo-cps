import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, test } from 'vitest'
import { keysCondition } from './check-sql'

const render = (keys: string[]) => {
  const { sql, params } = new PgDialect().sqlToQuery(keysCondition(keys))
  return { sql, params }
}

test('product keys match by product id and item keys match an item without a product', () => {
  expect(render(['MLB1', 'item:MLB9', 'MLB2'])).toEqual({
    sql: '("items"."product_id" in ($1, $2) or ("items"."product_id" is null and "items"."id" in ($3)))',
    params: ['MLB1', 'MLB2', 'MLB9'],
  })
})

test('only one kind of key needs only its own branch', () => {
  expect(render(['MLB1'])).toEqual({ sql: '"items"."product_id" in ($1)', params: ['MLB1'] })
  expect(render(['item:MLB9'])).toEqual({ sql: '("items"."product_id" is null and "items"."id" in ($1))', params: ['MLB9'] })
})

test('no keys match nothing', () => {
  expect(render([])).toEqual({ sql: 'false', params: [] })
})
