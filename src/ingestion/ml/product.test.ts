import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/product-page.json'
import {
  PRODUCT_PAGE_UNRECOGNIZED, PRODUCT_WITHOUT_ITEM, PRODUCT_WITHOUT_PRICE, PRODUCT_WITHOUT_TITLE, readProductPage,
} from './product'

const URL_OF_BUSCA = 'https://www.mercadolivre.com.br/ssd/p/MLB32362095'

type Edit = readonly [path: string, value: unknown]
const REMOVED = Symbol('removed')
const remove = (path: string): Edit => [path, REMOVED]

function pageWith(...edits: Edit[]) {
  const page = structuredClone(fixture) as unknown as Record<string, unknown>
  for (const [path, value] of edits) {
    const keys = path.split('.')
    const last = keys.pop() as string
    const parent = keys.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, page)
    if (value === REMOVED) delete parent[last]
    else parent[last] = value
  }
  return page
}

const COMPONENTS = 'initialState.components'
const EVENT_DATA = `${COMPONENTS}.track.melidata_event.event_data`

describe('readProductPage on the fixture', () => {
  const card = readProductPage(fixture, URL_OF_BUSCA)

  it('keys the item by the item id shown, not the product id', () => {
    expect(card.id).toBe('MLB5465378923')
    expect(card.productId).toBe('MLB32362095')
  })

  it('reads title, price, list price, basis and discount', () => {
    expect(card).toMatchObject({
      title: 'Ssd M.2 1tb Sandisk Plus Nvme 2280',
      priceCents: 87875,
      listPriceCents: 92500,
      basisText: 'no Pix',
      basis: 'pix',
      mlDiscountPct: 5,
      soldQuantity: 10000,
      sellerLabel: 'BESTBYBRASIL',
      isPad: false,
      categoryId: 'MLB1672',
      domainId: 'MLB-HARD_DRIVES_AND_SSDS',
    })
  })

  it('pins the item url to the item shown, dropping other parameters', () => {
    expect(card.url).toBe(`${URL_OF_BUSCA}?pdp_filters=item_id%3AMLB5465378923`)
    expect(readProductPage(fixture, `${URL_OF_BUSCA}?foo=bar&pdp_filters=item_id%3AMLB1#x`).url).toBe(card.url)
  })

  it('builds the thumbnail from the first gallery picture', () => {
    expect(card.thumbnail).toBe('https://http2.mlstatic.com/D_Q_NP_2X_729633-MLA99465062840_112025-E.webp')
  })

  it('leaves what the page does not state as null', () => {
    expect(card).toMatchObject({ freeShipping: null, couponHint: null, full: false })
    const bare = pageWith(remove(`${EVENT_DATA}.category_id`), remove(`${EVENT_DATA}.domain_id`))
    expect(readProductPage(bare, URL_OF_BUSCA)).toMatchObject({ categoryId: null, domainId: null })
  })
})

describe('readProductPage failures', () => {
  it.each([null, 'x', [], {}, { page: 'search' }])('%j is not a product page', (pageProps) => {
    expect(() => readProductPage(pageProps, URL_OF_BUSCA)).toThrow(PRODUCT_PAGE_UNRECOGNIZED)
  })

  it('needs an item id, falling back to the tracking event', () => {
    const noHistory = pageWith(remove('initialState.history.id'))
    expect(readProductPage(noHistory, URL_OF_BUSCA).id).toBe('MLB5465378923')
    const noId = pageWith(remove('initialState.history.id'), remove(`${EVENT_DATA}.item_id`))
    expect(() => readProductPage(noId, URL_OF_BUSCA)).toThrow(PRODUCT_WITHOUT_ITEM)
  })

  it.each([undefined, 0, -1, '878', null])('a price of %j is a failure', (value) => {
    const page = pageWith([`${COMPONENTS}.price.price.value`, value])
    expect(() => readProductPage(page, URL_OF_BUSCA)).toThrow(PRODUCT_WITHOUT_PRICE)
  })

  it('needs a title', () => {
    const page = pageWith([`${COMPONENTS}.header.title`, '  '])
    expect(() => readProductPage(page, URL_OF_BUSCA)).toThrow(PRODUCT_WITHOUT_TITLE)
  })

  it('treats a missing basis, gallery and event data as unknown', () => {
    const page = pageWith(
      remove(`${COMPONENTS}.price.price_breakdown`),
      remove(`${COMPONENTS}.gallery`),
      remove(`${COMPONENTS}.track`),
      remove(`${COMPONENTS}.seller_summary`),
    )
    expect(readProductPage(page, URL_OF_BUSCA)).toMatchObject({
      basisText: null, basis: 'none', thumbnail: null, soldQuantity: null, full: null, sellerLabel: null,
    })
  })

  it('marks a fulfillment item as FULL', () => {
    const page = pageWith([`${EVENT_DATA}.logistic_type`, 'fulfillment'])
    expect(readProductPage(page, URL_OF_BUSCA).full).toBe(true)
  })
})
