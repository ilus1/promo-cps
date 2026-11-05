import { describe, expect, it } from 'vitest'
import { hintIsPrice, hintMatches, hintOfText } from './coupon-hint'

describe('hintOfText', () => {
  it('reads a percent hint, with a decimal comma', () => {
    expect(hintOfText('10% OFF com Cupom')).toEqual({ text: '10% OFF com Cupom', percentOff: 10, amountOffCents: null, priceAfterCents: null })
    expect(hintOfText('2,5% OFF com Cupom').percentOff).toBe(2.5)
  })

  it('reads an amount-off hint, with thousands dots and decimals', () => {
    expect(hintOfText('R$ 100 OFF com Cupom').amountOffCents).toBe(10000)
    expect(hintOfText('R$ 1.257 OFF com Cupom').amountOffCents).toBe(125700)
    expect(hintOfText('R$ 20,50 OFF com Cupom').amountOffCents).toBe(2050)
  })

  it('reads a price-after hint and tells it from an amount off', () => {
    const price = hintOfText('R$ 1.023,53 com Cupom')
    expect(price).toEqual({ text: 'R$ 1.023,53 com Cupom', percentOff: null, amountOffCents: null, priceAfterCents: 102353 })
    expect(hintIsPrice(price)).toBe(true)
    expect(hintIsPrice(hintOfText('R$ 100 OFF com Cupom'))).toBe(false)
    expect(hintIsPrice(hintOfText('10% OFF com Cupom'))).toBe(false)
    expect(hintIsPrice(hintOfText('Cupom exclusivo'))).toBe(false)
  })
})

describe('hintMatches on a parsed text', () => {
  const percent = { kind: 'percent' as const, percentOff: 10, amountOffCents: null, capCents: null }
  const fixed = { kind: 'fixed' as const, percentOff: null, amountOffCents: 2000, capCents: null }

  it('needs the same kind and value', () => {
    expect(hintMatches(hintOfText('10% OFF com Cupom'), 10000, percent)).toBe(true)
    expect(hintMatches(hintOfText('11% OFF com Cupom'), 10000, percent)).toBe(false)
    expect(hintMatches(hintOfText('10% OFF com Cupom'), 10000, fixed)).toBe(false)
    expect(hintMatches(hintOfText('R$ 20 OFF com Cupom'), 10000, fixed)).toBe(true)
    expect(hintMatches(hintOfText('R$ 21 OFF com Cupom'), 10000, fixed)).toBe(false)
  })
})
