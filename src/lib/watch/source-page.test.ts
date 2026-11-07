import { describe, expect, it } from 'vitest'
import type { MarketOffer, ParsedPage } from '../market/types'
import { candidateOfOffer, fromMarketPage, quoteOfOffer, sourceFailure, storableHtmlText } from './source-page'

const OFFER: MarketOffer = {
  retailer: 'kabum',
  listingId: '474932',
  title: 'Fone JBL Tune 520BT Azul',
  brand: 'JBL',
  seller: 'EFACINI',
  priceCents: 23_940,
  listPriceCents: 25_200,
  regularPriceCents: null,
  priceUntil: null,
  inStock: false,
  url: 'https://www.kabum.com.br/produto/474932/fone-jbl',
  source: 'kabum_catalog',
}

describe('storableHtmlText', () => {
  it('decodes, strips tags and collapses whitespace', () => {
    expect(storableHtmlText('  JBL &amp; <b>Tune</b>\n 520BT ')).toBe('JBL & Tune 520BT')
  })

  it('removes NUL characters, raw or encoded, without leaving extra spaces', () => {
    expect(storableHtmlText('JBL\u0000 &#0; Tune &#x0;')).toBe('JBL Tune')
  })

  it('replaces lone surrogates', () => {
    expect(storableHtmlText('JBL &#xD800;')).toBe('JBL \uFFFD')
  })
})

describe('sourceFailure', () => {
  it('builds a failed page', () => {
    expect(sourceFailure('wall', 'HTTP 403')).toEqual({ kind: 'wall', reason: 'HTTP 403' })
    expect(sourceFailure('empty', 'sem estoque', 'Fone JBL')).toEqual({ kind: 'empty', reason: 'sem estoque', title: 'Fone JBL' })
    expect(sourceFailure('empty', 'sem estoque', '')).toEqual({ kind: 'empty', reason: 'sem estoque' })
  })
})

describe('fromMarketPage', () => {
  it('maps the offers of a results page', () => {
    const page: ParsedPage<null> = { kind: 'results', offers: [OFFER], extra: null }
    expect(fromMarketPage(page, (offers) => offers.length)).toEqual({ kind: 'ok', value: 1 })
  })

  it.each(['empty', 'wall', 'unknown', 'missing'] as const)('keeps a %s page as a failure', (kind) => {
    expect(fromMarketPage({ kind, reason: 'motivo' }, () => 1)).toEqual({ kind, reason: 'motivo' })
  })
})

describe('market offer mapping', () => {
  it('turns an offer into a candidate without EAN', () => {
    expect(candidateOfOffer(OFFER, 'kabum')).toEqual({
      retailer: 'kabum',
      ref: '474932',
      url: 'https://www.kabum.com.br/produto/474932/fone-jbl',
      title: 'Fone JBL Tune 520BT Azul',
      ean: null,
      merchant: 'EFACINI',
      priceCents: 23_940,
      listPriceCents: 25_200,
      inStock: false,
    })
  })

  it('turns an offer into a quote whose final price is the price', () => {
    expect(quoteOfOffer(OFFER)).toEqual({
      ref: '474932',
      merchant: 'EFACINI',
      title: 'Fone JBL Tune 520BT Azul',
      priceCents: 23_940,
      listPriceCents: 25_200,
      finalCents: 23_940,
      inStock: false,
    })
  })
})
