import { expect, test } from 'vitest'
import { takesQuote } from './listing-outcome'

test('only an inserted or updated listing takes the quote; a kept or removed one does not', () => {
  expect(takesQuote({ id: 'a', status: 'inserted' })).toBe(true)
  expect(takesQuote({ id: 'a', status: 'updated' })).toBe(true)
  expect(takesQuote({ id: 'a', status: 'kept' })).toBe(false)
  expect(takesQuote({ id: 'a', status: 'removed' })).toBe(false)
})
