import { describe, expect, it } from 'vitest'
import { isValidGtin, normalizeEan, sameGtin, validEan } from './ean'

const JBL_TUNE_520BT = '6925281963650'

describe('normalizeEan', () => {
  it('keeps only the digits', () => {
    expect(normalizeEan(' 692-528 196.3650 ')).toBe(JBL_TUNE_520BT)
    expect(normalizeEan('EAN: 6925281963650')).toBe(JBL_TUNE_520BT)
  })

  it('gives an empty string without digits', () => {
    expect(normalizeEan('sem código')).toBe('')
  })
})

describe('isValidGtin', () => {
  it.each([
    ['GTIN-8', '96385074'],
    ['GTIN-12 (UPC-A)', '036000291452'],
    ['GTIN-13 with check digit 0', JBL_TUNE_520BT],
    ['GTIN-13', '4006381333931'],
    ['GTIN-14', '10012345678902'],
  ])('accepts a valid %s', (_name, code) => {
    expect(isValidGtin(code)).toBe(true)
  })

  it.each([
    ['a wrong check digit', '6925281963651'],
    ['a wrong GTIN-8 check digit', '96385075'],
    ['a wrong GTIN-12 check digit', '036000291453'],
    ['a wrong GTIN-14 check digit', '10012345678903'],
    ['swapped digits', '6925281936650'],
  ])('rejects %s', (_name, code) => {
    expect(isValidGtin(code)).toBe(false)
  })

  it.each([
    ['7 digits', '1234565'],
    ['9 digits', '123456789'],
    ['10 digits', '1234567890'],
    ['11 digits', '12345678901'],
    ['15 digits', '123456789012345'],
  ])('rejects %s', (_name, code) => {
    expect(isValidGtin(code)).toBe(false)
  })

  it('rejects all zeros, separators, letters and an empty code', () => {
    expect(isValidGtin('0000000000000')).toBe(false)
    expect(isValidGtin('00000000')).toBe(false)
    expect(isValidGtin('692528196365-0')).toBe(false)
    expect(isValidGtin('692528196365O')).toBe(false)
    expect(isValidGtin('')).toBe(false)
  })
})

describe('validEan', () => {
  it('normalizes and validates', () => {
    expect(validEan(' 6925281963650 ')).toBe(JBL_TUNE_520BT)
    expect(validEan('6925-2819-6365-0')).toBe(JBL_TUNE_520BT)
  })

  it('accepts spaces, dots and dashes between the digits', () => {
    expect(validEan('6925281.963650')).toBe(JBL_TUNE_520BT)
    expect(validEan('\t6925281963650\n')).toBe(JBL_TUNE_520BT)
    expect(validEan('036 000 291 452')).toBe('036000291452')
  })

  it.each([
    ['a letter O that would leave a valid UPC', '036000291452O'],
    ['a letter O in the middle', '0360O00291452'],
    ['a letter O at the end', '789123456789O'],
    ['a label', 'EAN: 6925281963650'],
    ['a slash', '6925281963650/1'],
    ['a plus sign', '+6925281963650'],
    ['an underscore', '6925281_963650'],
    ['full-width digits', '\uFF16\uFF19\uFF12\uFF15\uFF12\uFF18\uFF11\uFF19\uFF16\uFF13\uFF16\uFF15\uFF10'],
  ])('rejects %s', (_name, raw) => {
    expect(validEan(raw)).toBeNull()
  })

  it('gives null for an invalid, empty or missing code', () => {
    expect(validEan('6925281963651')).toBeNull()
    expect(validEan('')).toBeNull()
    expect(validEan(null)).toBeNull()
    expect(validEan(undefined)).toBeNull()
  })
})

describe('sameGtin', () => {
  it('compares codes of different lengths by their GTIN-14 form', () => {
    expect(sameGtin('036000291452', '0036000291452')).toBe(true)
    expect(sameGtin('036000291452', '00036000291452')).toBe(true)
    expect(sameGtin(JBL_TUNE_520BT, JBL_TUNE_520BT)).toBe(true)
  })

  it('tells different codes apart', () => {
    expect(sameGtin(JBL_TUNE_520BT, '6925281939938')).toBe(false)
    expect(sameGtin('10012345678902', '0012345678905')).toBe(false)
  })
})
