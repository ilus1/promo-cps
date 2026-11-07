import { PgDialect } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'
import { STORE_SCOPE_PREFIX } from '@/ingestion/ml/coupons'
import { TRIVIAL_SAVING_CENTS, UNCAPPED_FROM_CENTS } from '@/lib/constants'
import {
  discountAtMinimum, effectiveLimitCents, isTrivialSaving, isUnboundedSaving, maxSavingCents,
} from '@/lib/coupon-value'
import { COUPON_SORTS, type CouponKind } from '@/lib/domain'
import { discountThresholdRatio } from '@/lib/format'
import { wordRegexes } from '@/lib/text-search'
import {
  activationOrderBy, COUPON_TEXT_ITEMS_LIMIT, couponOrderBy, discountAtMinimumSql, filterConditions, maxSavingSql, validConditions,
  type CouponFilters,
} from './coupons'

vi.mock('./client', () => ({ db: {} }))

const NOW = new Date('2026-11-02T12:00:00Z')
const dialect = new PgDialect()
const renderWhere = (f: CouponFilters) => dialect.sqlToQuery(sql.join(filterConditions(f, NOW), sql` and `))

test('the valid count keeps every filter and adds the live rule', () => {
  const live = dialect.sqlToQuery(sql.join(validConditions({}, NOW), sql` and `))
  expect(live.sql).toContain('"ended_at" is null')
  expect(live.sql).toContain('"expires_at"')
  expect(live.sql).toContain('"starts_at"')
  const filtered = dialect.sqlToQuery(sql.join(validConditions({ kind: 'fixed' }, NOW), sql` and `))
  expect(filtered.sql).toContain('"kind" = $')
  expect(filtered.sql).toContain('"ended_at" is null')
  expect(filtered.params).toContain('fixed')
})

test('no filters add no condition', () => {
  expect(filterConditions({}, NOW)).toEqual([])
})

test('zero and empty values add no condition', () => {
  expect(filterConditions({
    minimumMaxCents: 0, limitMinCents: 0, discountMin: 0, text: '',
  }, NOW)).toEqual([])
  expect(filterConditions({ text: ' \0 ' }, NOW)).toEqual([])
})

test('the discount filter reuses the expression and the display-rounding threshold', () => {
  const expression = dialect.sqlToQuery(discountAtMinimumSql())
  const filtered = renderWhere({ discountMin: 91 })
  expect(filtered.sql).toContain(expression.sql)
  expect(filtered.params).toContain(UNCAPPED_FROM_CENTS)
  expect(filtered.params).toContain(discountThresholdRatio(91))
})

test('limit uses the value for fixed coupons and the cap for percent coupons', () => {
  const q = renderWhere({ limitMinCents: 500 })
  expect(q.sql).toContain('"amount_off_cents"')
  expect(q.sql).toContain('"cap_cents"')
})

test('text matches the title, the store name without the prefix or a preview alt text, ignoring accents', () => {
  const q = renderWhere({ text: 'Mercado' })
  expect(q.sql).toContain('concat_ws(')
  expect(q.sql).toContain('~* all (array[')
  expect(q.sql).toContain('"title"')
  expect(q.sql).toContain('case when "coupons"."is_store" then substr(')
  expect(q.sql).toContain("preview.item ->> 'alt_text'")
  expect(q.sql).toContain("jsonb_typeof(\"coupons\".\"raw\" -> 'items') = 'array'")
  expect(q.params).toContain(STORE_SCOPE_PREFIX.length + 1)
  expect(q.params).toContain(wordRegexes('Mercado')[0])
})

describe('text matching', () => {
  test('every word is its own regex over one text, in any order', () => {
    const q = renderWhere({ text: 'bluetooth  fone' })
    expect(q.sql).toMatch(/~\* all \(array\[\$\d+, \$\d+\]::text\[\]\)/)
    expect(q.params).toEqual(expect.arrayContaining(wordRegexes('bluetooth fone')))
    expect(renderWhere({ text: 'fone bluetooth' }).params.slice(-2)).toEqual(wordRegexes('fone bluetooth'))
  })

  test('only the products a row can show are searched: the first ones, on the Mercado Livre image host', () => {
    const q = renderWhere({ text: 'fone' })
    expect(q.sql).toContain('with ordinality as preview(item, ord)')
    expect(q.sql).toContain('preview.ord <=')
    expect(q.sql).toContain("preview.item ->> 'image_url' ~*")
    expect(q.params).toContain(COUPON_TEXT_ITEMS_LIMIT)
    expect(q.params).toContain('^https?://http2\\.mlstatic\\.com([/?#]|$)')
  })

  test('accents typed by the user do not matter', () => {
    expect(renderWhere({ text: 'Câmera' }).params).toEqual(renderWhere({ text: 'camera' }).params)
  })

  test('the text goes in as a bound parameter, never in the SQL', () => {
    const q = renderWhere({ text: "x' or 1=1 --" })
    expect(q.sql).not.toContain('1=1')
    expect(q.params).toContain(wordRegexes("x'")[0])
  })

  test('filter text is normalized before it is matched', () => {
    expect(renderWhere({ text: '  a\0b  ' }).params).toContain(wordRegexes('ab')[0])
    expect(renderWhere({ text: 'a'.repeat(200) }).params).toContain(wordRegexes('a'.repeat(80))[0])
  })
})

describe('expressions', () => {
  test('discount at minimum', () => {
    expect(dialect.sqlToQuery(discountAtMinimumSql())).toMatchInlineSnapshot(`
      {
        "params": [
          "fixed",
          "percent",
          100,
          10000000,
          100,
          100,
        ],
        "sql": "(case
          when "coupons"."kind" = $1 and "coupons"."amount_off_cents" > 0
            then "coupons"."amount_off_cents"::float8 / greatest(coalesce("coupons"."min_payment_cents", 0), "coupons"."amount_off_cents")::float8
          when "coupons"."kind" = $2 and ("coupons"."percent_off" > 0 and "coupons"."percent_off" <= $3::int)
            then case
              when coalesce("coupons"."min_payment_cents", 0) <= 0 or "coupons"."cap_cents" is null or "coupons"."cap_cents" >= $4::int
                then ("coupons"."percent_off"::float8 / $5::float8)
              else least(("coupons"."percent_off"::float8 / $6::float8), "coupons"."cap_cents"::float8 / coalesce("coupons"."min_payment_cents", 0)::float8)
            end
        end)",
        "typings": [
          "none",
          "none",
          "none",
          "none",
          "none",
          "none",
        ],
      }
    `)
  })

  test('max saving', () => {
    expect(dialect.sqlToQuery(maxSavingSql())).toMatchInlineSnapshot(`
      {
        "params": [
          "fixed",
          "percent",
          10000000,
        ],
        "sql": "(case
          when "coupons"."kind" = $1 and "coupons"."amount_off_cents" > 0 then "coupons"."amount_off_cents"
          when "coupons"."kind" = $2 and "coupons"."cap_cents" < $3::int then "coupons"."cap_cents"
        end)",
        "typings": [
          "none",
          "none",
          "none",
        ],
      }
    `)
  })
})

describe('couponOrderBy', () => {
  const render = (sort: (typeof COUPON_SORTS)[number]) => couponOrderBy(sort, NOW).map((key) => dialect.sqlToQuery(key).sql)
  const NULLS: Record<(typeof COUPON_SORTS)[number], string[]> = {
    desconto: ['desc nulls last'],
    economia: ['desc nulls first', 'desc nulls last'],
    minimo: [],
    limite: ['desc nulls last'],
    vence: ['asc nulls last'],
  }

  test.each(COUPON_SORTS)('%s: ended first, then no-number, then its keys, then campaign_id', (sort) => {
    const keys = render(sort)
    expect(keys[0]).toMatch(/"ended_at" is not null[\s\S]* asc$/)
    expect(keys[1]).toMatch(/^\([\s\S]* is null\) asc$/)
    expect(keys.at(-1)).toBe('"coupons"."campaign_id" asc')
    const nulls = keys.slice(2, -1).filter((key) => key.includes('nulls')).map((key) => key.match(/(a|de)sc nulls (first|last)$/)?.[0])
    expect(nulls).toEqual(NULLS[sort])
  })
})

describe('sort order by the pure functions', () => {
  type Row = { id: string; kind: CouponKind; percent: number | null; amount: number | null; min: number | null; cap: number | null }
  const rows: Row[] = [
    { id: 'a', kind: 'percent', percent: 8, amount: null, min: 100, cap: UNCAPPED_FROM_CENTS },
    { id: 'b', kind: 'fixed', percent: null, amount: 1000, min: 1100, cap: null },
    { id: 'c', kind: 'percent', percent: 20, amount: null, min: 10000, cap: 1500 },
    { id: 'd', kind: 'unparsed', percent: null, amount: null, min: 500, cap: null },
    { id: 'e', kind: 'fixed', percent: null, amount: 500, min: null, cap: null },
    { id: 'f', kind: 'percent', percent: 8, amount: null, min: null, cap: null },
    { id: 'g', kind: 'fixed', percent: null, amount: null, min: 500, cap: null },
    { id: 'h', kind: 'percent', percent: 80, amount: null, min: 100, cap: 100 },
    { id: 'i', kind: 'fixed', percent: null, amount: 499, min: 500, cap: null },
    { id: 'j', kind: 'percent', percent: 50, amount: null, min: 1000, cap: 500 },
    { id: 'k', kind: 'fixed', percent: null, amount: 20000, min: 40000, cap: UNCAPPED_FROM_CENTS },
  ]

  const measured = rows.map((r) => ({
    id: r.id,
    min: r.min ?? 0,
    ratio: discountAtMinimum(r.kind, r.percent, r.amount, r.min, r.cap),
    saving: maxSavingCents(r.kind, r.amount, r.cap),
    limit: effectiveLimitCents(r.kind, r.amount, r.cap),
    unbounded: isUnboundedSaving(r.kind, r.cap),
  }))
  type Measured = (typeof measured)[number]

  const byRatio = (x: Measured, y: Measured) => {
    if (x.ratio === y.ratio) return 0
    if (x.ratio === null) return 1
    if (y.ratio === null) return -1
    return y.ratio - x.ratio
  }
  const noNumberLast = (x: Measured, y: Measured) => Number(x.ratio === null) - Number(y.ratio === null)
  const byId = (x: Measured, y: Measured) => x.id.localeCompare(y.id)
  const order = (...compares: ((x: Measured, y: Measured) => number)[]) =>
    [...measured].sort((x, y) => compares.reduce((result, compare) => result || compare(x, y), 0)).map((r) => r.id)

  test('desconto: trivial savings after the rest, then discount highest first', () => {
    const trivial = (x: Measured, y: Measured) => Number(isTrivialSaving(x.saving)) - Number(isTrivialSaving(y.saving))
    expect(order(noNumberLast, trivial, byRatio, byId)).toEqual(['e', 'b', 'j', 'k', 'c', 'a', 'f', 'i', 'h', 'd', 'g'])
  })

  test('economia: unbounded first, then saving and discount', () => {
    const bySaving = (x: Measured, y: Measured) => {
      if (x.saving === y.saving) return 0
      if (x.saving === null) return -1
      if (y.saving === null) return 1
      return y.saving - x.saving
    }
    expect(order(noNumberLast, bySaving, byRatio, byId)).toEqual(['a', 'f', 'k', 'c', 'b', 'e', 'j', 'i', 'h', 'd', 'g'])
  })

  test('limite: unbounded counts as the placeholder, the fixed value is its limit', () => {
    const key = (m: Measured) => (m.unbounded ? UNCAPPED_FROM_CENTS : m.limit)
    const byLimit = (x: Measured, y: Measured) => {
      if (key(x) === key(y)) return 0
      if (key(x) === null) return 1
      if (key(y) === null) return -1
      return key(y)! - key(x)!
    }
    expect(order(noNumberLast, byLimit, byId)).toEqual(['a', 'f', 'k', 'c', 'b', 'e', 'j', 'i', 'h', 'd', 'g'])
  })

  test('minimo: a missing minimum counts as zero', () => {
    expect(order(noNumberLast, (x, y) => x.min - y.min, byId)).toEqual(['e', 'f', 'a', 'h', 'i', 'j', 'b', 'c', 'k', 'd', 'g'])
  })
})

test('activation orders trivial savings last, then the largest limit with unbounded first, then the campaign id', () => {
  const keys = activationOrderBy().map((key) => dialect.sqlToQuery(key).sql)
  expect(keys).toHaveLength(3)
  expect(keys[0]).toMatch(/< \$\d+::int, false\) asc$/)
  expect(keys[1]).toMatch(/>= \$\d+::int then \$\d+::int/)
  expect(keys[1]).toMatch(/desc nulls last$/)
  expect(keys[2]).toBe('"coupons"."campaign_id" asc')
  const params = activationOrderBy().flatMap((key) => dialect.sqlToQuery(key).params)
  expect(params).toContain(TRIVIAL_SAVING_CENTS)
  expect(params).toContain(UNCAPPED_FROM_CENTS)
})
