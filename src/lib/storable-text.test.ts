import { describe, expect, test } from 'vitest'
import { storableFields, storableJson, storableOptionalText, storableText } from './storable-text'

const NUL = '\u0000'

describe('storableText', () => {
  test('removes every NUL and keeps everything else', () => {
    expect(storableText(`Fone${NUL} JBL${NUL}${NUL} 520BT`)).toBe('Fone JBL 520BT')
  })

  test('keeps empty text empty, and text made only of NUL becomes empty', () => {
    expect(storableText('')).toBe('')
    expect(storableText(`${NUL}${NUL}${NUL}`)).toBe('')
  })

  test('leaves accents, composed and decomposed marks, emoji and other scripts untouched', () => {
    const text = 'Promoção café é 🎧 日本 ñ'
    expect(storableText(text)).toBe(text)
    expect(storableText(`${NUL}${text}${NUL}`)).toBe(text)
  })

  test('lone surrogates become the replacement character, while well-formed emoji stay as they are', () => {
    expect(storableText('Fone \ud83d')).toBe('Fone \ufffd')
    expect(storableText('\udc00 JBL')).toBe('\ufffd JBL')
    expect(storableText(`a${NUL}\ud83d${NUL}b`)).toBe('a\ufffdb')
    expect(storableText('🎧 \ud83c\udfa7')).toBe('🎧 🎧')
    expect(JSON.parse(JSON.stringify(storableJson({ name: 'x\ud83d' })))).toEqual({ name: 'x\ufffd' })
  })

  test('the nullable variant keeps null and cleans text', () => {
    expect(storableOptionalText(null)).toBeNull()
    expect(storableOptionalText(`a${NUL}b`)).toBe('ab')
  })
})

test('storableFields cleans the string fields of a row and keeps the other values as they are', () => {
  const at = new Date('2026-11-05T01:39:00Z')
  const nested = { text: `x${NUL}` }
  const row = storableFields({ title: `T${NUL}`, count: 3, flag: true, none: null, at, nested })
  expect(row).toEqual({ title: 'T', count: 3, flag: true, none: null, at, nested })
  expect(row.at).toBe(at)
  expect(row.nested).toBe(nested)
})

test('storableJson cleans strings and keys at every depth and keeps numbers, booleans and null', () => {
  const raw = { [`na${NUL}me`]: `a${NUL}`, items: [{ alt_text: `b${NUL}`, n: 1 }, `c${NUL}`, null, false], deep: { deeper: { text: NUL } } }
  expect(storableJson(raw)).toEqual({ name: 'a', items: [{ alt_text: 'b', n: 1 }, 'c', null, false], deep: { deeper: { text: '' } } })
  expect(JSON.stringify(storableJson(raw))).not.toContain('\\u0000')
})
