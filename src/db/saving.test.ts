import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, test, vi } from 'vitest'
import { COUPON_BASES } from '@/ingestion/ml/basis'
import { PERCENT_BASE, UNCAPPED_FROM_CENTS } from '@/lib/constants'
import { COUPON_PART_BASIS, couponPart, type LinkedCouponTerms } from '@/lib/deal-saving'
import { couponPartSql, finalPriceSql } from './saving'

vi.mock('./client', () => ({ db: {} }))

const NOW = new Date('2026-11-03T12:00:00Z')
const rendered = new PgDialect().sqlToQuery(couponPartSql(NOW))
const flat = rendered.sql.replace(/\s+/g, ' ')

const PINNED_FORMULA = 'least(case when "sole"."kind" = $2 then least(round("items"."price_cents"::numeric * "sole"."percent_off" / ($3::int - "sole"."percent_off")), "sole"."max_saving") else "sole"."amount_off" end, "items"."list_price_cents" - "items"."price_cents")::int as "cents"'
const PINNED_FILTER = 'where "sole"."linked" = 1 and "sole"."usable" and "items"."coupon_hint" is null) "part"'
const PINNED_LIMIT = '(case when "coupons"."kind" = $4 and "coupons"."amount_off_cents" > 0 then "coupons"."amount_off_cents" when "coupons"."kind" = $5 and "coupons"."cap_cents" < $6::int then "coupons"."cap_cents" end) as "max_saving"'
const PINNED_USABLE = '(("coupons"."kind" = $7 and ("coupons"."percent_off" > 0 and "coupons"."percent_off" <= $8::int)) or ("coupons"."kind" = $9 and "coupons"."amount_off_cents" > 0)) and "coupons"."percent_off" is distinct from $10::int as "usable"'

function sqlSaysPart(price: number, list: number | null, coupon: LinkedCouponTerms): number | null {
  const [basis, percentKind, percentBase] = rendered.params as [string, string, number]
  expect(basis).toBe(COUPON_PART_BASIS)
  const usable = (coupon.kind === 'percent' && coupon.percentOff !== null && coupon.percentOff > 0 && coupon.percentOff <= percentBase
    && coupon.percentOff !== percentBase) || (coupon.kind === 'fixed' && (coupon.amountOffCents ?? 0) > 0)
  if (!usable) return null
  const maxSaving = coupon.kind === 'fixed' ? coupon.amountOffCents
    : coupon.capCents !== null && coupon.capCents < UNCAPPED_FROM_CENTS ? coupon.capCents : null
  const percentPart = Math.round((price * (coupon.percentOff as number)) / (percentBase - (coupon.percentOff as number)))
  const applied = coupon.kind === percentKind ? Math.min(percentPart, maxSaving ?? percentPart) : (coupon.amountOffCents as number)
  const cents = Math.min(applied, list === null ? applied : list - price)
  return cents > 0 ? cents : null
}

test('the coupon part SQL keeps the pinned formula and the one-coupon filter', () => {
  expect(flat).toContain(PINNED_FORMULA)
  expect(flat).toContain(PINNED_FILTER)
  expect(flat).toContain(PINNED_LIMIT)
  expect(flat).toContain(PINNED_USABLE)
  expect(flat).toContain('count(*) over () as "linked"')
  expect(rendered.params.slice(0, 3)).toEqual([COUPON_PART_BASIS, 'percent', PERCENT_BASE])
})

test('the coupon part SQL separates the coupon basis, the mixed basis and the plain price', () => {
  expect(flat).toMatch(/^\(case when "items"\."basis" = \$1 then /)
  expect(flat).toContain('when "items"."basis" in (')
  for (const basis of COUPON_BASES) expect(rendered.params).toContain(basis)
})

test('the pinned formula and the pure rule agree on a grid', () => {
  const coupons: LinkedCouponTerms[] = []
  for (const percentOff of [0, 0.001, 5, 12.5, 20, 50, 99, 100]) {
    for (const capCents of [null, 300, 1500, UNCAPPED_FROM_CENTS]) {
      coupons.push({ kind: 'percent', percentOff, amountOffCents: null, minPaymentCents: null, capCents })
    }
  }
  for (const amountOffCents of [0, 1, 700, 20000]) {
    coupons.push({ kind: 'fixed', percentOff: null, amountOffCents, minPaymentCents: null, capCents: null })
  }
  for (const coupon of coupons) {
    for (const price of [1, 6, 999, 9000, 123456]) {
      for (const list of [null, 1, 6, 999, 9000, 9750, 12000, 200000]) {
        const item = { priceCents: price, listPriceCents: list, basis: COUPON_PART_BASIS, couponHint: null }
        const pure = couponPart(item, [coupon])
        const expected = sqlSaysPart(price, list, coupon)
        expect(pure?.couponCents ?? null, JSON.stringify({ coupon, price, list })).toBe(expected)
      }
    }
  }
})

test('the final price SQL is the price minus the applied discount, computed once', () => {
  const { sql } = new PgDialect().sqlToQuery(finalPriceSql(NOW))
  const flatSql = sql.replace(/\s+/g, ' ')
  expect(flatSql.startsWith('(select "items"."price_cents" - "applied"."discount" from (select ')).toBe(true)
  expect(flatSql.endsWith('offset 0) "applied")')).toBe(true)
  expect(flatSql.match(/"applied"\."discount"/g)).toHaveLength(1)
})
