import { describe, expect, it } from 'vitest'
import { compareLinks } from './links'

describe('compareLinks', () => {
  it('builds the four search URLs for the Veja title', () => {
    expect(compareLinks('Veja X14 Spray Tira Limo Cloro Ativo 500ml')).toEqual({
      buscape: 'https://www.buscape.com.br/search?q=veja+x14+spray+tira+limo+cloro+ativo+500ml',
      googleShopping: 'https://www.google.com/search?tbm=shop&q=veja+x14+spray+tira+limo+cloro+ativo+500ml',
      amazon: 'https://www.amazon.com.br/s?k=veja+x14+spray+tira+limo+cloro+ativo+500ml',
      magalu: 'https://www.magazineluiza.com.br/busca/veja-x14-spray-tira-limo-cloro-ativo-500ml/',
    })
  })
  it('encodes ampersands and splits slashes', () => {
    expect(compareLinks('Pão&Queijo 3/4 Café')).toEqual({
      buscape: 'https://www.buscape.com.br/search?q=pao%26queijo+3+4+cafe',
      googleShopping: 'https://www.google.com/search?tbm=shop&q=pao%26queijo+3+4+cafe',
      amazon: 'https://www.amazon.com.br/s?k=pao%26queijo+3+4+cafe',
      magalu: 'https://www.magazineluiza.com.br/busca/pao%26queijo-3-4-cafe/',
    })
  })
  it('a lone ampersand adds nothing', () => {
    expect(compareLinks('Sal & Pimenta')?.buscape).toBe('https://www.buscape.com.br/search?q=sal+pimenta')
  })
  it('falls back to the folded title words when it is all filler', () => {
    expect(compareLinks('Oferta Original Novo')?.buscape).toBe('https://www.buscape.com.br/search?q=oferta+original+novo')
  })
  it('an empty or punctuation-only title has no links', () => {
    expect(compareLinks('')).toBeNull()
    expect(compareLinks(' - & ')).toBeNull()
  })
})
