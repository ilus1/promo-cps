import { describe, expect, it } from 'vitest'
import { COMPARE_QUERY_MAX_WORDS } from '../constants'
import { cleanTitle, compareQuery } from './clean-title'

describe('cleanTitle', () => {
  it('keeps brand, model and size words in order', () => {
    expect(compareQuery('Veja X14 Spray Tira Limo Cloro Ativo 500ml')).toBe('veja x14 spray tira limo cloro ativo 500ml')
  })
  it('folds accents and lower-cases', () => {
    expect(cleanTitle('Cabo Trançado Ótimo Ação')).toEqual(['cabo', 'trancado', 'otimo', 'acao'])
  })
  it('drops filler words, including kit', () => {
    expect(cleanTitle('Kit Fone para Celular com Oferta Original Envio Rápido')).toEqual(['fone', 'celular'])
  })
  it('keeps decimals and model hyphens, and trims edge punctuation', () => {
    expect(cleanTitle('Garrafa 1,5L - Tipo-C, (Preta)')).toEqual(['garrafa', '1,5l', 'tipo-c', 'preta'])
  })
  it('splits slashes', () => {
    expect(cleanTitle('Tune 510BT/720BT')).toEqual(['tune', '510bt', '720bt'])
  })
  it('an empty title gives an empty array', () => {
    expect(cleanTitle('')).toEqual([])
    expect(compareQuery('')).toBe('')
  })
  it('an all-filler title gives an empty array', () => {
    expect(cleanTitle('Oferta Original para Novo - Envio Rápido')).toEqual([])
  })
  it('caps a long title', () => {
    const title = Array.from({ length: COMPARE_QUERY_MAX_WORDS + 5 }, (_, index) => `palavra${index}`).join(' ')
    expect(cleanTitle(title)).toHaveLength(COMPARE_QUERY_MAX_WORDS)
    expect(cleanTitle(title)[COMPARE_QUERY_MAX_WORDS - 1]).toBe(`palavra${COMPARE_QUERY_MAX_WORDS - 1}`)
  })
  it('strips the Envio Full bigram but keeps Full HD', () => {
    expect(cleanTitle('Smart TV LG 32 pol Full HD Envio Full')).toEqual(['smart', 'tv', 'lg', '32', 'pol', 'full', 'hd'])
  })
})
