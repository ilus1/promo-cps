import { expect, test } from 'vitest'
import { centsFromReais, isUuid, num, str } from './query-params'

test('num parses non-negative finite numbers', () => {
  expect(num('0')).toBe(0)
  expect(num('250000')).toBe(250000)
  expect(num('3')).toBe(3)
})

test('num rejects absent / non-string / empty input', () => {
  expect(num(undefined)).toBeUndefined()
  expect(num('')).toBeUndefined()
  expect(num(['a', 'b'])).toBeUndefined()
})

test('num rejects non-finite, negative, and out-of-int4-range values', () => {
  expect(num('abc')).toBeUndefined()
  expect(num('NaN')).toBeUndefined()
  expect(num('-5')).toBeUndefined()
  expect(num('Infinity')).toBeUndefined()
  expect(num('2147483648')).toBeUndefined()
  expect(num('999999999999')).toBeUndefined()
  expect(num('2147483647')).toBe(2147483647)
})

test('str returns a non-empty string or undefined', () => {
  expect(str('x')).toBe('x')
  expect(str('')).toBeUndefined()
  expect(str(undefined)).toBeUndefined()
  expect(str(['a'])).toBeUndefined()
})

test('str removes NUL and lone surrogates, and a param made only of NUL is absent', () => {
  expect(str('MLB\u00001055')).toBe('MLB1055')
  expect(str('\u0000')).toBeUndefined()
  expect(str('a\ud83d')).toBe('a\ufffd')
})

test('centsFromReais turns a reais param into whole centavos', () => {
  expect(centsFromReais('500')).toBe(50000)
  expect(centsFromReais('4588.9')).toBe(458890)
  expect(centsFromReais('0.01')).toBe(1)
})

test('centsFromReais drops invalid values and centavos past the int4 range', () => {
  expect(centsFromReais(undefined)).toBeUndefined()
  expect(centsFromReais('x')).toBeUndefined()
  expect(centsFromReais('-1')).toBeUndefined()
  expect(centsFromReais('21474836.47')).toBe(2147483647)
  expect(centsFromReais('21474836.48')).toBeUndefined()
})

test('isUuid accepts only the hyphenated uuid shape', () => {
  expect(isUuid('0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11')).toBe(true)
  expect(isUuid('0B9D0C52-1C3F-4A56-9A0E-5D8C7C4B2F11')).toBe(true)
  expect(isUuid('b1')).toBe(false)
  expect(isUuid('')).toBe(false)
  expect(isUuid('0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11; drop')).toBe(false)
})

