import { describe, expect, it } from 'vitest'
import containerSearch from './__fixtures__/container-search.json'
import search from './__fixtures__/search.json'
import storeSearch from './__fixtures__/store-search.json'
import { readSearchPage, SEARCH_RESULTS_MISSING } from './search-page'

const SEARCH_URL = 'https://lista.mercadolivre.com.br/ssd-nvme-1tb'
const NEXT_URL = `${SEARCH_URL}_Desde_49_NoIndex_True`
const FIXTURE_CARDS = 3

const responseOf = (section: unknown) => ({ getResultsPromise: { value: { optimizedResponse: section } } })
const sharedOf = (section: unknown) => ({ getResultsPromise: { value: { sharedState: { search: section } } } })
const nextPage = (url: unknown, show: unknown = true) => ({ pagination: { next_page: { url, show } } })
const polycardEntry = (id: string, price: unknown = 100) => ({
  polycard: {
    metadata: { id, url: 'www.mercadolivre.com.br/x/p/MLB9', url_params: '?pdp_filters=item_id%3AMLB1' },
    components: [{ type: 'title', title: { text: 'Item' } }, { type: 'price', price: { current_price: { value: price } } }],
  },
})

describe('readSearchPage on the fixture', () => {
  const page = readSearchPage(search, SEARCH_URL)

  it('merges the two copies of each card into one', () => {
    expect(page.cards).toHaveLength(FIXTURE_CARDS)
    expect(new Set(page.cards.map((c) => c.id)).size).toBe(FIXTURE_CARDS)
    expect(page.found).toBe(FIXTURE_CARDS)
    expect(page.dropped).toBe(0)
  })

  it('takes the next page from the page own pagination link', () => {
    expect(page.nextUrl).toMatch(/^https:\/\/lista\.mercadolivre\.com\.br\/.+_Desde_49_NoIndex_True$/)
  })
})

describe('readSearchPage results', () => {
  it.each([
    ['not an object', null],
    ['an empty object', {}],
    ['no results array', responseOf({ results: 'x' })],
    ['no response at all', { getResultsPromise: { value: {} } }],
  ])('%s -> reader failure', (_, pageProps) => {
    expect(() => readSearchPage(pageProps, SEARCH_URL)).toThrow(SEARCH_RESULTS_MISSING)
  })

  it('an empty result list is a legitimate page with no items', () => {
    expect(readSearchPage(responseOf({ results: [] }), SEARCH_URL)).toEqual({ cards: [], found: 0, dropped: 0, nextUrl: null })
  })

  it('reads whichever of the two copies exists', () => {
    expect(readSearchPage(sharedOf({ results: [polycardEntry('MLB1')] }), SEARCH_URL).cards.map((c) => c.id)).toEqual(['MLB1'])
    expect(readSearchPage(responseOf({ results: [polycardEntry('MLB2')] }), SEARCH_URL).cards.map((c) => c.id)).toEqual(['MLB2'])
  })

  it('counts a card without a price as found and dropped', () => {
    const page = readSearchPage(responseOf({ results: [polycardEntry('MLB1'), polycardEntry('MLB2', null)] }), SEARCH_URL)
    expect(page).toMatchObject({ found: 2, dropped: 1 })
    expect(page.cards.map((c) => c.id)).toEqual(['MLB1'])
  })

  it('ignores entries that are not cards', () => {
    expect(readSearchPage(responseOf({ results: [{ id: 'ad', type: 'banner' }, polycardEntry('MLB1')] }), SEARCH_URL)).toMatchObject({ found: 1 })
  })
})

describe('readSearchPage pagination', () => {
  const withNext = (next: unknown) => readSearchPage(responseOf({ results: [], ...next as object }), SEARCH_URL).nextUrl

  it('accepts a shown, safe ML link', () => expect(withNext(nextPage(NEXT_URL))).toBe(NEXT_URL))
  it('drops the fragment of the link', () => expect(withNext(nextPage(`${NEXT_URL}#x`))).toBe(NEXT_URL))
  it('has no next page when it is not shown', () => expect(withNext(nextPage(NEXT_URL, false))).toBeNull())
  it('has no next page when show is not a boolean true', () => expect(withNext(nextPage(NEXT_URL, 'true'))).toBeNull())
  it.each([
    ['missing', undefined], ['empty', ''], ['blank', '  '], ['a number', 2],
    ['a foreign host', 'https://evil.com/x'], ['plain http', 'http://lista.mercadolivre.com.br/x'],
    ['a login wall', 'https://www.mercadolivre.com.br/login'], ['not a url', 'page 2'],
  ])('rejects a link that is %s', (_, url) => expect(withNext(nextPage(url))).toBeNull())
  it('has no next page without a pagination block', () => expect(withNext({})).toBeNull())
  it('falls back to the second copy when the first has no link', () => {
    const pageProps = {
      getResultsPromise: { value: {
        optimizedResponse: { results: [] },
        sharedState: { search: { results: [], ...nextPage(NEXT_URL) } },
      } },
    }
    expect(readSearchPage(pageProps, SEARCH_URL).nextUrl).toBe(NEXT_URL)
  })
})

describe('readSearchPage on store pages and coupon containers', () => {
  it.each([
    ['store page', storeSearch, /^https:\/\/lista\.mercadolivre\.com\.br\/pagina\/.+_Desde_49_NoIndex_True$/],
    ['coupon container', containerSearch, /^https:\/\/lista\.mercadolivre\.com\.br\/_Desde_49_Container_.+_NoIndex_True$/],
  ])('reads the %s from initialState', (_, fixture, nextUrl) => {
    const page = readSearchPage(fixture, SEARCH_URL)
    expect(page).toMatchObject({ found: FIXTURE_CARDS, dropped: 0 })
    expect(page.cards).toHaveLength(FIXTURE_CARDS)
    expect(page.nextUrl).toMatch(nextUrl)
  })
})

describe('readSearchPage direct results only', () => {
  it('ignores a card nested inside a carousel entry', () => {
    const carousel = { id: 'carousel', type: 'carousel', components: [polycardEntry('MLBNESTED')] }
    const page = readSearchPage(responseOf({ results: [polycardEntry('MLB1'), carousel] }), SEARCH_URL)
    expect(page.cards.map((c) => c.id)).toEqual(['MLB1'])
    expect(page.found).toBe(1)
  })
})

describe('readSearchPage host pin', () => {
  const OTHER_HOST_URL = 'https://www.mercadolivre.com.br/ssd_Desde_49'
  it('drops a next link on another ML host', () => {
    expect(readSearchPage(responseOf({ results: [], ...nextPage(OTHER_HOST_URL) }), SEARCH_URL).nextUrl).toBeNull()
  })
  it('keeps a next link on the Busca own host', () => {
    expect(readSearchPage(responseOf({ results: [], ...nextPage(OTHER_HOST_URL) }), OTHER_HOST_URL).nextUrl).toBe(OTHER_HOST_URL)
  })
})
