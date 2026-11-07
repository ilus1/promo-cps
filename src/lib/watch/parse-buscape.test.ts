import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buscapeProductUrl, buscapeSearchUrl, parseBuscapeProduct, parseBuscapeSearch } from './parse-buscape'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const SEARCH = fixture('buscape-search.html')
const PRODUCT = fixture('buscape-product.html')
const JBL_REF = 'fone-de-ouvido-e-headset/headphone-bluetooth-com-microfone-jbl-tune-520bt'
const JBL_URL = `https://www.buscape.com.br/${JBL_REF}`
const PRODUCT_NAME = 'Fone de Ouvido JBL Tune 520BT Preto'
const EMPTY_PAGE = '<html><body><h1>Ooops......... não encontramos resultados para sua busca</h1></body></html>'

function card(href: string, name: string, price: string): string {
  return `<a href="${href}" data-testid="product-card::card"><h2 data-testid="product-card::name">${name}</h2>`
    + `<div data-testid="product-card::price"><strong>${price}</strong></div></a>`
}

function productPage(offers: Record<string, unknown> | null, canonical: string | null = JBL_URL): string {
  const link = canonical === null ? '' : `<link rel="canonical" href="${canonical}"/>`
  const data = offers === null ? '' : `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { initialReduxState: { offers } } })}</script>`
  return `<html><head>${link}</head><body>${data}</body></html>`
}

const offer = (sellerName: unknown, price: unknown, name = 'JBL Tune 520BT') => ({ sellerName, price, name })

function quotesOf(html: string, productName?: string) {
  const page = parseBuscapeProduct(200, html, productName)
  if (page.kind !== 'ok') throw new Error(page.reason)
  return page.value
}

describe('buscape urls', () => {
  it('builds the search and product urls', () => {
    expect(buscapeSearchUrl('  jbl   tune 520bt ')).toBe('https://www.buscape.com.br/search?q=jbl+tune+520bt')
    expect(buscapeSearchUrl('fone & cia')).toBe('https://www.buscape.com.br/search?q=fone+%26+cia')
    expect(buscapeProductUrl(JBL_REF)).toBe(JBL_URL)
  })
})

describe('parseBuscapeSearch on the probe capture', () => {
  const page = parseBuscapeSearch(200, SEARCH)

  it('reads one candidate per product card and skips the offer cards', () => {
    expect(page.kind === 'ok' && page.value.map((candidate) => candidate.ref)).toEqual([
      JBL_REF,
      'fone-de-ouvido-e-headset/headset-bluetooth-com-microfone-jbl-tune-780nc-dobravel',
      'fone-de-ouvido-e-headset/fone-de-ouvido-com-microfone-jbl-tune-310c',
      'fone-de-ouvido-e-headset/fone-de-ouvido-bluetooth-jbl-tune-225-tws',
      'fone-de-ouvido-e-headset/fone-de-ouvido-bluetooth-com-microfone-jbl-tune-flex-2-gerenciamento-de-chamadas',
      'fone-de-ouvido-e-headset/fone-de-ouvido-bluetooth-com-microfone-jbl-tune-buds-2-jbltbuds2blk',
      'fone-de-ouvido-e-headset/headphone-bluetooth-com-microfone-jbl-tune-500bt',
      'fone-de-ouvido-e-headset/headphone-bluetooth-com-microfone-jbl-510bt-gerenciamento-de-chamadas',
      'fone-de-ouvido-e-headset/fone-de-ouvido-bluetooth-com-microfone-jbl-tune-125bt-gerenciamento-chamadas',
      'fone-de-ouvido-e-headset/jbl-fone-de-ouvido-over-ear-tune-720bt-bluetooth-cabo-removivel-branco',
    ])
  })

  it('maps a card to a candidate with a canonical url and no merchant', () => {
    expect(page.kind === 'ok' && page.value[0]).toEqual({
      retailer: 'buscape',
      ref: JBL_REF,
      url: JBL_URL,
      title: 'Headphone Bluetooth com Microfone JBL Tune 520BT',
      ean: null,
      merchant: null,
      priceCents: 20_713,
      listPriceCents: null,
      inStock: true,
    })
  })
})

describe('parseBuscapeSearch rules', () => {
  it('reads absolute product links and cleans the title', () => {
    const html = card(`https://www.buscape.com.br/${JBL_REF}?_lc=88&amp;searchterm=jbl`, 'JBL &amp; <b>Tune</b>&#0; \u0000 520BT', 'R$ 1.207,13')
    expect(parseBuscapeSearch(200, html)).toEqual({
      kind: 'ok',
      value: [expect.objectContaining({ ref: JBL_REF, url: JBL_URL, title: 'JBL & Tune 520BT', priceCents: 120_713 })],
    })
  })

  it('gives no candidate when every card is an offer', () => {
    expect(parseBuscapeSearch(200, card('https://www.buscape.com.br/lead?oid=1', 'Fone JBL', 'R$ 339,00'))).toEqual({ kind: 'ok', value: [] })
  })

  it('skips an unreadable card next to a readable one', () => {
    const html = `${card(`/${JBL_REF}`, 'Fone JBL', 'sem preço')}${card(`/${JBL_REF}`, 'Fone JBL', 'R$ 207,13')}`
    expect(parseBuscapeSearch(200, html)).toEqual({ kind: 'ok', value: [expect.objectContaining({ priceCents: 20_713 })] })
  })
})

describe('parseBuscapeSearch failures', () => {
  it('reports a search without results as empty', () => {
    expect(parseBuscapeSearch(200, EMPTY_PAGE)).toEqual({ kind: 'empty', reason: 'nenhum resultado' })
  })

  it('reports a page without cards or with unreadable cards as unknown', () => {
    expect(parseBuscapeSearch(200, '<html><body>Buscapé</body></html>')).toEqual({ kind: 'unknown', reason: 'página desconhecida' })
    expect(parseBuscapeSearch(200, card(`/${JBL_REF}`, '', 'R$ 207,13'))).toEqual({ kind: 'unknown', reason: 'cards ilegíveis' })
  })

  it('reports a wall and a missing page', () => {
    expect(parseBuscapeSearch(403, SEARCH)).toEqual({ kind: 'wall', reason: 'HTTP 403' })
    expect(parseBuscapeSearch(503, SEARCH)).toEqual({ kind: 'wall', reason: 'HTTP 503' })
    expect(parseBuscapeSearch(404, SEARCH)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
  })
})

describe('parseBuscapeProduct on the probe capture', () => {
  const WANT_IMPORT = {
    ref: JBL_REF, merchant: 'Want Import', title: 'JBL Tune 520BT - Preto',
    priceCents: 20_713, listPriceCents: null, finalCents: 20_713, inStock: true,
  }

  it('drops the KaBuM! and Amazon offers, which are read directly', () => {
    expect(parseBuscapeProduct(200, PRODUCT)).toEqual({ kind: 'ok', value: [WANT_IMPORT] })
  })

  it('keeps the offers whose own title is the watched product', () => {
    expect(parseBuscapeProduct(200, PRODUCT, PRODUCT_NAME)).toEqual({ kind: 'ok', value: [WANT_IMPORT] })
  })

  it('reports a page whose offers are another color or product as empty, with the page title', () => {
    const empty = { kind: 'empty', reason: 'nenhuma oferta do produto', title: 'Headphone Bluetooth com Microfone JBL Tune 520BT' }
    expect(parseBuscapeProduct(200, PRODUCT, 'Fone de Ouvido JBL Tune 520BT Azul')).toEqual(empty)
    expect(parseBuscapeProduct(200, PRODUCT, 'Fone de Ouvido Sony WH-CH520 Preto')).toEqual(empty)
  })
})

describe('parseBuscapeProduct rules', () => {
  it('prefers the full offer list and falls back to the displayed offers', () => {
    expect(quotesOf(productPage({ offerList: [offer('Magazine Luiza', 305.1)], displayOffers: [offer('Casas Bahia', 339)] }))
      .map((quote) => quote.merchant)).toEqual(['Magazine Luiza'])
    expect(quotesOf(productPage({ offerList: [], displayOffers: [offer('Casas Bahia', 339)] }))
      .map((quote) => quote.merchant)).toEqual(['Casas Bahia'])
  })

  it('merges merchants that differ only by case or accents', () => {
    const quotes = quotesOf(productPage({ offerList: [offer('Buscapé Loja', 300), offer('BUSCAPE LOJA', 290), offer('buscape loja', 310)] }))
    expect(quotes).toEqual([expect.objectContaining({ merchant: 'BUSCAPE LOJA', priceCents: 29_000 })])
  })

  it('skips offers without merchant or price and keeps a quote without a name', () => {
    const quotes = quotesOf(productPage({ offerList: [offer('', 100), offer(null, 100), offer('Loja', 0), offer('Loja', '100'), { sellerName: 'Outra', price: 99.9 }] }))
    expect(quotes).toEqual([{ ref: JBL_REF, merchant: 'Outra', title: null, priceCents: 9_990, listPriceCents: null, finalCents: 9_990, inStock: true }])
  })

  it('takes the ref from the canonical link', () => {
    expect(quotesOf(productPage({ offerList: [offer('Loja', 100)] }, `${JBL_URL}?_lc=88`))[0].ref).toBe(JBL_REF)
  })
})

describe('parseBuscapeProduct for a watched product', () => {
  const page = productPage({
    offerList: [
      offer('Magazine Luiza', 199.9, 'Fone de Ouvido JBL Tune 520BT Branco'),
      offer('Magazine Luiza', 249.9, 'Fone de Ouvido JBL Tune 520BT Preto'),
      offer('Casas Bahia', 219.9, 'Fone de Ouvido JBL Tune 520BT'),
      offer('Casas Bahia', 189.9, 'Capa para Fone JBL Tune 520BT'),
      { sellerName: 'Fast Shop', price: 179.9 },
    ],
  })

  it('picks each merchant cheapest offer among those of the product', () => {
    expect(quotesOf(page, PRODUCT_NAME)).toEqual([
      expect.objectContaining({ merchant: 'Magazine Luiza', title: 'Fone de Ouvido JBL Tune 520BT Preto', priceCents: 24_990 }),
      expect.objectContaining({ merchant: 'Casas Bahia', title: 'Fone de Ouvido JBL Tune 520BT', priceCents: 21_990 }),
    ])
  })

  it('keeps every offer without a product name', () => {
    expect(quotesOf(page).map((quote) => [quote.merchant, quote.priceCents])).toEqual([
      ['Magazine Luiza', 19_990], ['Casas Bahia', 18_990], ['Fast Shop', 17_990],
    ])
  })
})

describe('parseBuscapeProduct and the stores read directly', () => {
  it.each([
    'KaBuM!', 'Kabum', 'KABUM', 'Amazon', 'AMAZON', 'Mercado Livre', 'MercadoLivre', 'mercado-livre', 'Americanas', 'Américanas',
  ])('drops %s', (merchant) => {
    expect(quotesOf(productPage({ offerList: [offer(merchant, 100), offer('Magazine Luiza', 200)] })).map((quote) => quote.merchant))
      .toEqual(['Magazine Luiza'])
  })

  it('reports a page with only those stores as empty', () => {
    const page = productPage({ offerList: [offer('KaBuM!', 100), offer('Amazon', 200), offer('Mercado Livre', 300), offer('Americanas', 400)] })
    expect(parseBuscapeProduct(200, page)).toEqual({ kind: 'empty', reason: 'só ofertas de lojas lidas direto', title: 'JBL Tune 520BT' })
  })

  it('names an empty page by its title, without the Buscapé suffix, else by its first offer', () => {
    const page = productPage({ offerList: [offer('KaBuM!', 100, 'Fone JBL Tune 520BT Preto')] })
    const titled = page.replace('<head>', '<head><title>Fone de Ouvido JBL Tune 520BT em Promoção é no Buscapé</title>')
    expect(parseBuscapeProduct(200, titled)).toMatchObject({ kind: 'empty', title: 'Fone de Ouvido JBL Tune 520BT' })
    expect(parseBuscapeProduct(200, page)).toMatchObject({ kind: 'empty', title: 'Fone JBL Tune 520BT Preto' })
  })

  it('keeps a store whose name only resembles one of them', () => {
    expect(quotesOf(productPage({ offerList: [offer('Amazon Imports', 100)] })).map((quote) => quote.merchant)).toEqual(['Amazon Imports'])
  })
})

describe('parseBuscapeProduct failures', () => {
  it('reports a product without offers as empty', () => {
    expect(parseBuscapeProduct(200, productPage({ offerList: [], displayOffers: [] }))).toEqual({ kind: 'empty', reason: 'sem ofertas' })
    expect(parseBuscapeProduct(200, productPage({ offerList: [offer('Loja', 0)] }))).toEqual({ kind: 'empty', reason: 'sem ofertas' })
  })

  it('reports a page that is not a product as unknown', () => {
    expect(parseBuscapeProduct(200, productPage({ offerList: [] }, null))).toEqual({ kind: 'unknown', reason: 'sem produto' })
    expect(parseBuscapeProduct(200, productPage({ offerList: [] }, 'https://www.buscape.com.br/fone-de-ouvido-e-headset')))
      .toEqual({ kind: 'unknown', reason: 'sem produto' })
    expect(parseBuscapeProduct(200, productPage(null))).toEqual({ kind: 'unknown', reason: 'sem __NEXT_DATA__' })
  })

  it('reports a wall and a missing page', () => {
    expect(parseBuscapeProduct(403, PRODUCT, PRODUCT_NAME)).toEqual({ kind: 'wall', reason: 'HTTP 403' })
    expect(parseBuscapeProduct(404, PRODUCT, PRODUCT_NAME)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
  })
})
