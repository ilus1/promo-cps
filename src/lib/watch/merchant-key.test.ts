import { describe, expect, it } from 'vitest'
import { merchantKeyOf } from './merchant-key'

describe('merchantKeyOf', () => {
  it('folds accents and case and drops everything but letters and digits', () => {
    expect(merchantKeyOf('  Buscapé Loja ')).toBe('buscapeloja')
    expect(merchantKeyOf('MAGAZINE LUIZA')).toBe('magazineluiza')
    expect(merchantKeyOf('Loja 123 & Cia.')).toBe('loja123cia')
  })

  it.each([
    ['KaBuM!', 'kabum'], ['Kabum', 'kabum'], ['kabum', 'kabum'],
    ['Mercado Livre', 'mercadolivre'], ['MercadoLivre', 'mercadolivre'], ['Mercado-Livre', 'mercadolivre'],
    ['Américanas', 'americanas'], ['Casas Bahia', 'casasbahia'],
  ])('keys %s as %s', (name, key) => {
    expect(merchantKeyOf(name)).toBe(key)
  })

  it('removes NUL characters', () => {
    expect(merchantKeyOf('Lo\u0000ja ')).toBe('loja')
  })

  it('keeps different stores apart', () => {
    expect(merchantKeyOf('Amazon Imports')).not.toBe(merchantKeyOf('Amazon'))
    expect(merchantKeyOf('Magazine Luiza')).not.toBe(merchantKeyOf('Magazine Luíza Outlet'))
  })

  it('keeps the folded name when it has no letters or digits, so it never becomes the empty key', () => {
    expect(merchantKeyOf(' \u2605\u2605 ')).toBe('\u2605\u2605')
    expect(merchantKeyOf('   ')).toBe('')
  })
})
