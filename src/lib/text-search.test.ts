import { describe, expect, it } from 'vitest'
import { SEARCH_TEXT_MAX } from './constants'
import {
  ACCENTED_LETTERS, foldAccents, nfc, normalizeSearchText, PLAIN_LETTERS, searchTextOf, searchWords, textMatchesWords, wordMatchers, wordRegexes,
  AFTER_NON_ALNUM, AFTER_NON_LETTER,
} from './text-search'

const L = AFTER_NON_LETTER
const N = AFTER_NON_ALNUM

describe('foldAccents', () => {
  it('maps every pt-BR accented letter to its plain letter, in both cases', () => {
    expect(ACCENTED_LETTERS).toHaveLength(PLAIN_LETTERS.length)
    expect(foldAccents('Ação, café, Pão de Açúcar, ÓLEO, ñandú')).toBe('Acao, cafe, Pao de Acucar, OLEO, nandu')
  })

  it('folds a decomposed accent the same way', () => {
    expect(foldAccents('café')).toBe('cafe')
  })

  it('leaves everything else alone', () => {
    expect(foldAccents('50% a_b')).toBe('50% a_b')
    expect(foldAccents('')).toBe('')
  })
})

describe('searchWords', () => {
  it('splits on any whitespace, folds accents and drops repeats', () => {
    expect(searchWords('  Fone\tde  ouvido  FONE ')).toEqual(['Fone', 'de', 'ouvido'])
    expect(searchWords('Câmera câmera')).toEqual(['Camera'])
    expect(searchWords('FONE fone Fone')).toEqual(['FONE'])
  })

  it('has no words for empty or blank text', () => {
    expect(searchWords('')).toEqual([])
    expect(searchWords(' \n\t ')).toEqual([])
  })
})

describe('wordRegexes', () => {
  it('turns a letter that has accented forms into a class of them, whatever the user typed', () => {
    expect(wordRegexes('fone')).toEqual([L + 'f[oóòôõöOÓÒÔÕÖ][nñNÑ][eéèêëEÉÈÊË]'])
    expect(wordRegexes('FONÊ')).toEqual([L + 'F[oóòôõöOÓÒÔÕÖ][nñNÑ][eéèêëEÉÈÊË]'])
    expect(wordRegexes('açai')).toEqual(wordRegexes('acai'))
  })

  it('escapes regex and LIKE specials, so a typed character is only itself', () => {
    expect(wordRegexes('a.b*c')).toEqual([L + '[aáàâãäAÁÀÂÃÄ]\\.b\\*[cçCÇ]'])
    expect(wordRegexes('(x)+[y]')).toEqual(['\\(x\\)\\+\\[y\\]'])
    expect(wordRegexes('50%_a\\')).toEqual([N + '50%_[aáàâãäAÁÀÂÃÄ]\\\\'])
  })

  it.each(['c++', '(', ')', '[a', 'a]', '\\', '.*', 'a|b', '^$', '{2}', '?', '*', '+', 'a-z', '[a-z]', '\\d'])(
    '%j is matched literally and compiles',
    (typed) => {
      expect(wordRegexes(typed).length).toBeGreaterThan(0)
      expect(() => wordMatchers(typed)).not.toThrow()
    },
  )

  it('every class holds both cases, so matching never depends on the database collation', () => {
    expect(wordRegexes('o')).toEqual([L + '[oóòôõöOÓÒÔÕÖ]'])
    expect(wordRegexes('Ç')).toEqual([L + '[cçCÇ]'])
    expect(textMatchesWords('ÃÓÊ', 'aoe')).toBe(true)
    expect(textMatchesWords('aoe', 'ÃÓÊ')).toBe(true)
    expect(textMatchesWords('AÇÍ', 'aci')).toBe(true)
    expect(textMatchesWords('Ñ', 'ñ')).toBe(true)
  })

  it('a word matches only where a word starts, whatever the letter case or accent', () => {
    const matches = (typed: string, title: string) => textMatchesWords(title, typed)
    expect(matches('fone', 'Fone de ouvido')).toBe(true)
    expect(matches('fone', 'Fones Bluetooth')).toBe(true)
    expect(matches('fone', 'Kit com 2 fones')).toBe(true)
    expect(matches('fone', 'Microfone Lapela')).toBe(false)
    expect(matches('fone', 'Ulefone Armor')).toBe(false)
    expect(matches('fone', 'Interfone')).toBe(false)
    expect(matches('fone', 'Headfone-X')).toBe(false)
    expect(matches('fone', 'Mini-fone')).toBe(true)
    expect(matches('fone', '2fone')).toBe(true)
    expect(matches('ml', 'Suco 300ml')).toBe(true)
    expect(matches('kg', 'Arroz 5kg')).toBe(true)
    expect(matches('kg', 'Pacote ½ kg')).toBe(true)
    expect(matches('½', 'Pacote ½ kg')).toBe(true)
    expect(matches('½', 'Pacote 1½ kg')).toBe(true)
    expect(matches('ǆ', 'Ǆ')).toBe(true)
    expect(matches('ǆ', 'xǅ')).toBe(false)
    expect(matches('ǆ', 'x Ǆ')).toBe(true)
  })

  it('a word start also works before an accented first letter', () => {
    const matches = (typed: string, title: string) => textMatchesWords(title, typed)
    expect(matches('oleo', 'Óleo de coco')).toBe(true)
    expect(matches('oleo', 'Azeite e óleo')).toBe(true)
    expect(matches('oleo', 'Ácido Óleo')).toBe(true)
    expect(matches('oleo', 'Bioóleo')).toBe(false)
    expect(matches('5g', 'a5g')).toBe(false)
    expect(matches('5g', 'Cabo 5g')).toBe(true)
    expect(matches('otica', 'Lente ótica')).toBe(true)
  })

  it('a word that starts with a symbol has no word start anchor', () => {
    expect(wordRegexes('+5')).toEqual(['\\+5'])
    expect(wordRegexes('(x)')[0]).toBe('\\(x\\)')
    expect(wordRegexes('_a')[0].startsWith(N)).toBe(true)
  })

  it('a typed metacharacter matches only itself', () => {
    const matches = (typed: string, title: string) => textMatchesWords(title, typed)
    expect(matches('c++', 'Cabo C++ Guia')).toBe(true)
    expect(matches('c++', 'Cabo CC Guia')).toBe(false)
    expect(matches('.*', 'abc')).toBe(false)
    expect(matches('.*', 'a.*b')).toBe(true)
    expect(matches('a|b', 'a|b')).toBe(true)
    expect(matches('a|b', 'b')).toBe(false)
    expect(matches('[a-z]', 'x')).toBe(false)
    expect(matches('\\', 'x\\y')).toBe(true)
  })

  it('one regex per word', () => {
    expect(wordRegexes('x  y')).toEqual([`${L}x`, `${L}y`])
    expect(wordRegexes('   ')).toEqual([])
  })
})

describe('normalizeSearchText', () => {
  it('drops NULs, collapses blank runs and caps the length', () => {
    expect(normalizeSearchText('  a\0b \n\t c  ')).toBe('ab c')
    expect(normalizeSearchText('a'.repeat(200))).toHaveLength(SEARCH_TEXT_MAX)
    expect(normalizeSearchText('a '.repeat(60))).toHaveLength(SEARCH_TEXT_MAX - 1)
  })
})

describe('searchTextOf', () => {
  it('is text, or nothing when blank, repeated or missing', () => {
    expect(searchTextOf(' notebook  gamer ')).toBe('notebook gamer')
    expect(searchTextOf('   ')).toBeUndefined()
    expect(searchTextOf('\0')).toBeUndefined()
    expect(searchTextOf(['a', 'b'])).toBeUndefined()
    expect(searchTextOf(undefined)).toBeUndefined()
  })
})

describe('nfc', () => {
  const decomposed = 'Cafe\u0301 Ac\u0327ai'

  it('composes a decomposed string', () => {
    expect(nfc(decomposed)).toBe('Caf\u00e9 A\u00e7ai')
    expect(nfc(decomposed)).toHaveLength(9)
  })

  it('composes every string inside arrays and objects and keeps the rest', () => {
    expect(nfc({ items: [{ alt_text: decomposed, n: 1, none: null }], ok: true }))
      .toEqual({ items: [{ alt_text: nfc(decomposed), n: 1, none: null }], ok: true })
  })
})
