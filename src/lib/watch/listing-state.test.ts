import { expect, test } from 'vitest'
import { quotesPrice } from './listing-state'

test('a listing quotes a price only in stock, with a final price and no error on its last check', () => {
  expect(quotesPrice({ inStock: true, finalCents: 100, lastError: null })).toBe(true)
  expect(quotesPrice({ inStock: false, finalCents: 100, lastError: null })).toBe(false)
  expect(quotesPrice({ inStock: null, finalCents: 100, lastError: null })).toBe(false)
  expect(quotesPrice({ inStock: true, finalCents: null, lastError: null })).toBe(false)
  expect(quotesPrice({ inStock: true, finalCents: 100, lastError: 'HTTP 503' })).toBe(false)
})
