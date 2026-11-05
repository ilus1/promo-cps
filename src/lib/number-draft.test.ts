import { describe, expect, it } from 'vitest'
import { decimalDraft, digitsDraft } from './number-draft'
import { dealFiltersFromParams } from './deal-query'

describe('digitsDraft', () => {
  it('keeps only digits', () => {
    expect(digitsDraft('1a2.3,4')).toBe('1234')
    expect(digitsDraft('')).toBe('')
  })
})

describe('decimalDraft', () => {
  it.each([
    ['499', '499'],
    ['499,9', '499.9'],
    ['499.90', '499.90'],
    ['499.999', '499.99'],
    ['1.2.3', '1.23'],
    ['abc', ''],
    ['-5', '5'],
    ['12.', '12.'],
  ])('%s becomes %s', (raw, draft) => {
    expect(decimalDraft(raw)).toBe(draft)
  })

  it('a price draft reads back as the same centavos', () => {
    expect(dealFiltersFromParams({ precoMax: decimalDraft('499,9') }).priceMaxCents).toBe(49990)
  })
})
