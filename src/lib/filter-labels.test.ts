import { describe, expect, it } from 'vitest'
import { activeCouponLabels } from './filter-labels'

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
