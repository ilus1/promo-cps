import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kabumProductUrl, parseKabumProduct } from './parse-kabum-product'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const PRODUCT_PAGE = fixture('kabum-product.html')
const NOW = new Date('2026-11-06T12:00:00Z')
const CAMPAIGN_START = 1_793_791_560
const CAMPAIGN_END = 1_795_521_600
const AFTER_CAMPAIGN = new Date(CAMPAIGN_END * 1000)

const PRODUCT = {
  id: 123,
  title: 'Fone JBL Tune 520BT Preto',
  friendlyName: 'fone-jbl-tune-520bt-preto',
  sellerName: 'KaBuM!',
  manufacturer: { name: 'JBL' },
  prices: { oldPrice: 399.9, priceWithDiscount: 269.91, price: 299.9 },
  price: 299.9,
  available: true,
  flags: { isOpenbox: false },
}
const CATALOG_CAMPAIGN = { startsAt: CAMPAIGN_START, endsAt: CAMPAIGN_END, price: 249.9, priceWithDiscount: 224.91 }

function page(pageProps: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></body></html>`
}

function quoteOf(product: unknown, now: Date = NOW) {
  const parsed = parseKabumProduct(200, page({ product }), now)
  if (parsed.kind !== 'ok') throw new Error(parsed.reason)
  return parsed.value
}

describe('kabumProductUrl', () => {
  it('builds the product page url', () => {
    expect(kabumProductUrl('925350')).toBe('https://www.kabum.com.br/produto/925350')
  })
})

describe('parseKabumProduct on the probe capture', () => {
  it('quotes the PIX price and the old price, which already carry the campaign', () => {
    expect(parseKabumProduct(200, PRODUCT_PAGE, NOW)).toEqual({
      kind: 'ok',
      value: {
        ref: '925350',
        merchant: 'KaBuM!',
        title: 'iPhone 17 Pro Apple 512GB, Câmera Tripla Fusion de 48MP, Tela 6.3", Super Retina XDR, Laranja-cósmico',
        priceCents: 849_999,
        listPriceCents: 1_444_333,
        finalCents: 849_999,
        inStock: true,
      },
    })
  })

  it('quotes the same prices after the campaign window, since the page offer has no prices', () => {
    const parsed = parseKabumProduct(200, PRODUCT_PAGE, AFTER_CAMPAIGN)
    expect(parsed.kind === 'ok' && parsed.value.priceCents).toBe(849_999)
  })
})

describe('parseKabumProduct rules', () => {
  it('quotes the PIX price with the old price as list price', () => {
    expect(quoteOf(PRODUCT)).toEqual({
      ref: '123',
      merchant: 'KaBuM!',
      title: 'Fone JBL Tune 520BT Preto',
      priceCents: 26_991,
      listPriceCents: 39_990,
      finalCents: 26_991,
      inStock: true,
    })
  })

  it('applies an active campaign with the market campaign rule', () => {
    expect(quoteOf({ ...PRODUCT, offer: CATALOG_CAMPAIGN })).toMatchObject({ priceCents: 22_491, listPriceCents: 29_990, finalCents: 22_491 })
  })

  it('ignores a campaign outside its window', () => {
    expect(quoteOf({ ...PRODUCT, offer: CATALOG_CAMPAIGN }, AFTER_CAMPAIGN)).toMatchObject({ priceCents: 26_991, listPriceCents: 39_990 })
  })

  it('falls back to the top-level price without a prices object', () => {
    expect(quoteOf({ ...PRODUCT, prices: null })).toMatchObject({ priceCents: 29_990, listPriceCents: null })
  })

  it('quotes an unavailable product that still has a price', () => {
    expect(quoteOf({ ...PRODUCT, available: false }).inStock).toBe(false)
  })
})

describe('parseKabumProduct failures', () => {
  it('reports an unavailable product without price as empty', () => {
    const product = { ...PRODUCT, available: false, prices: { price: 0, priceWithDiscount: 0, oldPrice: 0 }, price: 0 }
    expect(parseKabumProduct(200, page({ product }), NOW)).toEqual({ kind: 'empty', reason: 'sem estoque', title: PRODUCT.title })
  })

  it('reports an unreadable or open box product as unknown, keeping a title it can read', () => {
    const unreadable = { kind: 'unknown', reason: 'produto ilegível' }
    expect(parseKabumProduct(200, page({ product: { ...PRODUCT, title: '' } }), NOW)).toEqual(unreadable)
    expect(parseKabumProduct(200, page({ product: { ...PRODUCT, flags: { isOpenbox: true } } }), NOW)).toEqual({ ...unreadable, title: PRODUCT.title })
  })

  it('reports a page without product as missing', () => {
    expect(parseKabumProduct(200, page({}), NOW)).toEqual({ kind: 'missing', reason: 'sem produto' })
    expect(parseKabumProduct(200, page({ product: null }), NOW)).toEqual({ kind: 'missing', reason: 'sem produto' })
    expect(parseKabumProduct(404, PRODUCT_PAGE, NOW)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
  })

  it('reports a page without readable data as unknown', () => {
    expect(parseKabumProduct(200, '<html><body>KaBuM!</body></html>', NOW)).toEqual({ kind: 'unknown', reason: 'sem __NEXT_DATA__' })
    expect(parseKabumProduct(200, '<script id="__NEXT_DATA__">{bad</script>', NOW)).toEqual({ kind: 'unknown', reason: 'JSON inválido' })
    expect(parseKabumProduct(500, PRODUCT_PAGE, NOW)).toEqual({ kind: 'unknown', reason: 'HTTP 500' })
  })

  it('reports a wall', () => {
    expect(parseKabumProduct(403, PRODUCT_PAGE, NOW)).toEqual({ kind: 'wall', reason: 'HTTP 403' })
    expect(parseKabumProduct(429, PRODUCT_PAGE, NOW)).toEqual({ kind: 'wall', reason: 'HTTP 429' })
  })
})
