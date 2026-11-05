import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { HOUR_MS, MARKET_CHECK_VALID_HOURS, PERCENT_BASE, SIBLING_CHEAPER_PERCENT, SIBLING_EXCLUDED_BASIS_MARKER, STALE_AFTER_HOURS } from '@/lib/constants'
import { STATUS_NOT_SEEN, STATUS_SAVED, STATUS_SEEN, type ItemStatus } from '@/lib/domain'
import { cheaperSiblingOf, priceVerdict, sameListingTitle, type VerdictCheck } from '@/lib/price-compare/verdict'
import { cheaperSiblingSql, hiddenSql, inflatedSql, realSavingSql, verifiedSql } from './verdict-sql'

vi.mock('./client', () => ({ db: {} }))

const NOW = new Date('2026-11-03T12:00:00Z')
const dialect = new PgDialect()
const render = (query: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(query)
const flat = (text: string) => text.replace(/\s+/g, ' ')
const CHECK_KEY = `coalesce("items"."product_id", 'item:' || "items"."id")`
const validSince = new Date(NOW.getTime() - MARKET_CHECK_VALID_HOURS * HOUR_MS)
const freshSince = new Date(NOW.getTime() - STALE_AFTER_HOURS * HOUR_MS).toISOString()

const checkAt = (over: Partial<VerdictCheck>): VerdictCheck => ({
  status: 'matched', confidence: 'high', checkedAt: NOW, marketLowCents: 1000, ...over,
})

describe('cheaperSiblingSql', () => {
  const { sql, params } = render(cheaperSiblingSql(NOW))

  it('is an exists over fresh listings with the same product and the same lower-cased title, other than the item, in integer maths', () => {
    expect(flat(sql)).toBe(
      '("items"."product_id" in (select "duplicate"."product_id" '
      + 'from "items" "duplicate" where "duplicate"."product_id" is not null '
      + 'group by "duplicate"."product_id" having count(*) > 1) '
      + 'and exists (select 1 from "items" "sibling" where ("sibling"."product_id" = "items"."product_id" '
      + 'and "sibling"."id" <> "items"."id" and lower("sibling"."title") = lower("items"."title") '
      + 'and ("sibling"."basis_text" is null or "sibling"."basis_text" not ilike $1) and "sibling"."observed_at" >= $2) '
      + 'and "sibling"."price_cents"::bigint * $3::int <= "items"."price_cents"::bigint * $4::int))',
    )
    expect(params).toEqual([`%${SIBLING_EXCLUDED_BASIS_MARKER}%`, freshSince, PERCENT_BASE, SIBLING_CHEAPER_PERCENT])
  })

  it('agrees with the pure rule on a grid of prices', () => {
    const [, , left, right] = params as [string, string, number, number]
    const sqlSays = (price: number, sibling: number) => sibling * left <= price * right
    const prices = [1, 99, 100, 1000, 8196, 15403, 999999]
    const siblings = [1, 89, 90, 91, 899, 900, 901, 7377, 7378, 13862, 13863, 999999]
    for (const price of prices) {
      for (const sibling of siblings) expect(sqlSays(price, sibling), `${sibling} vs ${price}`).toBe(cheaperSiblingOf(price, sibling))
    }
  })

  it('treats titles as equal when they differ only by case', () => {
    expect(sameListingTitle('Fone JBL 520BT', 'fone jbl 520bt')).toBe(true)
    expect(sameListingTitle('Kit C/10 Fone', 'Fone')).toBe(false)
  })
})

describe('inflatedSql', () => {
  const { sql, params } = render(inflatedSql(NOW))
  const text = flat(sql)

  it('needs a matched high check, valid for the market window, with more than zero market low', () => {
    expect(params.slice(0, 8)).toEqual(['matched', 'high', validSince.toISOString(), 0, 'matched', 'high', validSince.toISOString(), 0])
    expect(text).toContain('"price_checks"."status" = $1 and "price_checks"."confidence" = $2 and "price_checks"."checked_at" >= $3 and "price_checks"."market_low_cents" > $4')
  })

  it('needs only the market low at or below the final price, with no store count or second low', () => {
    expect(text).toContain('and "price_checks"."market_low_cents" <= (select "items"."price_cents" - "applied"."discount"')
    expect(text).not.toContain('store_count')
    expect(text).not.toContain('second_low_cents')
    expect(text).not.toContain('greatest(')
  })

  it('also needs a saving shown, from the ML discount or the total saving', () => {
    expect(text).toContain('coalesce("items"."ml_discount_pct", 0) > 0 or (select case')
  })

  it('prefilters with a hashable uncorrelated key list before the exact check, on the indexed key expression', () => {
    expect(text.startsWith(`(${CHECK_KEY} in (select "price_checks"."key" from "price_checks" where (`)).toBe(true)
    expect(text).toContain(`where ("price_checks"."key" = ${CHECK_KEY} and`)
  })

  it('agrees with the pure rule on a grid of checks and prices, reading the thresholds from the params', () => {
    const [matched, high, since, minLow] = params as [string, string, string, number]
    const sqlSays = (check: VerdictCheck, finalCents: number, showsSaving: boolean) =>
      check.status === matched && check.confidence === high && check.checkedAt.toISOString() >= since
      && check.marketLowCents !== null && check.marketLowCents > minLow
      && check.marketLowCents <= finalCents
      && showsSaving
    const checks: VerdictCheck[] = []
    for (const checkedAt of [NOW, validSince, new Date(validSince.getTime() - 1)]) {
      for (const marketLowCents of [null, 0, 1000, 1266]) {
        for (const confidence of ['high', 'medium', null] as const) {
          for (const status of ['matched', 'no_match'] as const) {
            checks.push(checkAt({ checkedAt, marketLowCents, confidence, status }))
          }
        }
      }
    }
    for (const check of checks) {
      for (const finalCents of [999, 1000, 1001, 1265, 1266, 1267, 1500, 1501]) {
        for (const showsSaving of [true, false]) {
          const pure = priceVerdict({
            check, item: { priceCents: finalCents, finalCents, showsSaving, status: STATUS_NOT_SEEN }, siblingPriceCents: null, now: NOW,
          }).inflated
          expect(sqlSays(check, finalCents, showsSaving), JSON.stringify({ check, finalCents, showsSaving })).toBe(pure)
        }
      }
    }
  })
})

describe('realSavingSql', () => {
  const { sql, params } = render(realSavingSql(NOW))

  it('is the market low minus the final price, for a valid high check only', () => {
    const text = flat(sql)
    expect(text.startsWith('(select "price_checks"."market_low_cents" - (select "items"."price_cents" - "applied"."discount"')).toBe(true)
    expect(text).toContain(`from "price_checks" where ("price_checks"."key" = ${CHECK_KEY} and`)
    expect(params.slice(-4)).toEqual(['matched', 'high', validSince.toISOString(), 0])
  })

  it('agrees with the pure rule on a grid of checks and final prices', () => {
    const [matched, high, since, minLow] = params.slice(-4) as [string, string, string, number]
    const sqlSays = (check: VerdictCheck, finalCents: number): number | null => {
      const valid = check.status === matched && check.confidence === high && check.checkedAt.toISOString() >= since
        && check.marketLowCents !== null && check.marketLowCents > minLow
      return valid && check.marketLowCents !== null ? check.marketLowCents - finalCents : null
    }
    for (const checkedAt of [NOW, validSince, new Date(validSince.getTime() - 1)]) {
      for (const marketLowCents of [null, 0, 1000]) {
        for (const confidence of ['high', 'medium', null] as const) {
          for (const status of ['matched', 'no_match'] as const) {
            for (const finalCents of [900, 1000, 1100]) {
              const check = checkAt({ checkedAt, marketLowCents, confidence, status })
              const pure = priceVerdict({
                check, item: { priceCents: finalCents, finalCents, showsSaving: true, status: STATUS_NOT_SEEN }, siblingPriceCents: null, now: NOW,
              }).realSavingCents
              expect(sqlSays(check, finalCents), JSON.stringify({ check, finalCents })).toBe(pure)
            }
          }
        }
      }
    }
  })
})

describe('hiddenSql', () => {
  const { sql, params } = render(hiddenSql(NOW))
  const text = flat(sql)

  it('has the skeleton: not a Salvo, a product id, and a cheaper sibling or an inflated item', () => {
    expect(text.startsWith('("items"."status" <> $1 and (("items"."product_id" is not null and ("items"."product_id" in (select')).toBe(true)
    expect(text).toContain(') or (coalesce("items"."product_id", ')
    expect(params[0]).toBe(STATUS_SAVED)
  })

  it('agrees with the pure rule over status x sibling x inflated', () => {
    const sqlSays = (status: ItemStatus, sibling: boolean, inflated: boolean) => status !== params[0] && (sibling || inflated)
    const inflatedCheck = checkAt({})
    const statuses: ItemStatus[] = [STATUS_NOT_SEEN, STATUS_SAVED, STATUS_SEEN]
    for (const status of statuses) {
      for (const sibling of [false, true]) {
        for (const inflated of [false, true]) {
          const pure = priceVerdict({
            check: inflated ? inflatedCheck : null,
            item: { priceCents: 1000, finalCents: 1000, showsSaving: true, status },
            siblingPriceCents: sibling ? 1 : null,
            now: NOW,
          }).hidden
          expect(sqlSays(status, sibling, inflated), `${status} ${sibling} ${inflated}`).toBe(pure)
        }
      }
    }
  })
})

describe('verifiedSql', () => {
  const real = render(realSavingSql(NOW))
  const { sql, params } = render(verifiedSql(NOW))

  it('is the real saving of a valid high check being positive, with the same terms and params', () => {
    expect(flat(sql)).toBe(`(${flat(real.sql)} > 0)`)
    expect(params).toEqual(real.params)
  })

  it('agrees with the pure verdict: only a valid high check with a positive real saving counts', () => {
    const [matched, high, since, minLow] = params.slice(-4) as [string, string, string, number]
    const sqlSays = (check: VerdictCheck, finalCents: number) => {
      const valid = check.status === matched && check.confidence === high && check.checkedAt.toISOString() >= since
        && check.marketLowCents !== null && check.marketLowCents > minLow
      return valid && check.marketLowCents !== null && check.marketLowCents - finalCents > 0
    }
    for (const checkedAt of [NOW, validSince, new Date(validSince.getTime() - 1)]) {
      for (const marketLowCents of [null, 0, 1000]) {
        for (const confidence of ['high', 'medium', null] as const) {
          for (const status of ['matched', 'no_match'] as const) {
            for (const finalCents of [999, 1000, 1001]) {
              const check = checkAt({ checkedAt, marketLowCents, confidence, status })
              const saving = priceVerdict({
                check, item: { priceCents: finalCents, finalCents, showsSaving: true, status: STATUS_NOT_SEEN }, siblingPriceCents: null, now: NOW,
              }).realSavingCents
              expect(sqlSays(check, finalCents), JSON.stringify({ check, finalCents })).toBe(saving !== null && saving > 0)
            }
          }
        }
      }
    }
  })
})
