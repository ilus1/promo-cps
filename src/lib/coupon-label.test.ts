import { describe, expect, it } from 'vitest'
import { couponLabel, COUPON_LABEL_SEPARATOR } from './coupon-label'

const store = (title: string, name: string) => ({ title, isStore: true, scopeLabel: `Em produtos de ${name}` })

describe('couponLabel', () => {
  it('adds the store name after the title for a store coupon', () => {
    expect(couponLabel(store('20% OFF', 'Vwliberato'))).toBe(`20% OFF${COUPON_LABEL_SEPARATOR}Vwliberato`)
  })

  it('is the title alone for a Mercado Livre coupon', () => {
    expect(couponLabel({ title: 'R$ 220 OFF', isStore: false, scopeLabel: 'Em produtos selecionados' })).toBe('R$ 220 OFF')
  })

  it('does not repeat a store name the title already has, in any case', () => {
    expect(couponLabel(store('10% OFF na Loja X', 'loja x'))).toBe('10% OFF na Loja X')
  })

  it('falls back to the title when the store name is missing or blank', () => {
    expect(couponLabel({ title: '5% OFF', isStore: true, scopeLabel: null })).toBe('5% OFF')
    expect(couponLabel(store('5% OFF', '  '))).toBe('5% OFF')
    expect(couponLabel({ title: '5% OFF', isStore: true, scopeLabel: 'Em produtos selecionados' })).toBe('5% OFF')
  })

  it('falls back to the store name when the title is blank', () => {
    expect(couponLabel(store('  ', 'Loja X'))).toBe('Loja X')
  })
})
