import { describe, expect, it } from 'vitest'
import { statusFailure, storableOffers } from './pages'
import type { MarketOffer } from './types'

const MAX_INT4 = 2_147_483_647
const OFFER: MarketOffer = {
  retailer: 'kabum',
  listingId: '123',
  title: 'Fone JBL Tune 520BT',
  brand: 'JBL',
  seller: 'KaBuM!',
  priceCents: 26_991,
  listPriceCents: 39_990,
  regularPriceCents: null,
  priceUntil: null,
  inStock: true,
  url: 'https://www.kabum.com.br/produto/123',
  source: 'kabum_catalog',
}

describe('storableOffers', () => {
  it('strips NUL from the texts, and empties brand and seller made only of it', () => {
    const [offer] = storableOffers([{ ...OFFER, title: 'Fone\u0000 JBL', brand: '\u0000', seller: 'Ka\u0000BuM!', url: 'https://www.kabum.com.br/produto/\u0000123' }])
    expect(offer).toMatchObject({ title: 'Fone JBL', brand: null, seller: 'KaBuM!', url: 'https://www.kabum.com.br/produto/123' })
  })
  it('drops an offer whose title or URL is only NUL', () => {
    expect(storableOffers([{ ...OFFER, title: '\u0000\u0000' }, { ...OFFER, listingId: '2', url: '\u0000' }])).toEqual([])
  })
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_INT4 + 1])('drops a price of %s', (cents) => {
    expect(storableOffers([{ ...OFFER, priceCents: cents }])).toEqual([])
    expect(storableOffers([{ ...OFFER, listPriceCents: cents }])).toEqual([])
    expect(storableOffers([{ ...OFFER, regularPriceCents: cents }])).toEqual([])
  })
  it('keeps prices from 1 to the int4 maximum, and null list and regular prices', () => {
    expect(storableOffers([{ ...OFFER, priceCents: 1, listPriceCents: MAX_INT4, regularPriceCents: MAX_INT4 }])).toHaveLength(1)
    expect(storableOffers([{ ...OFFER, listPriceCents: null, regularPriceCents: null }])).toHaveLength(1)
  })
  it('drops an offer with an invalid campaign end, and keeps a valid one', () => {
    expect(storableOffers([{ ...OFFER, regularPriceCents: 29_990, priceUntil: new Date(Number.NaN) }])).toEqual([])
    expect(storableOffers([{ ...OFFER, regularPriceCents: 29_990, priceUntil: new Date('2026-11-24T12:00:00Z') }])).toHaveLength(1)
  })
  it('skips nulls and keeps the first storable offer of a listing', () => {
    const offers = storableOffers([null, { ...OFFER, priceCents: 0 }, { ...OFFER, title: 'Primeiro' }, { ...OFFER, title: 'Segundo' }])
    expect(offers.map((offer) => offer.title)).toEqual(['Primeiro'])
  })
})

describe('statusFailure', () => {
  it('passes 200 and classifies the rest', () => {
    expect(statusFailure(200)).toBeNull()
    expect(statusFailure(404)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
    expect(statusFailure(429)).toEqual({ kind: 'wall', reason: 'HTTP 429' })
    expect(statusFailure(502)).toEqual({ kind: 'unknown', reason: 'HTTP 502' })
    expect(statusFailure(0)).toEqual({ kind: 'unknown', reason: 'sem resposta' })
  })
})
