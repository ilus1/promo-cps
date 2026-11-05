import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, test } from 'vitest'
import { REALERT_MIN_DROP_CENTS } from '@/lib/constants'
import { BASIS_POINTS, isMeaningfulDrop, REALERT_KEEP_BASIS_POINTS } from '@/lib/price-drop'
import { items } from './schema'
import { meaningfulDrop } from './sql'

const rendered = new PgDialect().sqlToQuery(meaningfulDrop(items.priceCents, items.seenPriceCents))

test('the rendered SQL and its params are pinned', () => {
  expect(rendered.sql).toBe(
    '("items"."price_cents"::bigint * $1::int <= "items"."seen_price_cents"::bigint * $2::int\n'
    + '    and "items"."price_cents" <= "items"."seen_price_cents" - $3::int)',
  )
  expect(rendered.params).toEqual([BASIS_POINTS, REALERT_KEEP_BASIS_POINTS, REALERT_MIN_DROP_CENTS])
})

function translated(): (price: number, reference: number) => boolean {
  const expression = rendered.sql
    .replace(/\$(\d+)/g, (_, n: string) => String(rendered.params[Number(n) - 1]))
    .replace(/::(bigint|int)/g, '')
    .replaceAll('"items"."price_cents"', 'price')
    .replaceAll('"items"."seen_price_cents"', 'reference')
    .replace(/\band\b/g, '&&')
  return new Function('price', 'reference', `return ${expression}`) as (price: number, reference: number) => boolean
}

test('the SQL text, translated to JS, agrees with the pure rule on a grid of prices', () => {
  const sqlSaysDrop = translated()
  const references = [50, 99, 100, 101, 999, 1000, 1001, 9999, 10000, 123456]
  const prices = [0, 1, 49, 50, 98, 99, 100, 900, 901, 9900, 9901, 10000, 120000, 123455, 123456]
  for (const reference of references) {
    for (const price of prices) {
      expect(sqlSaysDrop(price, reference), `${price} vs ${reference}`).toBe(isMeaningfulDrop(price, reference))
    }
  }
})
