import { describe, expect, it } from 'vitest'
import {
  alertFilters, alertNarrows, alertQueryOf, CLEARED_FILTERS, DEAL_SORTS, DEFAULT_DEAL_SORT, dealFiltersFromParams, dealHref, hasDealFilters, viewsDrops, type DealQuery,
  normalizeAlertQuery, offersByBuscaHref, offersByCouponHref, offersByCouponSetHref, parseDealQuery, TAB_PARAM,
} from './deal-query'
import { SEARCH_TEXT_MAX } from './constants'
import { ITEM_STATUSES } from './domain'
import { searchParamsToRecord } from './query-params'
import { ROUTES } from './routes'

describe('dealFiltersFromParams', () => {
  it('reads filters and drops invalid ones', () => {
    expect(dealFiltersFromParams({
      busca: 'b1', cupom: '123', precoMax: '500', descontoMin: '20', queda: '1',
      vendidosMin: 'x', full: '1', frete: '1', sort: 'bogus',
    })).toEqual({
      searchId: 'b1', couponId: '123', priceMaxCents: 50000, discountMin: 20, onlyDrops: true,
      soldMin: undefined, full: true, freeShipping: true, offersOnly: false, includeStale: false, showInflated: false, onlyVerified: false, sort: 'desconto',
      category: undefined,
    })
  })

  it('no params: no filters, flags off, default sort', () => {
    expect(dealFiltersFromParams({})).toEqual({
      onlyDrops: false, full: false, freeShipping: false, offersOnly: false, includeStale: false, showInflated: false, onlyVerified: false, sort: DEFAULT_DEAL_SORT,
    })
  })

  it('keeps an old category id as it came, so its chip shows the raw value', () => {
    expect(dealFiltersFromParams({ categoria: 'MLB1652' })).toMatchObject({ category: 'MLB1652' })
  })

  it('keeps a known sort, the category and the stale toggle', () => {
    expect(dealFiltersFromParams({ sort: 'preco', categoria: 'MLB-NOTEBOOKS', antigos: '1' }))
      .toMatchObject({ sort: 'preco', category: 'MLB-NOTEBOOKS', includeStale: true })
  })

  it('rounds reais to centavos and raises fractional minimums to the next whole number', () => {
    expect(dealFiltersFromParams({ precoMax: '499.9', descontoMin: '20.5', vendidosMin: '9.1' }))
      .toMatchObject({ priceMaxCents: 49990, discountMin: 21, soldMin: 10 })
  })

  it('a flag is on only for 1', () => {
    expect(dealFiltersFromParams({ queda: '0', full: 'true', frete: ['1', '1'] }))
      .toMatchObject({ onlyDrops: false, full: false, freeShipping: false })
  })
})

describe('normalizeAlertQuery', () => {
  it('sorts keys, drops sort, tab and page', () => {
    const p = new URLSearchParams('sort=preco&queda=1&busca=b1&status=SAVED&pagina=2&descontoMin=10')
    expect(normalizeAlertQuery(p)).toBe('busca=b1&descontoMin=10&queda=1')
  })

  it('the same view in any param order gives the same string, empty values dropped', () => {
    const a = new URLSearchParams('frete=1&categoria=MLB-A&precoMax=&antigos=1')
    const b = new URLSearchParams('antigos=1&categoria=MLB-A&frete=1')
    expect(normalizeAlertQuery(a)).toBe(normalizeAlertQuery(b))
    expect(normalizeAlertQuery(a)).toBe('antigos=1&categoria=MLB-A&frete=1')
  })

  it('the text is an alert key, trimmed, single-spaced and capped, in key order', () => {
    const p = new URLSearchParams({ q: `  fone   bluetooth ${'x'.repeat(200)}`, ofertas: '1', busca: 'b1' })
    const saved = normalizeAlertQuery(p)
    const text = dealFiltersFromParams(searchParamsToRecord(new URLSearchParams(saved))).text
    expect(text).toHaveLength(SEARCH_TEXT_MAX)
    expect(text?.startsWith('fone bluetooth x')).toBe(true)
    expect(saved.startsWith('busca=b1&q=fone+bluetooth+x')).toBe(true)
    expect(saved).not.toContain('ofertas')
    expect(normalizeAlertQuery(new URLSearchParams(saved))).toBe(saved)
  })

  it.each([
    ['q=', ''],
    ['q=%20%20%09', ''],
    ['q=a&q=b', ''],
    ['ofertas=0', ''],
    ['ofertas=1', ''],
    ['ofertas=1&q=%20a%20', 'q=a'],
    ['q=fone', 'ofertas=1&q=fone'],
    ['q=%00', ''],
  ])('%s and %s give the same string', (a, b) => {
    expect(normalizeAlertQuery(new URLSearchParams(a))).toBe(normalizeAlertQuery(new URLSearchParams(b)))
  })

  it.each([
    ['queda=0', ''],
    ['precoMax=500.00', 'precoMax=500'],
    ['descontoMin=20.5', 'descontoMin=21'],
    ['vendidosMin=x&busca=b1', 'busca=b1'],
    ['precoMax=-3&full=yes&categoria=', ''],
    ['busca=b1&busca=b2', ''],
  ])('%s and %s give the same string', (a, b) => {
    expect(normalizeAlertQuery(new URLSearchParams(a))).toBe(normalizeAlertQuery(new URLSearchParams(b)))
  })

  it('a saved alert query reads back as the same filters as the view, minus the sort', () => {
    const view = new URLSearchParams(
      'sort=preco&vendidosMin=10&queda=1&precoMax=499.9&full=1&frete=1&descontoMin=20'
      + '&cupom=123&categoria=MLB-NOTEBOOKS&busca=b1&antigos=1',
    )
    const saved = normalizeAlertQuery(view)
    expect(saved).toBe(
      'antigos=1&busca=b1&categoria=MLB-NOTEBOOKS&cupom=123&descontoMin=20&frete=1&full=1'
      + '&precoMax=499.9&queda=1&vendidosMin=10',
    )
    expect(normalizeAlertQuery(new URLSearchParams(saved))).toBe(saved)
    expect(dealFiltersFromParams(searchParamsToRecord(new URLSearchParams(saved))))
      .toEqual({ ...dealFiltersFromParams(searchParamsToRecord(view)), sort: DEFAULT_DEAL_SORT })
  })
})

describe('minimums of zero', () => {
  it('zero means no filter', () => {
    expect(dealFiltersFromParams({ descontoMin: '0', vendidosMin: '0' }))
      .toMatchObject({ discountMin: undefined, soldMin: undefined })
    expect(normalizeAlertQuery(new URLSearchParams('descontoMin=0&vendidosMin=0'))).toBe('')
  })
})

const none = parseDealQuery({})

describe('parseDealQuery', () => {
  it('reads the tab and the page', () => {
    expect(parseDealQuery({ aba: 'salvos', pagina: '3' })).toMatchObject({ tab: 'SAVED', page: 3 })
  })

  it('invalid tab and page fall back to the first tab and page', () => {
    expect(parseDealQuery({ aba: 'SAVED', pagina: 'abc' })).toMatchObject({ tab: 'NOT_SEEN', page: 1 })
    expect(parseDealQuery({ aba: ['vistos'], pagina: ['2'] })).toMatchObject({ tab: 'NOT_SEEN', page: 1 })
    expect(parseDealQuery({ pagina: '-4' })).toMatchObject({ page: 1 })
    expect(parseDealQuery({ pagina: '0' })).toMatchObject({ page: 1 })
  })
})

describe('dealHref', () => {
  it('no filters is the bare route', () => {
    expect(dealHref(none)).toBe(ROUTES.offers)
  })

  it('writes canonical params in a fixed order and omits the default sort and tab', () => {
    const q = parseDealQuery({ frete: '1', sort: 'desconto', busca: 'b1', precoMax: '500.00', aba: 'novos' })
    expect(dealHref(q)).toBe('/?busca=b1&precoMax=500&frete=1')
  })

  it('keeps a non-default sort and tab', () => {
    expect(dealHref(none, { sort: 'preco', tab: 'SEEN' })).toBe('/?sort=preco&aba=vistos')
  })

  it('a flag turned off removes its param instead of writing 0', () => {
    const q = parseDealQuery({ queda: '1', full: '1' })
    expect(dealHref(q, { onlyDrops: false })).toBe('/?full=1')
  })

  it('an emptied field removes its param', () => {
    const q = parseDealQuery({ precoMax: '500', descontoMin: '20' })
    expect(dealHref(q, { priceMaxCents: undefined })).toBe('/?descontoMin=20')
  })

  it('a filter, sort or tab change resets the page', () => {
    const q = parseDealQuery({ pagina: '4', frete: '1' })
    expect(dealHref(q, { full: true })).toBe('/?full=1&frete=1')
    expect(dealHref(q, { sort: 'queda' })).toBe('/?frete=1&sort=queda')
    expect(dealHref(q, { tab: 'SAVED' })).toBe('/?frete=1&aba=salvos')
  })

  it('paging keeps the filters and omits page 1', () => {
    const q = parseDealQuery({ pagina: '3', frete: '1' })
    expect(dealHref(q, { page: 4 })).toBe('/?frete=1&pagina=4')
    expect(dealHref(q, { page: 1 })).toBe('/?frete=1')
    expect(dealHref(q)).toBe('/?frete=1&pagina=3')
  })

  it('unknown keys, repeated params and invalid values never reach the link', () => {
    const dirty = parseDealQuery({ foo: 'bar', busca: ['a', 'b'], sort: 'bogus', vendidosMin: 'x', full: 'yes', frete: '1' })
    expect(dealHref(dirty)).toBe('/?frete=1')
  })

  it('clearing the filters keeps the sort and tab', () => {
    const q = parseDealQuery({ sort: 'preco', aba: 'salvos', frete: '1', busca: 'b1', antigos: '1' })
    expect(dealHref(q, CLEARED_FILTERS)).toBe('/?sort=preco&aba=salvos')
  })

  it.each<[string, Partial<DealQuery>]>([
    ['search', { searchId: 'b1' }],
    ['coupon', { couponId: '13873339' }],
    ['price', { priceMaxCents: 49990 }],
    ['discount', { discountMin: 20 }],
    ['saving percent', { savingMin: 30 }],
    ['saving reais', { savingMinCents: 12550 }],
    ['drops', { onlyDrops: true }],
    ['sold', { soldMin: 100 }],
    ['full', { full: true }],
    ['shipping', { freeShipping: true }],
    ['category', { category: 'MLB-NOTEBOOKS' }],
    ['text', { text: 'fone bluetooth' }],
    ['offers only', { offersOnly: true }],
    ['stale', { includeStale: true }],
    ...DEAL_SORTS.map((sort): [string, Partial<DealQuery>] => [`sort ${sort}`, { sort }]),
    ...ITEM_STATUSES.map((tab): [string, Partial<DealQuery>] => [`tab ${TAB_PARAM[tab]}`, { tab }]),
  ])('round-trips %s', (_name, changes) => {
    const href = dealHref(none, changes)
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams)
    expect(parseDealQuery(params)).toEqual({ ...none, ...changes })
  })
})

describe('saving filters and sorts', () => {
  it('reads the saving filters with the same rounding as the other minimums', () => {
    expect(dealFiltersFromParams({ economiaMin: '30.2', economiaReaisMin: '125.5' }))
      .toMatchObject({ savingMin: 31, savingMinCents: 12550 })
  })

  it.each(['', '0', '-5', 'x', '0.0'])('%j means no saving filter', (value) => {
    expect(dealFiltersFromParams({ economiaMin: value, economiaReaisMin: value }))
      .toMatchObject({ savingMin: undefined, savingMinCents: undefined })
  })

  it('caps the percent and writes canonical params', () => {
    expect(dealFiltersFromParams({ economiaMin: '250' })).toMatchObject({ savingMin: 100 })
    expect(dealHref(parseDealQuery({ economiaMin: '30.2', economiaReaisMin: '50' }), {}))
      .toBe('/?economiaMin=31&economiaReaisMin=50')
  })

  it('both are alert keys, normalized and sorted, and zero ones vanish', () => {
    const p = new URLSearchParams('sort=economia&economiaReaisMin=50&economiaMin=30&busca=b1')
    expect(normalizeAlertQuery(p)).toBe('busca=b1&economiaMin=30&economiaReaisMin=50')
    expect(normalizeAlertQuery(new URLSearchParams('economiaMin=0&economiaReaisMin=0'))).toBe('')
  })

  it('knows both new sorts and drops unknown ones', () => {
    expect(dealFiltersFromParams({ sort: 'economia' }).sort).toBe('economia')
    expect(dealFiltersFromParams({ sort: 'economiaReais' }).sort).toBe('economiaReais')
    expect(dealFiltersFromParams({ sort: 'economiaTotal' }).sort).toBe(DEFAULT_DEAL_SORT)
  })

  it('clearing the filters removes them but keeps the sort', () => {
    const q = parseDealQuery({ sort: 'economia', economiaMin: '30', economiaReaisMin: '50' })
    expect(dealHref(q, CLEARED_FILTERS)).toBe('/?sort=economia')
  })
})

describe('hasDealFilters', () => {
  it('is false for the default view and ignores sort, tab and page', () => {
    expect(hasDealFilters(none)).toBe(false)
    expect(hasDealFilters(parseDealQuery({ sort: 'preco', aba: 'salvos', pagina: '2' }))).toBe(false)
  })

  it('is true when any filter is set', () => {
    expect(hasDealFilters(parseDealQuery({ antigos: '1' }))).toBe(true)
    expect(hasDealFilters(parseDealQuery({ precoMax: '0' }))).toBe(false)
  })
})

describe('precoMax of zero', () => {
  it('means no filter in parse and in the alert query', () => {
    expect(dealFiltersFromParams({ precoMax: '0' }).priceMaxCents).toBeUndefined()
    expect(dealFiltersFromParams({ precoMax: '0.004' }).priceMaxCents).toBeUndefined()
    expect(normalizeAlertQuery(new URLSearchParams('precoMax=0'))).toBe('')
  })

  it('keeps centavos', () => {
    expect(dealFiltersFromParams({ precoMax: '0.01' }).priceMaxCents).toBe(1)
    expect(dealHref(none, { priceMaxCents: 49990 })).toBe('/?precoMax=499.9')
  })
})

describe('offersByCouponHref', () => {
  it('builds the canonical coupon filter link', () => {
    expect(offersByCouponHref('13873339')).toBe('/?cupom=13873339')
    expect(offersByCouponHref('a b&c')).toBe('/?cupom=a+b%26c')
  })
})

describe('offersByBuscaHref', () => {
  it('filters Ofertas by one Busca', () => {
    expect(offersByBuscaHref('20cbe02c-1736-4aa6-92b7-ce6310833c04')).toBe('/?busca=20cbe02c-1736-4aa6-92b7-ce6310833c04')
  })
})

describe('cupons filter (offers for a coupon set)', () => {
  const NESTED = 'status=ativo&minimoMax=100'
  const encoded = (nested: string) => new URLSearchParams({ cupons: nested }).toString()

  it('offersByCouponSetHref builds the canonical href without page or sort', () => {
    expect(offersByCouponSetHref('ordem=vence&pagina=3&minimoMax=100&status=ativo'))
      .toBe(`${ROUTES.offers}?${encoded(NESTED)}`)
  })

  it('reads the nested query through the coupon parser, in canonical order', () => {
    expect(dealFiltersFromParams({ cupons: 'minimoMax=100.00&status=ativo&ordem=economia&pagina=2' }).couponSetQuery)
      .toBe(NESTED)
    expect(dealFiltersFromParams({ cupons: 'q=%20Casa%20grande%20' }).couponSetQuery).toBe('q=Casa+grande')
  })

  it('an empty, missing, repeated-empty or unparsable value means no filter', () => {
    for (const cupons of [undefined, '', 'zzz', 'status=bogus&tipo=x', 'ordem=vence&pagina=2', '%%%']) {
      expect(dealFiltersFromParams({ cupons }).couponSetQuery).toBeUndefined()
    }
    expect(hasDealFilters(parseDealQuery({ cupons: 'zzz' }))).toBe(false)
  })

  it('round-trips through dealHref and counts as a filter', () => {
    const query = parseDealQuery({ cupons: NESTED, pagina: '2' })
    expect(hasDealFilters(query)).toBe(true)
    expect(dealHref(query)).toBe(`${ROUTES.offers}?${encoded(NESTED)}&pagina=2`)
    expect(parseDealQuery(Object.fromEntries(new URL(dealHref(query), 'http://x').searchParams)).couponSetQuery).toBe(NESTED)
  })

  it('CLEARED_FILTERS removes it, and it combines with cupom', () => {
    const query = parseDealQuery({ cupons: NESTED, cupom: '99' })
    expect(query).toMatchObject({ couponId: '99', couponSetQuery: NESTED })
    expect(dealHref(query, CLEARED_FILTERS)).toBe(ROUTES.offers)
  })

  it('is an alert key, re-normalized without page or sort, in a stable order', () => {
    const p = new URLSearchParams({ cupons: 'ordem=vence&pagina=3&status=ativo&minimoMax=100.0', busca: 'b1', sort: 'preco' })
    expect(normalizeAlertQuery(p)).toBe(`busca=b1&${encoded(NESTED)}`)
    expect(normalizeAlertQuery(new URLSearchParams({ cupons: 'status=ativo&minimoMax=100' }))).toBe(encoded(NESTED))
  })

  it('an unparsable cupons value is dropped from the alert key', () => {
    expect(normalizeAlertQuery(new URLSearchParams('cupons=zzz&queda=1'))).toBe('queda=1')
  })

  it('alertFilters round-trips the saved key', () => {
    const saved = normalizeAlertQuery(new URLSearchParams({ cupons: NESTED }))
    expect(alertFilters(saved).couponSetQuery).toBe(NESTED)
  })
})

describe('viewsDrops', () => {
  it('is on for the queda sort or the drops filter only', () => {
    expect(viewsDrops({ sort: 'queda', onlyDrops: false })).toBe(true)
    expect(viewsDrops({ sort: 'preco', onlyDrops: true })).toBe(true)
    expect(viewsDrops({ sort: 'preco', onlyDrops: false })).toBe(false)
  })
})

describe('alertNarrows', () => {
  it('is false for a view with only the sort, the offers toggle or the freshness pill', () => {
    expect(alertNarrows(parseDealQuery({}))).toBe(false)
    expect(alertNarrows(parseDealQuery({ ofertas: '1' }))).toBe(false)
    expect(alertNarrows(parseDealQuery({ antigos: '1' }))).toBe(false)
    expect(alertNarrows(parseDealQuery({ sort: 'preco' }))).toBe(false)
  })

  it('is true when any alert filter is set', () => {
    expect(alertNarrows(parseDealQuery({ q: 'fone' }))).toBe(true)
    expect(alertNarrows(parseDealQuery({ ofertas: '1', precoMax: '500' }))).toBe(true)
    expect(alertNarrows(parseDealQuery({ queda: '1' }))).toBe(true)
  })
})

describe('inflados', () => {
  it('is the Mostrar descontos inflados flag, off by default, and an alert key', () => {
    expect(dealFiltersFromParams({}).showInflated).toBe(false)
    expect(dealFiltersFromParams({ inflados: '1' }).showInflated).toBe(true)
    expect(dealFiltersFromParams({ inflados: '0' }).showInflated).toBe(false)
    expect(alertQueryOf(dealFiltersFromParams({ inflados: '1' }))).toBe('inflados=1')
    expect(hasDealFilters(dealFiltersFromParams({ inflados: '1' }))).toBe(true)
  })

  it('widens the alert: it never counts as narrowing', () => {
    expect(alertNarrows(parseDealQuery({ inflados: '1' }))).toBe(false)
    expect(alertNarrows(parseDealQuery({ inflados: '1', q: 'fone' }))).toBe(true)
  })

  it('round-trips through the href and clears with the other filters', () => {
    const query = parseDealQuery({ inflados: '1' })
    expect(dealHref(query)).toBe(`${ROUTES.offers}?inflados=1`)
    expect(dealHref(query, CLEARED_FILTERS)).toBe(ROUTES.offers)
  })

  it('sorts by real saving as a regular sort', () => {
    expect(dealFiltersFromParams({ sort: 'economiaReal' }).sort).toBe('economiaReal')
  })
})

describe('verificados', () => {
  it('is the Só verificados flag, off by default, and an alert key that narrows', () => {
    expect(dealFiltersFromParams({}).onlyVerified).toBe(false)
    expect(dealFiltersFromParams({ verificados: '1' }).onlyVerified).toBe(true)
    expect(alertQueryOf(dealFiltersFromParams({ verificados: '1' }))).toBe('verificados=1')
    expect(alertNarrows(parseDealQuery({ verificados: '1' }))).toBe(true)
    expect(hasDealFilters(dealFiltersFromParams({ verificados: '1' }))).toBe(true)
  })

  it('round-trips through the href and clears with the other filters', () => {
    const query = parseDealQuery({ verificados: '1' })
    expect(dealHref(query)).toBe(`${ROUTES.offers}?verificados=1`)
    expect(dealHref(query, CLEARED_FILTERS)).toBe(ROUTES.offers)
  })
})
