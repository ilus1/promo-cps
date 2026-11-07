import { describe, expect, test } from 'vitest'
import { SEARCH_TEXT_MAX, MAX_EXPIRY_FILTER_DAYS, UNCAPPED_FROM_CENTS } from './constants'
import {
  CLEARED_COUPON_FILTERS, couponHref, FILTERABLE_KINDS, hasCouponFilters, parseCouponQuery, SCOPE_PARAM, STATUS_PARAM,
  type CouponQuery,
} from './coupon-query'
import { COUPON_LIST_STATUSES, COUPON_SCOPES, COUPON_SORTS } from './domain'
import { ROUTES } from './routes'

const none = parseCouponQuery({})

test('maps the pt-BR values to domain values', () => {
  expect(parseCouponQuery({ status: 'encerrado', escopo: 'loja', tipo: 'fixed', vence: '7', pagina: '3' })).toEqual({
    status: 'ended', scope: 'store', kind: 'fixed', expiringWithinDays: 7, order: 'desconto', page: 3,
  })
})

test('drops invalid values instead of throwing', () => {
  expect(parseCouponQuery({ status: 'active', escopo: 'x', tipo: 'unparsed', vence: '-2', pagina: 'abc' })).toEqual({
    status: undefined, scope: undefined, kind: undefined, expiringWithinDays: undefined, order: 'desconto', page: 1,
  })
})

test('repeated params are dropped', () => {
  expect(parseCouponQuery({ tipo: ['percent', 'fixed'], status: ['ativo'] })).toEqual(none)
})

test('a window below one day is dropped and a fractional one is floored', () => {
  expect(parseCouponQuery({ vence: '0' }).expiringWithinDays).toBeUndefined()
  expect(parseCouponQuery({ vence: '0.5' }).expiringWithinDays).toBeUndefined()
  expect(parseCouponQuery({ vence: '2.9' }).expiringWithinDays).toBe(2)
})

test('a huge window is capped so the date stays valid', () => {
  expect(parseCouponQuery({ vence: '100000000' }).expiringWithinDays).toBe(MAX_EXPIRY_FILTER_DAYS)
})

describe('new filters', () => {
  test('reads reais as cents, percent as a whole number and the sort', () => {
    expect(parseCouponQuery({
      minimoMax: '100', limiteMin: '12.5', descontoMin: '30.2', ordem: 'minimo',
    })).toMatchObject({
      minimumMaxCents: 10000, limitMinCents: 1250, discountMin: 31, order: 'minimo',
    })
  })

  test('zero, empty, negative and invalid mean no filter', () => {
    const q = parseCouponQuery({
      minimoMax: '0', limiteMin: '', descontoMin: '-5', q: '   ', ordem: 'bogus',
    })
    expect(q).toEqual(none)
    expect(parseCouponQuery({ minimoMax: 'x', limiteMin: '0.004', descontoMin: '0' })).toEqual(none)
  })

  test('a discount above 100 is capped and repeated params are dropped', () => {
    expect(parseCouponQuery({ descontoMin: '900' }).discountMin).toBe(100)
    expect(parseCouponQuery({ minimoMax: ['1', '2'], q: ['a', 'b'], ordem: ['limite'] })).toEqual(none)
  })

  test('a fractional discount rounds up as on Ofertas and the href clamps to 100', () => {
    expect(parseCouponQuery({ descontoMin: '0.9' }).discountMin).toBe(1)
    expect(couponHref(none, { discountMin: 900 })).toBe('/cupons?descontoMin=100')
    expect(couponHref(none, { discountMin: 0 })).toBe('/cupons')
  })

  test('a limit above the placeholder threshold means only unbounded coupons', () => {
    expect(parseCouponQuery({ limiteMin: '5000000' }).limitMinCents).toBe(UNCAPPED_FROM_CENTS)
    expect(parseCouponQuery({ limiteMin: '100000' }).limitMinCents).toBe(UNCAPPED_FROM_CENTS)
    expect(parseCouponQuery({ limiteMin: '99999' }).limitMinCents).toBe(9999900)
  })

  test('text is trimmed, stripped of NUL and capped', () => {
    expect(parseCouponQuery({ q: '  loja x  ' }).text).toBe('loja x')
    expect(parseCouponQuery({ q: 'a\0b' }).text).toBe('ab')
    expect(parseCouponQuery({ q: 'a'.repeat(SEARCH_TEXT_MAX + 20) }).text).toHaveLength(SEARCH_TEXT_MAX)
    expect(parseCouponQuery({ q: '\0' }).text).toBeUndefined()
  })

  test('the default sort is not written and other sorts are', () => {
    expect(couponHref(none, { order: 'desconto' })).toBe('/cupons')
    expect(couponHref(none, { order: 'vence' })).toBe('/cupons?ordem=vence')
  })

  test('changing the sort or a new filter resets the page', () => {
    const on = parseCouponQuery({ status: 'ativo', pagina: '4' })
    expect(couponHref(on, { order: 'limite' })).toBe('/cupons?status=ativo&ordem=limite')
    expect(couponHref(on, { discountMin: 20 })).toBe('/cupons?status=ativo&descontoMin=20')
  })

  test('hasCouponFilters ignores the sort and the page', () => {
    expect(hasCouponFilters(parseCouponQuery({ ordem: 'limite', pagina: '2' }))).toBe(false)
    expect(hasCouponFilters(parseCouponQuery({ q: 'x' }))).toBe(true)
  })

  test('an old link with the removed linked-offers filter lists every coupon', () => {
    expect(parseCouponQuery({ comOfertas: '1' })).toEqual(none)
  })

  test('clearing keeps the sort and drops every filter', () => {
    const on = parseCouponQuery({ status: 'ativo', minimoMax: '50', q: 'x', ordem: 'vence' })
    expect(couponHref(on, CLEARED_COUPON_FILTERS)).toBe('/cupons?ordem=vence')
  })

  test.each<[string, Partial<CouponQuery>]>([
    ['minimoMax', { minimumMaxCents: 1999 }],
    ['limiteMin', { limitMinCents: 500 }],
    ['descontoMin', { discountMin: 40 }],
    ['q', { text: 'loja & cia' }],
    ...COUPON_SORTS.map((order): [string, Partial<CouponQuery>] => [`ordem ${order}`, { order }]),
  ])('round-trips %s', (_name, changes) => {
    const params = Object.fromEntries(new URL(couponHref(none, changes), 'http://x').searchParams)
    expect(parseCouponQuery(params)).toEqual({ ...none, ...changes })
  })
})

describe('couponHref', () => {
  test('no filters is the bare route', () => {
    expect(couponHref(none)).toBe(ROUTES.coupons)
  })

  test('toggling a chip off removes its param', () => {
    const on = parseCouponQuery({ status: 'ativo', tipo: 'fixed' })
    expect(couponHref(on, { status: undefined })).toBe('/cupons?tipo=fixed')
  })

  test('other filters are preserved when one changes', () => {
    const on = parseCouponQuery({ status: 'ativo', vence: '7' })
    expect(couponHref(on, { scope: 'store' })).toBe('/cupons?status=ativo&escopo=loja&vence=7')
  })

  test('a filter change resets the page', () => {
    const on = parseCouponQuery({ status: 'ativo', pagina: '4' })
    expect(couponHref(on, { kind: 'percent' })).toBe('/cupons?status=ativo&tipo=percent')
  })

  test('paging keeps the filters and omits page 1', () => {
    const on = parseCouponQuery({ status: 'ativo', pagina: '3' })
    expect(couponHref(on, { page: 4 })).toBe('/cupons?status=ativo&pagina=4')
    expect(couponHref(on, { page: 1 })).toBe('/cupons?status=ativo')
  })

  test('unknown keys and repeated params never reach the link', () => {
    const dirty = parseCouponQuery({ tipo: ['percent', 'fixed'], foo: 'bar', status: 'ativo' })
    expect(couponHref(dirty)).toBe('/cupons?status=ativo')
    expect(couponHref(dirty, { scope: 'ml' })).toBe('/cupons?status=ativo&escopo=ml')
  })

  test.each([
    ...COUPON_LIST_STATUSES.map((status) => [`status ${STATUS_PARAM[status]}`, { status }] as const),
    ...COUPON_SCOPES.map((scope) => [`escopo ${SCOPE_PARAM[scope]}`, { scope }] as const),
    ...FILTERABLE_KINDS.map((kind) => [`tipo ${kind}`, { kind }] as const),
  ])('round-trips %s', (_name, changes) => {
    const href = couponHref(none, changes)
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams)
    expect(parseCouponQuery(params)).toEqual({ ...none, ...changes })
  })
})

test('a NUL in the Cupons q is dropped, and a q of only NUL is no text filter', () => {
  expect(parseCouponQuery({ q: 'fone\u0000 jbl' }).text).toBe('fone jbl')
  expect(parseCouponQuery({ q: '\u0000' }).text).toBeUndefined()
})
