import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/coupons-page.json'
import {
  ACTIVATION_EU_QUERO, COUPON_PAGE_BAD_COUNT, COUPON_PAGE_WITHOUT_DATA, COUPON_STATUS_ACTIVE, COUPON_STATUS_INACTIVE,
  compareStrength, equivalentPercent, parseCoupon, parseCouponPage, STORE_SCOPE_PREFIX, storeName, tryParseCouponPage,
  type ParsedCoupon,
} from './coupons'

const COUNTS = { pagination: { page: 2, total: 65 }, totalCouponsQuantity: { number: 1926 } }

const base: ParsedCoupon = {
  campaignId: '1', title: '10% OFF', kind: 'percent', percentOff: 10, amountOffCents: null,
  minPaymentCents: 8500, capCents: 5000, scopeLabel: 'Em produtos selecionados', isStore: false,
  status: COUPON_STATUS_INACTIVE, activationType: ACTIVATION_EU_QUERO, activateCode: 'c', listingUrl: null,
  startsAt: null, expiresAt: null,
}

describe('parseCouponPage', () => {
  it('reads coupons, page number, page count and total', () => {
    const page = parseCouponPage(fixture)
    expect(page.coupons.length).toBe(3)
    expect(page.pageNumber).toBe(1)
    expect(page.totalPages).toBe(65)
    expect(page.totalCoupons).toBe(1926)
    expect(page.skipped).toBe(0)
  })
  it('reads the page number ML reports', () => {
    expect(parseCouponPage({ filteredCouponsData: { ...COUNTS, rawCoupons: [] } }).pageNumber).toBe(2)
  })
  it('counts entries without campaign_id as skipped', () => {
    const page = parseCouponPage({ filteredCouponsData: { ...COUNTS, rawCoupons: [{}, { campaign_id: '' }, { campaign_id: '9' }] } })
    expect(page.coupons.map(({ parsed }) => parsed.campaignId)).toEqual(['9'])
    expect(page.skipped).toBe(2)
  })
  it('counts null and non-object entries as skipped', () => {
    const page = parseCouponPage({ filteredCouponsData: { ...COUNTS, rawCoupons: [null, 'x', 5, { campaign_id: '9' }] } })
    expect(page.coupons.map(({ parsed }) => parsed.campaignId)).toEqual(['9'])
    expect(page.skipped).toBe(3)
  })
  it.each([
    ['missing', {}],
    ['null', { filteredCouponsData: null }],
    ['a string', { filteredCouponsData: 'x' }],
    ['without rawCoupons', { filteredCouponsData: {} }],
    ['with rawCoupons not an array', { filteredCouponsData: { rawCoupons: {} } }],
  ])('throws when filteredCouponsData is %s', (_, pageProps) => {
    expect(() => parseCouponPage(pageProps)).toThrow(COUPON_PAGE_WITHOUT_DATA)
  })
  it.each([
    ['pagination.page missing', { pagination: { total: 65 }, totalCouponsQuantity: { number: 1 } }, 'pagination.page'],
    ['pagination missing', { totalCouponsQuantity: { number: 1 } }, 'pagination.page'],
    ['pagination.total a string', { pagination: { page: 1, total: '65' }, totalCouponsQuantity: { number: 1 } }, 'pagination.total'],
    ['pagination.total negative', { pagination: { page: 1, total: -1 }, totalCouponsQuantity: { number: 1 } }, 'pagination.total'],
    ['pagination.page fractional', { pagination: { page: 1.5, total: 65 }, totalCouponsQuantity: { number: 1 } }, 'pagination.page'],
    ['the total missing', { pagination: { page: 1, total: 65 } }, 'totalCouponsQuantity.number'],
    ['the total infinite', { pagination: { page: 1, total: 65 }, totalCouponsQuantity: { number: Infinity } }, 'totalCouponsQuantity.number'],
  ])('throws when %s', (_, counts, field) => {
    expect(() => parseCouponPage({ filteredCouponsData: { ...counts, rawCoupons: [] } }))
      .toThrow(`${COUPON_PAGE_BAD_COUNT}: ${field}`)
  })
})

describe('tryParseCouponPage', () => {
  it('returns the parsed page', () => {
    const parse = tryParseCouponPage(fixture)
    expect(parse.ok && parse.page.coupons.length).toBe(3)
  })
  it('returns the parse error instead of throwing', () => {
    expect(tryParseCouponPage({})).toEqual({ ok: false, error: COUPON_PAGE_WITHOUT_DATA })
  })
})

describe('parseCoupon', () => {
  it('percent coupon with min and cap', () => {
    expect(parseCoupon({
      campaign_id: '13305789',
      title: { text: '10% OFF Maquininhas', accessibility: { title: { fractional_amount: '10', decimal_amount: '0' } } },
      initial_subtitle: { text: 'Em produtos selecionados' },
      amount: { accessibility: { min_amount: { fractional_amount: '85', decimal_amount: '0' }, cap_amount: { fractional_amount: '50', decimal_amount: '0' } } },
      status: { id: COUPON_STATUS_INACTIVE }, activation_type: ACTIVATION_EU_QUERO, code: 'abc',
      action: { type: 'button', text: 'Aplicar' },
      future_coupon_info: { start_date: '2026-07-06T17:03Z', expiration_date: '2027-01-01T02:59Z' },
    })).toMatchObject({
      kind: 'percent', percentOff: 10, minPaymentCents: 8500, capCents: 5000, isStore: false,
      status: COUPON_STATUS_INACTIVE, listingUrl: null, expiresAt: new Date('2027-01-01T02:59Z'),
    })
  })
  it('fixed store coupon with listing link', () => {
    expect(parseCoupon({
      campaign_id: '14569078',
      title: { text: 'R$ 600 OFF em Informática', accessibility: { title: { fractional_amount: '600', decimal_amount: '0' } } },
      initial_subtitle: { text: 'Em produtos de Sonhosreborn' },
      status: { id: COUPON_STATUS_ACTIVE }, activation_type: 'AUTOMATIC',
      action: { type: 'link', value: 'https://lista.mercadolivre.com.br/pagina/renascer/?coupon_campaign_id=14569078' },
    })).toMatchObject({ kind: 'fixed', amountOffCents: 60000, isStore: true, listingUrl: expect.stringContaining('/pagina/renascer/') })
  })
  it('unparsed title and foreign link', () => {
    expect(parseCoupon({
      campaign_id: '9', title: { text: 'Frete grátis' },
      action: { type: 'link', value: 'https://evil.com/x' },
    })).toMatchObject({ kind: 'unparsed', listingUrl: null })
  })
  it.each([
    [' R$ 50 OFF acima de 10% ', 'fixed'],
    ['10% OFF até R$ 50', 'percent'],
    ['Até R$ 50 OFF', 'unparsed'],
  ])('kind of %s is %s', (text, kind) => {
    expect(parseCoupon({
      campaign_id: '9', title: { text, accessibility: { title: { fractional_amount: '50', decimal_amount: '0' } } },
    }).kind).toBe(kind)
  })
  it('blank activation code is null', () => {
    expect(parseCoupon({ campaign_id: '9', code: '  ' }).activateCode).toBeNull()
  })
  it.each([
    'http://lista.mercadolivre.com.br/x',
    'https://mercadolivre.com.br.evil.com/x',
    'https://user:pw@lista.mercadolivre.com.br/x',
  ])('unsafe link %s gives no listing url', (value) => {
    expect(parseCoupon({ campaign_id: '9', action: { type: 'link', value } }).listingUrl).toBeNull()
  })
})

describe('strength', () => {
  it('fixed coupon equivalent percent, capped at 100', () => {
    expect(equivalentPercent({ ...base, kind: 'fixed', percentOff: null, amountOffCents: 60000, minPaymentCents: 499900 })).toBeCloseTo(12.0, 1)
    expect(equivalentPercent({ ...base, kind: 'fixed', percentOff: null, amountOffCents: 5000, minPaymentCents: 100 })).toBe(100)
  })
  it('unknown when unparsed or no minimum', () => {
    expect(equivalentPercent({ ...base, kind: 'unparsed' })).toBeNull()
    expect(equivalentPercent({ ...base, kind: 'fixed', amountOffCents: 100, minPaymentCents: 0 })).toBeNull()
  })
  it('ML coupons first, then by equivalent percent, unknown last', () => {
    const ml10 = { ...base, campaignId: 'a' }
    const ml30 = { ...base, campaignId: 'b', percentOff: 30 }
    const store50 = { ...base, campaignId: 'c', percentOff: 50, isStore: true }
    const mlUnknown = { ...base, campaignId: 'd', kind: 'unparsed' as const }
    const sorted = [store50, mlUnknown, ml10, ml30].sort(compareStrength).map((c) => c.campaignId)
    expect(sorted).toEqual(['b', 'a', 'd', 'c'])
  })
  it('equal strength keeps input order', () => {
    const percent50 = { ...base, campaignId: 'a', percentOff: 50 }
    const fixed50 = { ...base, campaignId: 'b', kind: 'fixed' as const, percentOff: null, amountOffCents: 5000, minPaymentCents: 10000 }
    const unknownC = { ...base, campaignId: 'c', kind: 'unparsed' as const }
    const unknownD = { ...base, campaignId: 'd', kind: 'unparsed' as const }
    expect([percent50, fixed50, unknownC, unknownD].sort(compareStrength).map((c) => c.campaignId)).toEqual(['a', 'b', 'c', 'd'])
    expect([fixed50, percent50, unknownD, unknownC].sort(compareStrength).map((c) => c.campaignId)).toEqual(['b', 'a', 'd', 'c'])
  })
})

describe('fixture coupons', () => {
  const [inactive, store, mlWide] = parseCouponPage(fixture).coupons

  it('inactive EU_QUERO percent coupon with a one-digit decimal minimum, cap and dates', () => {
    expect(inactive.parsed).toMatchObject({
      kind: 'percent', percentOff: 20, minPaymentCents: 19990, capCents: 14500, isStore: false,
      listingUrl: null, status: COUPON_STATUS_INACTIVE, activationType: ACTIVATION_EU_QUERO,
      startsAt: new Date('2026-10-22T12:30Z'), expiresAt: new Date('2026-12-01T02:59Z'),
    })
  })
  it('active store coupon with a store link and dates', () => {
    expect(store.parsed).toMatchObject({
      kind: 'percent', percentOff: 15, minPaymentCents: 12000, capCents: 5000, isStore: true,
      listingUrl: store.raw.action?.value, status: COUPON_STATUS_ACTIVE,
      startsAt: new Date('2026-10-31T03:00Z'), expiresAt: new Date('2026-11-03T02:59:59Z'),
    })
  })
  it('active ML-wide fixed coupon with a thousands cap and no activation code', () => {
    expect(mlWide.parsed).toMatchObject({
      kind: 'fixed', amountOffCents: 20000, minPaymentCents: 40000, capCents: 1000000, isStore: false,
      listingUrl: mlWide.raw.action?.value, status: COUPON_STATUS_ACTIVE, activateCode: null,
      expiresAt: new Date('2027-01-01T02:59Z'),
    })
  })
})

describe('storeName', () => {
  it('the bare store name after the scope prefix', () => {
    expect(storeName(`${STORE_SCOPE_PREFIX}Toputilidadesshop`)).toBe('Toputilidadesshop')
  })
  it('nothing for a non-store scope or a missing label', () => {
    expect(storeName('Em produtos selecionados')).toBeUndefined()
    expect(storeName(null)).toBeUndefined()
  })
})
