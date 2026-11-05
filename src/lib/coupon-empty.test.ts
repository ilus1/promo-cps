import { expect, test } from 'vitest'
import { EMPTY_FILTERED_TEXT, EMPTY_PAGE_TEXT, EMPTY_TABLE_TEXT, emptyState } from './coupon-empty'

test('no empty state while rows are shown', () => {
  expect(emptyState({ shown: 3, total: 3, filtered: true, overall: 9 })).toBeNull()
})

test('a page past the end offers the first page', () => {
  expect(emptyState({ shown: 0, total: 50, filtered: false, overall: 50 })).toEqual({ text: EMPTY_PAGE_TEXT, action: 'first-page' })
})

test('filters that match nothing offer to clear them', () => {
  expect(emptyState({ shown: 0, total: 0, filtered: true, overall: 9 })).toEqual({ text: EMPTY_FILTERED_TEXT, action: 'clear-filters' })
})

test('an empty table points to the account page, filtered or not', () => {
  const expected = { text: EMPTY_TABLE_TEXT, action: 'account' }
  expect(emptyState({ shown: 0, total: 0, filtered: false, overall: 0 })).toEqual(expected)
  expect(emptyState({ shown: 0, total: 0, filtered: true, overall: 0 })).toEqual(expected)
})
