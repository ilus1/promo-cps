import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { HOUR_MS, STALE_AFTER_HOURS } from '@/lib/constants'
import { wordRegexes } from '@/lib/text-search'
import { savingThresholdRatio } from '@/lib/format'
import type { DealListOptions } from '@/lib/deal-query'
import { dealOrder, dealWhere } from './deals'

vi.mock('./client', () => ({ db: {} }))

const NOW = new Date('2026-11-02T12:00:00Z')
const BASE: DealListOptions = {
  tab: 'NOT_SEEN', onlyDrops: false, full: false, freeShipping: false, offersOnly: false, includeStale: false, showInflated: true, onlyVerified: false, sort: 'desconto',
}
const UUID = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'

const render = (o: DealListOptions) => new PgDialect().sqlToQuery(dealWhere(o, NOW))
const renderOrder = (sort: DealListOptions['sort']) =>
  dealOrder(sort, NOW).map((part) => new PgDialect().sqlToQuery(part))

describe('dealWhere', () => {
  it('a status list becomes an IN, a single status stays an equality', () => {
    const list = render({ ...BASE, tab: ['NOT_SEEN', 'SAVED'] })
    expect(list.sql).toContain('"items"."status" in ($1, $2)')
    expect(list.params.slice(0, 2)).toEqual(['NOT_SEEN', 'SAVED'])
    expect(render({ ...BASE, tab: 'SEEN' }).sql).toContain('"items"."status" = $1')
  })

  it('freshness spares Salvos only, and is skipped with includeStale', () => {
    const q = render(BASE)
    expect(q.sql).toContain('("items"."status" = $')
    expect(q.sql).toContain('or "items"."observed_at" >=')
    expect(q.params).toContain('SAVED')
    expect(render({ ...BASE, includeStale: true }).sql).not.toContain('"items"."observed_at" >=')
  })

  it('a malformed busca matches nothing and never reaches Postgres as a uuid', () => {
    const q = render({ ...BASE, searchId: 'not-a-uuid' })
    expect(q.sql).toContain('false')
    expect(q.sql).not.toContain('"searches"')
    expect(q.params).not.toContain('not-a-uuid')
  })

  it('a well-formed busca is checked against searches and the item links', () => {
    const q = render({ ...BASE, searchId: UUID })
    expect(q.sql).toContain('"searches"')
    expect(q.sql).toContain('"item_sources"')
    expect(q.params).toContain(UUID)
  })

  describe('text filter', () => {
    const matches = (sqlText: string) => sqlText.match(/"items"\."title" ~\* all \(array\[/g)?.length ?? 0

    it('needs every word, one case-insensitive regex each, matched in one pass over the title', () => {
      const q = render({ ...BASE, text: 'Fone  100%  a_b' })
      expect(matches(q.sql)).toBe(1)
      expect(q.sql).toMatch(/array\[\$\d+, \$\d+, \$\d+\]::text\[\]/)
      expect(q.sql).not.toContain('translate(')
      expect(q.params).toEqual(expect.arrayContaining(wordRegexes('Fone 100% a_b')))
    })

    it('ignores accents typed by the user', () => {
      expect(render({ ...BASE, text: 'Câmera' }).params).toEqual(render({ ...BASE, text: 'camera' }).params)
    })

    it.each([undefined, '', '   ', '\0'])('adds nothing for %j', (text) => {
      expect(matches(render({ ...BASE, text }).sql)).toBe(0)
    })

    it('caps a very long text', () => {
      const q = render({ ...BASE, text: 'a'.repeat(500) })
      expect(q.params).toContain(wordRegexes('a'.repeat(80))[0])
    })

    it('goes in as bound parameters, never in the SQL', () => {
      const q = render({ ...BASE, text: "x' or 1=1 --" })
      expect(q.sql).not.toContain('1=1')
    })
  })

  it('the category is the product type', () => {
    const q = render({ ...BASE, category: 'MLB-NOTEBOOKS' })
    expect(q.sql).toContain('"items"."domain_id" =')
    expect(q.sql).not.toContain('category_id')
    expect(q.params).toContain('MLB-NOTEBOOKS')
  })

  it('always filters by tab', () => {
    expect(render(BASE).params).toContain('NOT_SEEN')
  })

  describe('cupons filter', () => {
    const FRESH_SINCE = new Date(NOW.getTime() - STALE_AFTER_HOURS * HOUR_MS)
    const withSet = (couponSetQuery: string) => render({ ...BASE, couponSetQuery })

    it('is one EXISTS over fresh coupon links whose source is in an uncorrelated subquery of live matching coupons', () => {
      const q = withSet('status=ativo&minimoMax=100')
      expect(q.sql.match(/exists \(select 1 from "item_sources"/g)).toHaveLength(1)
      expect(q.sql).toContain('"item_sources"."source_id" in (select "coupons"."campaign_id" from "coupons"')
      expect(q.sql).not.toContain('inner join "coupons"')
      expect(q.sql).toContain('"item_sources"."last_seen_at" >=')
      expect(q.sql).toContain('"coupons"."ended_at" is null')
      expect(q.params).toContain('coupon')
      expect(q.params).toContain(FRESH_SINCE.toISOString())
    })

    it('puts the nested coupon filters inside the EXISTS, with the same now', () => {
      const q = withSet('minimoMax=100')
      expect(q.sql).toContain('coalesce("coupons"."min_payment_cents", 0) <=')
      expect(q.params).toContain(10000)
      expect(q.params).toContain(NOW.toISOString())
    })

    it('adds nothing when the set has no filter, and ANDs with cupom', () => {
      expect(render({ ...BASE, couponSetQuery: undefined }).sql).toBe(render(BASE).sql)
      const both = render({ ...BASE, couponId: '99', couponSetQuery: 'tipo=fixed' })
      expect(both.sql.match(/exists \(select 1 from "item_sources"/g)).toHaveLength(2)
      expect(both.params).toContain('99')
      expect(both.params).toContain('fixed')
    })
  })

  it('zero minimums add no condition', () => {
    const open = render(BASE).sql
    expect(render({ ...BASE, discountMin: 0, soldMin: 0, savingMin: 0, savingMinCents: 0 }).sql).toBe(open)
  })

  describe('saving', () => {
    it('the percent filter compares the ratio with the display-rounded threshold', () => {
      const q = render({ ...BASE, savingMin: 30 })
      expect(q.sql).toMatch(/\) >= \$\d+::float8\)/)
      expect(q.params).toContain(savingThresholdRatio(30))
    })

    it('the reais filter compares the saving in cents', () => {
      const q = render({ ...BASE, savingMinCents: 5000 })
      expect(q.sql).toContain('>= $')
      expect(q.params).toContain(5000)
    })

    it('the final price comes from one correlated subquery over fresh links to live coupons', () => {
      const q = render({ ...BASE, savingMinCents: 5000 })
      expect(q.sql).toContain('(select max(least(')
      expect(q.sql).toContain('"item_sources"."item_id" = "items"."id"')
      expect(q.sql).toContain('"coupons"."ended_at" is null')
      expect(q.sql).toContain('"items"."price_cents" >= coalesce("coupons"."min_payment_cents", 0)')
      expect(q.sql).toContain('having max(')
      expect(q.params).toContain(new Date(NOW.getTime() - STALE_AFTER_HOURS * HOUR_MS).toISOString())
    })

    it('runs the best-coupon subquery once per saving filter and fences it with offset 0', () => {
      const count = (sqlText: string) => sqlText.match(/\(select max\(least\(/g)?.length ?? 0
      expect(render({ ...BASE, savingMin: 30 }).sql).toContain('offset 0) "applied")')
      expect(count(render({ ...BASE, savingMin: 30 }).sql)).toBe(1)
      expect(count(render({ ...BASE, savingMinCents: 5000 }).sql)).toBe(1)
      expect(count(render({ ...BASE, savingMin: 30, savingMinCents: 5000 }).sql)).toBe(2)
    })

    it('offers-only also accepts a saving that comes from a linked coupon', () => {
      const q = render({ ...BASE, offersOnly: true })
      expect(q.sql).toContain('"items"."ml_discount_pct" > $')
      expect(q.sql).toContain('"items"."drop_ratio" > $')
      expect(q.sql).toContain('(select max(least(')
      expect(q.sql).toMatch(/\) > 0\)/)
      expect(render(BASE).sql).not.toContain('(select max(least(')
    })

    it('the coupon bases keep the shown price and the hint never enters the price', () => {
      const q = render({ ...BASE, savingMinCents: 5000 })
      expect(q.sql).toContain('"items"."basis" in ($')
      expect(q.params).toEqual(expect.arrayContaining(['coupon', 'pix_coupon']))
      expect(q.sql).not.toContain('coupon_hint')
    })

    it('economia sorts by ratio descending with nulls last and economiaReais by cents descending', () => {
      const [ratio] = renderOrder('economia')
      const [cents] = renderOrder('economiaReais')
      expect(ratio.sql).toMatch(/\) desc nulls last$/)
      expect(ratio.sql).toContain('nullif("items"."price_cents", 0)')
      expect(cents.sql).toMatch(/\) desc$/)
      expect(cents.sql).not.toContain('nullif')
    })
  })
})

describe('dealOrder economiaCupom', () => {
  it('orders by the coupon part, biggest first, with items without one last', () => {
    const [order, ...rest] = renderOrder('economiaCupom')
    expect(rest).toEqual([])
    expect(order.sql.replace(/\s+/g, ' ')).toMatch(/\) desc nulls last$/)
    expect(order.sql).toContain('"items"."basis"')
  })
})

describe('inflated and cheaper-sibling items', () => {
  const shown = { ...BASE, showInflated: false }

  it('are hidden by default, with a single hidden clause that spares Salvos', () => {
    const q = render(shown)
    expect(q.sql).toContain('not ("items"."status" <> ')
    expect(q.sql).toContain('"price_checks"')
    expect(q.sql).toContain('"items" "sibling"')
    expect(q.params).toContain('SAVED')
  })

  it('show with inflados: the same query without the clause', () => {
    const q = render({ ...BASE, showInflated: true })
    expect(q.sql).not.toContain('"price_checks"')
    expect(q.sql).not.toContain('"sibling"')
  })

  it('do not change the other conditions', () => {
    const withHidden = render({ ...shown, full: true })
    expect(withHidden.sql).toContain('"items"."full" = $')
  })
})

describe('dealOrder economiaReal', () => {
  it('orders by the real saving, biggest first, with unchecked items last', () => {
    const [order, ...rest] = renderOrder('economiaReal')
    expect(rest).toEqual([])
    expect(order.sql.replace(/\s+/g, ' ')).toMatch(/^\(select "price_checks"\."market_low_cents" - .* desc nulls last$/)
  })
})

describe('verificados', () => {
  it('adds the positive real saving of a valid high check', () => {
    const q = render({ ...BASE, onlyVerified: true })
    expect(q.sql.replace(/\s+/g, ' ')).toContain('"price_checks"."market_low_cents" - (select')
    expect(q.sql).toContain(') > 0)')
  })

  it('adds nothing when off', () => {
    expect(render(BASE).sql).not.toContain('"price_checks"')
  })
})
