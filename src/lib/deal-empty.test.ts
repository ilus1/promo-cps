import { describe, expect, it } from 'vitest'
import { EMPTY_PAGE_TEXT } from './coupon-empty'
import {
  dealEmptyState, EMPTY_DEALS_TEXT, EMPTY_FILTERED_DEALS_TEXT, EMPTY_TAB_TEXT,
} from './deal-empty'

describe('dealEmptyState', () => {
  it('is null when something is shown', () => {
    expect(dealEmptyState({ shown: 3, total: 3, filtered: true, anyTab: 9 })).toBeNull()
  })

  it('a page past the end offers the first page', () => {
    expect(dealEmptyState({ shown: 0, total: 50, filtered: false, anyTab: 50 }))
      .toEqual({ text: EMPTY_PAGE_TEXT, action: 'first-page' })
  })

  it('no matches anywhere with filters offers to clear them', () => {
    expect(dealEmptyState({ shown: 0, total: 0, filtered: true, anyTab: 0 }))
      .toEqual({ text: EMPTY_FILTERED_DEALS_TEXT, action: 'clear-filters' })
  })

  it('filters that match only in another tab name the tab and leave clearing to the filter bar', () => {
    expect(dealEmptyState({ shown: 0, total: 0, filtered: true, anyTab: 2 }))
      .toEqual({ text: EMPTY_TAB_TEXT, action: null })
  })

  it('an empty tab while others have offers has no action', () => {
    expect(dealEmptyState({ shown: 0, total: 0, filtered: false, anyTab: 4 }))
      .toEqual({ text: EMPTY_TAB_TEXT, action: null })
  })

  it('no offers at all sends to Conta', () => {
    expect(dealEmptyState({ shown: 0, total: 0, filtered: false, anyTab: 0 }))
      .toEqual({ text: EMPTY_DEALS_TEXT, action: 'account' })
  })
})
