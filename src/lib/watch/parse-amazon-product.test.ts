import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { amazonProductUrl, parseAmazonCandidates, parseAmazonProduct } from './parse-amazon-product'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const SEARCH = fixture('amazon-ean-search.html')
const PRODUCT = fixture('amazon-product.html')
const ASIN = 'B0C3V5X3QT'
const TITLE = 'JBL, Fone de Ouvido On ear, Tune 520BT - Preto'
const CAPTCHA = '<html><body><form action="/errors/validateCaptcha">Digite os caracteres que você vê abaixo</form></body></html>'

const price = (amount: string, extra = '') => `<span class="a-price${extra}"><span class="a-offscreen">${amount}</span></span>`
const struck = (amount: string) => `<span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">${amount}</span></span>`

function productPage(parts: { core?: string; display?: string; availability?: string | null; merchant?: string | null; title?: string | null }): string {
  const core = parts.core === undefined ? '' : `<div id="corePrice_feature_div" class="celwidget" data-feature-name="corePrice">${parts.core}</div>`
  const display = parts.display === undefined ? '' : `<div id="corePriceDisplay_desktop_feature_div" data-feature-name="corePriceDisplay_desktop">${parts.display}</div>`
  const availability = parts.availability === null ? '' : `<div id="availability"><span>${parts.availability ?? 'Em estoque'}</span></div>`
  const merchant = parts.merchant === null ? '' : `<div offer-display-feature-name="desktop-merchant-info"><span class="a-size-small offer-display-feature-text-message">${parts.merchant ?? 'Amazon.com.br'}</span></div>`
  const title = parts.title === null ? '' : `<span id="productTitle" class="a-size-large">${parts.title ?? TITLE}</span>`
  return `<html><body>${core}<div data-feature-name="next">${display}</div>${availability}${merchant}${title}</body></html>`
}

function quoteOf(html: string) {
  const page = parseAmazonProduct(200, html, ASIN)
  if (page.kind !== 'ok') throw new Error(page.reason)
  return page.value
}

describe('amazonProductUrl', () => {
  it('builds the detail page url', () => {
    expect(amazonProductUrl(ASIN)).toBe('https://www.amazon.com.br/dp/B0C3V5X3QT')
  })
})

describe('parseAmazonCandidates', () => {
  it('reads the EAN search result as a candidate without EAN or merchant', () => {
    expect(parseAmazonCandidates(200, SEARCH)).toEqual({
      kind: 'ok',
      value: [{
        retailer: 'amazon',
        ref: ASIN,
        url: 'https://www.amazon.com.br/dp/B0C3V5X3QT',
        title: TITLE,
        ean: null,
        merchant: null,
        priceCents: 18_922,
        listPriceCents: 19_997,
        inStock: true,
      }],
    })
  })

  it('applies the market wall rules', () => {
    expect(parseAmazonCandidates(200, CAPTCHA)).toEqual({ kind: 'wall', reason: 'captcha' })
    expect(parseAmazonCandidates(503, SEARCH)).toEqual({ kind: 'wall', reason: 'HTTP 503' })
    expect(parseAmazonCandidates(200, '<html><body>Desculpe, algo deu errado</body></html>')).toEqual({ kind: 'wall', reason: 'página de erro' })
  })

  it('reports an empty search, a missing page and an unknown page', () => {
    expect(parseAmazonCandidates(200, '<html><body>Nenhum resultado para 7890000000000</body></html>')).toEqual({ kind: 'empty', reason: 'nenhum resultado' })
    expect(parseAmazonCandidates(404, SEARCH)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
    expect(parseAmazonCandidates(200, '<html><body>outra página</body></html>')).toEqual({ kind: 'unknown', reason: 'página desconhecida' })
  })
})

describe('parseAmazonProduct on the probe capture', () => {
  it('reads the core price, the stock and the seller', () => {
    expect(parseAmazonProduct(200, PRODUCT, ASIN)).toEqual({
      kind: 'ok',
      value: {
        ref: ASIN,
        merchant: 'CENTERSHOPSBC',
        title: TITLE,
        priceCents: 18_922,
        listPriceCents: null,
        finalCents: 18_922,
        inStock: true,
      },
    })
  })
})

describe('parseAmazonProduct rules', () => {
  it('reads a struck list price above the price', () => {
    expect(quoteOf(productPage({ core: `${price('R$&nbsp;189,22')}${struck('R$&nbsp;249,90')}` }))).toMatchObject({
      priceCents: 18_922, listPriceCents: 24_990, finalCents: 18_922, merchant: 'Amazon.com.br',
    })
  })

  it('drops a struck price that is not above the price', () => {
    expect(quoteOf(productPage({ core: `${price('R$ 189,22')}${struck('R$ 150,00')}` })).listPriceCents).toBeNull()
  })

  it('ignores a text price that is not struck', () => {
    expect(quoteOf(productPage({ core: `${price('R$ 33,37', ' a-text-price')}${price('R$ 189,22')}` }))).toMatchObject({
      priceCents: 18_922, listPriceCents: null,
    })
  })

  it('falls back to the desktop price display', () => {
    expect(quoteOf(productPage({ display: price('R$ 1.299,00') })).priceCents).toBe(129_900)
  })

  it('skips a core area whose price is blank', () => {
    expect(quoteOf(productPage({ core: price(' '), display: price('R$ 199,90') })).priceCents).toBe(19_990)
  })

  it('reads a priced item that is not in stock', () => {
    expect(quoteOf(productPage({ core: price('R$ 189,22'), availability: 'Disponível para encomenda' })).inStock).toBe(false)
  })

  it('treats a page without availability as in stock and one without seller as unknown seller', () => {
    expect(quoteOf(productPage({ core: price('R$ 189,22'), availability: null, merchant: null }))).toMatchObject({ inStock: true, merchant: null })
  })

  it('cleans the seller', () => {
    expect(quoteOf(productPage({ core: price('R$ 189,22'), merchant: ' Loja &amp; Cia&#0; ' })).merchant).toBe('Loja & Cia')
  })

  it('cleans the title', () => {
    expect(quoteOf(productPage({ core: price('R$ 189,22'), title: '  JBL &amp; <b>Tune</b>&#0; \u0000 520BT ' })).title).toBe('JBL & Tune 520BT')
  })
})

describe('parseAmazonProduct failures', () => {
  it('reports an unavailable item without price as empty', () => {
    expect(parseAmazonProduct(200, productPage({ availability: 'Não disponível.' }), ASIN)).toEqual({ kind: 'empty', reason: 'sem estoque', title: TITLE })
    expect(parseAmazonProduct(200, productPage({ availability: 'Não disponível.', title: null }), ASIN)).toEqual({ kind: 'empty', reason: 'sem estoque' })
  })

  it('reports a page without price or title as unknown', () => {
    expect(parseAmazonProduct(200, productPage({}), ASIN)).toEqual({ kind: 'unknown', reason: 'sem preço', title: TITLE })
    expect(parseAmazonProduct(200, productPage({ core: price('R$ 0,00'), title: null }), ASIN)).toEqual({ kind: 'unknown', reason: 'sem preço' })
    expect(parseAmazonProduct(200, productPage({ core: price('R$ 189,22'), title: null }), ASIN)).toEqual({ kind: 'unknown', reason: 'sem título' })
    expect(parseAmazonProduct(200, productPage({ core: price('R$ 189,22'), title: ' ' }), ASIN)).toEqual({ kind: 'unknown', reason: 'sem título' })
  })

  it('applies the market wall rules', () => {
    expect(parseAmazonProduct(200, CAPTCHA, ASIN)).toEqual({ kind: 'wall', reason: 'captcha' })
    expect(parseAmazonProduct(403, PRODUCT, ASIN)).toEqual({ kind: 'wall', reason: 'HTTP 403' })
    expect(parseAmazonProduct(429, PRODUCT, ASIN)).toEqual({ kind: 'wall', reason: 'HTTP 429' })
  })

  it('reports a missing page and a failed request', () => {
    expect(parseAmazonProduct(404, PRODUCT, ASIN)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
    expect(parseAmazonProduct(0, '', ASIN)).toEqual({ kind: 'unknown', reason: 'sem resposta' })
  })
})
