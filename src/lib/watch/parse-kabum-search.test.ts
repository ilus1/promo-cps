import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kabumSearchUrl, parseKabumSearch } from './parse-kabum-search'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const SEARCH = fixture('kabum-search.html')
const NOW = new Date('2026-11-06T12:00:00Z')
const BEFORE_CAMPAIGN = new Date('2026-11-06T00:00:00Z')
const CAMPAIGN_CODE = '1004896'

function page(data: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data } } })}</script></body></html>`
}

function candidatesOf(html: string, now: Date = NOW) {
  const parsed = parseKabumSearch(200, html, now)
  if (parsed.kind !== 'ok') throw new Error(parsed.reason)
  return parsed.value
}

describe('kabumSearchUrl', () => {
  it('joins the words with hyphens', () => {
    expect(kabumSearchUrl('  jbl   tune 520bt ')).toBe('https://www.kabum.com.br/busca/jbl-tune-520bt')
  })

  it('encodes each word', () => {
    expect(kabumSearchUrl('fone/headset ação')).toBe('https://www.kabum.com.br/busca/fone%2Fheadset-a%C3%A7%C3%A3o')
  })
})

describe('parseKabumSearch on the rendered search', () => {
  it('reads all 60 products of the embedded catalogServer', () => {
    expect(candidatesOf(SEARCH)).toHaveLength(60)
  })

  it('maps a product with the Kabum product mapping', () => {
    expect(candidatesOf(SEARCH)[0]).toEqual({
      retailer: 'kabum',
      ref: '474932',
      url: 'https://www.kabum.com.br/produto/474932/fone-de-ouvido-jbl-tune-520bt-bluetooth-ate-57hrs-app-comando-de-voz-azul-jblt520bt',
      title: 'Fone De Ouvido JBL Tune 520bt, Bluetooth, Até 57Hrs, App, Comando De Voz, Azul - Jblt520bt',
      ean: null,
      merchant: 'EFACINI',
      priceCents: 23_940,
      listPriceCents: null,
      inStock: true,
    })
  })

  it('applies an active campaign', () => {
    const during = candidatesOf(SEARCH).find((candidate) => candidate.ref === CAMPAIGN_CODE)
    const before = candidatesOf(SEARCH, BEFORE_CAMPAIGN).find((candidate) => candidate.ref === CAMPAIGN_CODE)
    expect(during).toMatchObject({ priceCents: 19_990, listPriceCents: 34_443 })
    expect(before).toMatchObject({ priceCents: 30_999, listPriceCents: null })
  })
})

describe('parseKabumSearch rules', () => {
  const product = {
    code: 1, name: 'Fone JBL', friendlyName: 'fone-jbl', sellerName: 'KaBuM!', price: 100, priceWithDiscount: 90, available: true,
  }

  it('skips open box products and reads out of stock ones', () => {
    const html = page({ catalogServer: { data: [{ ...product, flags: { isOpenbox: true } }, { ...product, code: 2, available: false }] } })
    expect(candidatesOf(html)).toEqual([expect.objectContaining({ ref: '2', inStock: false, priceCents: 9_000 })])
  })

  it('reads a catalogServer serialized as a string', () => {
    const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { data: JSON.stringify({ catalogServer: { data: [product] } }) } } })}</script>`
    expect(candidatesOf(html).map((candidate) => candidate.ref)).toEqual(['1'])
  })
})

describe('parseKabumSearch failures', () => {
  it('reports a search without products as empty', () => {
    expect(parseKabumSearch(200, page({ catalogServer: { data: [] } }), NOW)).toEqual({ kind: 'empty', reason: 'sem produtos' })
  })

  it('reports the server page, which has no catalogServer, as unknown', () => {
    expect(parseKabumSearch(200, page({ searchTermWithoutHyphen: '6925281963650', type: 'search' }), NOW))
      .toEqual({ kind: 'unknown', reason: 'sem catálogo' })
  })

  it('reports unreadable pages as unknown', () => {
    expect(parseKabumSearch(200, '<html><body>KaBuM!</body></html>', NOW)).toEqual({ kind: 'unknown', reason: 'sem __NEXT_DATA__' })
    expect(parseKabumSearch(200, page({ catalogServer: { data: [{ code: 1 }] } }), NOW)).toEqual({ kind: 'unknown', reason: 'produtos ilegíveis' })
  })

  it('reports a wall and a missing page', () => {
    expect(parseKabumSearch(403, SEARCH, NOW)).toEqual({ kind: 'wall', reason: 'HTTP 403' })
    expect(parseKabumSearch(404, SEARCH, NOW)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
  })
})
