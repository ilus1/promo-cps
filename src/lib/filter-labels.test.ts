import { describe, expect, it, test } from 'vitest'
import { parseDealQuery } from './deal-query'
import { STALE_AFTER_HOURS } from './constants'
import { ITEM_STATUSES } from './domain'
import { activeCouponLabels, activeFilterLabels, buscaRemoved, couponFilterSummary, filterChipLabels, freshnessApplies, FILTER_TOGGLE_LABEL, type LabelFacets } from './filter-labels'

const facets: LabelFacets = {
  searches: [{ id: 'b1', name: 'SSD' }],
  coupons: [{ id: '13873339', label: '10% OFF' }],
}

test('no filters: no chips', () => {
  expect(filterChipLabels(parseDealQuery({}), facets)).toEqual([])
})

test('chips follow the filter bar order and wording', () => {
  const query = parseDealQuery({ busca: 'b1', cupom: '13873339', precoMax: '500', descontoMin: '20', queda: '1', full: '1', frete: '1' })
  expect(filterChipLabels(query, facets)).toEqual([
    'Busca: SSD', 'Cupom: 10% OFF', 'Preço até R$ 500', 'Desconto mínimo: 20%',
    'Só abaixo do menor preço', 'FULL', 'Frete grátis',
  ])
})

test('the saving filters get their own chips after the discount', () => {
  const query = parseDealQuery({ descontoMin: '20', economiaMin: '30', economiaReaisMin: '50.5', queda: '1' })
  expect(filterChipLabels(query, facets)).toEqual([
    'Desconto mínimo: 20%', 'Economia mínima: 30%', 'Economia mínima: R$ 50,50', 'Só abaixo do menor preço',
  ])
})

test('the text chip comes first, the type of product and the offers toggle keep the bar order', () => {
  const query = parseDealQuery({ q: ' fone  bluetooth ', busca: 'b1', categoria: 'MLB-HEADPHONES_AND_EARBUDS', ofertas: '1', antigos: '1' })
  expect(filterChipLabels(query, facets)).toEqual([
    'Texto: fone bluetooth', 'Busca: SSD', 'Categoria: Headphones and earbuds', 'Só ofertas', 'Incluir não lidos nas últimas 72 h',
  ])
})

test('an unknown category still gets a readable chip', () => {
  expect(filterChipLabels(parseDealQuery({ categoria: 'MLB-NOPE_TYPE' }), facets)).toEqual(['Categoria: Nope type'])
  expect(filterChipLabels(parseDealQuery({ categoria: 'MLB1672' }), facets)).toEqual(['Categoria: MLB1672'])
})

test('a deleted busca and an unlisted coupon still get a chip', () => {
  const query = parseDealQuery({ busca: 'gone', cupom: '99' })
  expect(filterChipLabels(query, facets)).toEqual(['Busca: removida', 'Cupom: 99'])
})

describe('activeCouponLabels', () => {
  it('labels only the filters that are set', () => {
    expect(activeCouponLabels({})).toEqual({})
    expect(activeCouponLabels({
      minimumMaxCents: 10000, limitMinCents: 1500, discountMin: 30, text: 'loja',
    })).toEqual({
      minimumMax: 'Compra mínima até R$ 100',
      limitMin: 'Limite a partir de R$ 15',
      discountMin: 'Desconto mínimo: 30%',
      text: 'Texto: loja',
    })
  })
})

test('buscaRemoved is true only for a busca that no longer exists', () => {
  expect(buscaRemoved(parseDealQuery({}), facets)).toBe(false)
  expect(buscaRemoved(parseDealQuery({ busca: 'b1' }), facets)).toBe(false)
  expect(buscaRemoved(parseDealQuery({ busca: 'gone' }), facets)).toBe(true)
})

describe('coupon set chip', () => {
  it('summarizes every coupon filter in the Cupons chip, on Ofertas and in alerts', () => {
    const query = parseDealQuery({ cupons: 'status=ativo&minimoMax=100&escopo=loja&vence=7&comOfertas=1&q=Casa' })
    expect(filterChipLabels(query, facets)).toEqual([
      'Cupons: Ativo, Loja, vencem em até 7 dias, Compra mínima até R$ 100, Só com ofertas ligadas, Texto: Casa',
    ])
    expect(activeFilterLabels(query, facets).couponSet).toBe(filterChipLabels(query, facets)[0])
  })

  it('has no chip without the filter, and keeps the order after Cupom', () => {
    expect(activeFilterLabels(parseDealQuery({ cupons: 'zzz' }), facets).couponSet).toBeUndefined()
    expect(filterChipLabels(parseDealQuery({ cupons: 'tipo=percent', cupom: '99', precoMax: '10' }), facets))
      .toEqual(['Cupom: 99', 'Cupons: Percentual', 'Preço até R$ 10'])
  })

  it('uses the singular for one day', () => {
    expect(couponFilterSummary({ expiringWithinDays: 1 })).toBe('vencem em até 1 dia')
  })

  it('couponFilterSummary joins the set filters', () => {
    expect(couponFilterSummary({ discountMin: 30, limitMinCents: 1500 })).toBe('Limite a partir de R$ 15, Desconto mínimo: 30%')
  })
})

test('the freshness toggle names the window from STALE_AFTER_HOURS', () => {
  expect(FILTER_TOGGLE_LABEL.includeStale).toBe(`Incluir não lidos nas últimas ${STALE_AFTER_HOURS} h`)
})

test('the freshness toggle shows on every tab except Salvos, which ignores freshness', () => {
  expect(ITEM_STATUSES.filter(freshnessApplies)).toEqual(['NOT_SEEN', 'SEEN'])
})

test('the show-inflated pill has its chip, before the freshness one', () => {
  expect(filterChipLabels(parseDealQuery({ inflados: '1', antigos: '1' }), facets)).toEqual([
    FILTER_TOGGLE_LABEL.showInflated, FILTER_TOGGLE_LABEL.includeStale,
  ])
  expect(FILTER_TOGGLE_LABEL.showInflated).toBe('Mostrar ocultos')
})

test('the verified pill has its chip, before the show-hidden one', () => {
  expect(filterChipLabels(parseDealQuery({ verificados: '1', inflados: '1' }), facets)).toEqual([
    FILTER_TOGGLE_LABEL.onlyVerified, FILTER_TOGGLE_LABEL.showInflated,
  ])
  expect(FILTER_TOGGLE_LABEL.onlyVerified).toBe('Só verificados')
})
