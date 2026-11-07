import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  americanasEanUrl, americanasLinkUrl, americanasRefreshUrl, americanasSearchUrl, parseAmericanasQuote, parseAmericanasSearch,
} from './parse-americanas'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const BY_EAN = fixture('americanas-ean.json')
const BY_TEXT = fixture('americanas-search.json')
const API = 'https://www.americanas.com.br/api/catalog_system/pub/products/search'
const JBL_REF = '3738039:3984675'
const JBL_SLUG = 'fone-de-ouvido-bluetooth-jbl-tune-520bt-preto-7460187432'
const OUT_OF_STOCK_REF = '7673477:8162634'

const JBL_CANDIDATE = {
  retailer: 'americanas',
  ref: JBL_REF,
  url: `https://www.americanas.com.br/${JBL_SLUG}/p`,
  title: 'Fone de Ouvido Bluetooth jbl Tune 520BT Preto',
  ean: '6925281963650',
  merchant: 'JBL Oficial',
  priceCents: 33_900,
  listPriceCents: null,
  inStock: true,
}

type Seller = { sellerName?: unknown; commertialOffer?: Record<string, unknown> | null }

const seller = (sellerName: string, Price: number, AvailableQuantity: number, ListPrice: number = Price): Seller => ({
  sellerName, commertialOffer: { Price, ListPrice, AvailableQuantity },
})

function product(items: unknown[], over: Record<string, unknown> = {}) {
  return { productId: '100', productName: 'Fone JBL Tune 520BT Preto', linkText: 'fone-jbl-tune-520bt-preto', link: 'https://www.americanas.com.br/fone-jbl-tune-520bt-preto/p', items, ...over }
}

function item(sellers: Seller[], over: Record<string, unknown> = {}) {
  return { itemId: '200', ean: '6925281963650', nameComplete: 'Fone JBL Tune 520BT Preto', sellers, ...over }
}

const body = (products: unknown[]) => JSON.stringify(products)

function candidatesOf(text: string, status = 200) {
  const page = parseAmericanasSearch(status, text)
  if (page.kind !== 'ok') throw new Error(page.reason)
  return page.value
}

describe('americanas urls', () => {
  it('searches the VTEX API by EAN, text, link slug and product id', () => {
    expect(americanasEanUrl('6925281963650')).toBe(`${API}?fq=alternateIds_Ean:6925281963650`)
    expect(americanasSearchUrl('  jbl tune 520bt ')).toBe(`${API}?ft=jbl%20tune%20520bt`)
    expect(americanasSearchUrl('fone & cia')).toBe(`${API}?ft=fone%20%26%20cia`)
    expect(americanasLinkUrl(JBL_SLUG)).toBe(`${API}/${JBL_SLUG}/p`)
    expect(americanasRefreshUrl(JBL_REF)).toBe(`${API}?fq=productId:3738039`)
  })
})

describe('parseAmericanasSearch on the probe captures', () => {
  it('keeps the only in-stock SKU of the EAN search, with its EAN and seller', () => {
    expect(candidatesOf(BY_EAN)).toEqual([JBL_CANDIDATE])
  })

  it('reads one candidate per SKU of the text search', () => {
    const candidates = candidatesOf(BY_TEXT)
    expect(candidates.map((candidate) => candidate.ref)).toEqual([
      JBL_REF, '6538737:7046611', '6008627:6406805', '1157281:1231946', '6596129:7106398',
    ])
    expect(candidates[0]).toEqual(JBL_CANDIDATE)
  })

  it('keeps a list price only above the price', () => {
    const tune110 = candidatesOf(BY_TEXT).find((candidate) => candidate.ref === '1157281:1231946')
    expect(tune110).toMatchObject({ priceCents: 8_900, listPriceCents: 9_900, ean: '6925281918933' })
  })

  it('accepts the VTEX partial content status', () => {
    expect(candidatesOf(BY_EAN, 206)).toEqual([JBL_CANDIDATE])
  })
})

describe('parseAmericanasSearch rules', () => {
  it('prices a SKU at its cheapest seller with stock', () => {
    const page = body([product([item([seller('Cara', 350, 3), seller('Sem estoque', 300, 0), seller('Barata', 339.9, 1, 399.9)])])])
    expect(candidatesOf(page)).toEqual([{
      retailer: 'americanas',
      ref: '100:200',
      url: 'https://www.americanas.com.br/fone-jbl-tune-520bt-preto/p',
      title: 'Fone JBL Tune 520BT Preto',
      ean: '6925281963650',
      merchant: 'Barata',
      priceCents: 33_990,
      listPriceCents: 39_990,
      inStock: true,
    }])
  })

  it('reads every SKU of a product', () => {
    const page = body([product([
      item([seller('Loja', 339, 1)]),
      item([seller('Loja', 349, 1)], { itemId: 201, ean: '6925281963667', nameComplete: 'Fone JBL Tune 520BT Azul' }),
    ], { productId: 100 })])
    expect(candidatesOf(page).map(({ ref, title, ean }) => ({ ref, title, ean }))).toEqual([
      { ref: '100:200', title: 'Fone JBL Tune 520BT Preto', ean: '6925281963650' },
      { ref: '100:201', title: 'Fone JBL Tune 520BT Azul', ean: '6925281963667' },
    ])
  })

  it('drops an invalid EAN and a seller without a name', () => {
    const page = body([product([item([{ commertialOffer: { Price: 339, ListPrice: 339, AvailableQuantity: 1 } }], { ean: '123' })])])
    expect(candidatesOf(page)[0]).toMatchObject({ ean: null, merchant: null })
  })

  it('falls back to the product name and to the link', () => {
    const page = body([product([item([seller('Loja', 339, 1)], { nameComplete: ' ' })], { linkText: null })])
    expect(candidatesOf(page)[0]).toMatchObject({ title: 'Fone JBL Tune 520BT Preto', url: 'https://www.americanas.com.br/fone-jbl-tune-520bt-preto/p' })
  })

  it('builds the url from the slug even when the API link has another host', () => {
    const page = body([product([item([seller('Loja', 339, 1)])], { link: 'https://americanas.vtexcommercestable.com.br/fone-jbl-tune-520bt-preto/p' })])
    expect(candidatesOf(page)[0].url).toBe('https://www.americanas.com.br/fone-jbl-tune-520bt-preto/p')
  })

  it('strips NUL characters from text', () => {
    const page = body([product([item([seller('Lo\u0000ja', 339, 1)], { nameComplete: 'Fone\u0000 JBL' })])])
    expect(candidatesOf(page)[0]).toMatchObject({ title: 'Fone JBL', merchant: 'Loja' })
  })

  it('skips SKUs without id, title or url', () => {
    const page = body([
      product([item([seller('Loja', 339, 1)], { itemId: null })]),
      product([item([seller('Loja', 339, 1)], { nameComplete: null })], { productName: null }),
      product([item([seller('Loja', 339, 1)])], { linkText: null, link: null }),
      product([item([seller('Loja', 339, 1)])], { productId: null }),
      product([item([seller('Loja', 339, 1)], { itemId: '201' })], { productId: '101' }),
    ])
    expect(candidatesOf(page).map((candidate) => candidate.ref)).toEqual(['101:201'])
  })

  it('reports a product whose sellers are all out of stock as empty, with its name', () => {
    expect(parseAmericanasSearch(200, body([product([item([seller('Loja', 0, 0), seller('Outra', 339, 0)])])])))
      .toEqual({ kind: 'empty', reason: 'sem estoque', title: 'Fone JBL Tune 520BT Preto' })
  })

  it('ignores prices that do not fit the database', () => {
    expect(parseAmericanasSearch(200, body([product([item([seller('Loja', 99_999_999, 1), seller('Outra', 339, 0)])])])))
      .toMatchObject({ kind: 'empty', reason: 'sem estoque' })
  })
})

describe('parseAmericanasSearch failures', () => {
  it.each([
    [403, 'wall'], [429, 'wall'], [503, 'wall'], [404, 'missing'], [500, 'unknown'], [0, 'unknown'],
  ])('maps HTTP %i to %s', (status, kind) => {
    expect(parseAmericanasSearch(status, BY_EAN).kind).toBe(kind)
  })

  it('reports an empty result list as empty', () => {
    expect(parseAmericanasSearch(200, '[]')).toEqual({ kind: 'empty', reason: 'nenhum produto' })
  })

  it.each([
    ['an HTML page', '<html><body>Acesso negado</body></html>'],
    ['a JSON object', '{"error":"bad"}'],
    ['an empty body', ''],
  ])('reports %s as unknown', (_name, text) => {
    expect(parseAmericanasSearch(200, text)).toEqual({ kind: 'unknown', reason: 'JSON inválido' })
  })

  it('reports products without readable SKUs as unknown, keeping the product name when there is one', () => {
    expect(parseAmericanasSearch(200, body([{ productId: '1' }, null, 'x']))).toEqual({ kind: 'unknown', reason: 'produtos ilegíveis' })
    expect(parseAmericanasSearch(200, body([product([item([{ sellerName: 'Loja' }])])])))
      .toEqual({ kind: 'unknown', reason: 'produtos ilegíveis', title: 'Fone JBL Tune 520BT Preto' })
  })

  it('reports a product with no SKU, or whose SKUs have no seller, as empty with its name: it carries no data', () => {
    const empty = { kind: 'empty', reason: 'sem estoque', title: 'Fone JBL Tune 520BT Preto' }
    expect(parseAmericanasSearch(200, body([product([])]))).toEqual(empty)
    expect(parseAmericanasSearch(200, body([product([item([]), item([], { itemId: '201' })])]))).toEqual(empty)
  })

  it('keeps a product whose items cannot be read, or with no items list, as unknown', () => {
    expect(parseAmericanasSearch(200, body([product([item([], { itemId: null })])]))).toMatchObject({ kind: 'unknown' })
    expect(parseAmericanasSearch(200, body([{ productId: '100', productName: 'Fone' }]))).toMatchObject({ kind: 'unknown', title: 'Fone' })
  })
})

describe('parseAmericanasQuote', () => {
  it('quotes a SKU of the refreshed product', () => {
    expect(parseAmericanasQuote(200, BY_EAN, JBL_REF)).toEqual({
      kind: 'ok',
      value: {
        ref: JBL_REF,
        merchant: 'JBL Oficial',
        title: 'Fone de Ouvido Bluetooth jbl Tune 520BT Preto',
        priceCents: 33_900,
        listPriceCents: null,
        finalCents: 33_900,
        inStock: true,
      },
    })
  })

  it('accepts the VTEX partial content status', () => {
    expect(parseAmericanasQuote(206, BY_EAN, JBL_REF).kind).toBe('ok')
  })

  it('reports a SKU without stock as empty', () => {
    expect(parseAmericanasQuote(200, BY_EAN, OUT_OF_STOCK_REF)).toEqual({ kind: 'empty', reason: 'sem estoque' })
  })

  it('reports a SKU with no seller as empty, not unreadable', () => {
    expect(parseAmericanasQuote(200, body([product([item([])])]), '100:200')).toEqual({ kind: 'empty', reason: 'sem estoque' })
  })

  it('reports a SKU that is gone as missing', () => {
    expect(parseAmericanasQuote(200, BY_EAN, '3738039:999')).toEqual({ kind: 'missing', reason: 'SKU ausente' })
    expect(parseAmericanasQuote(200, '[]', JBL_REF)).toEqual({ kind: 'missing', reason: 'nenhum produto' })
    expect(parseAmericanasQuote(404, BY_EAN, JBL_REF)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
  })

  it('reports a wall and an unreadable answer', () => {
    expect(parseAmericanasQuote(403, BY_EAN, JBL_REF)).toEqual({ kind: 'wall', reason: 'HTTP 403' })
    expect(parseAmericanasQuote(200, '<html></html>', JBL_REF)).toEqual({ kind: 'unknown', reason: 'JSON inválido' })
    expect(parseAmericanasQuote(200, body([product([item([{ sellerName: 'Loja' }])])]), '100:200'))
      .toEqual({ kind: 'unknown', reason: 'produtos ilegíveis' })
  })
})
