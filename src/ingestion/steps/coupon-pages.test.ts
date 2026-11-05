import { describe, expect, it } from 'vitest'
import { ML_COUPONS_URL } from '@/lib/constants'
import { parseCouponPage } from '../ml/coupons'
import {
  activationVisits, couponPageUrl, emptyPageEndsHarvest, isFullHarvest, lastPageToRead, rawPageSize,
} from './coupon-pages'

describe('couponPageUrl', () => {
  it('uses the bare coupon list URL for page 1', () => {
    expect(couponPageUrl(1)).toBe(ML_COUPONS_URL)
  })
  it('appends the page number after page 1', () => {
    expect(couponPageUrl(2)).toBe(`${ML_COUPONS_URL}&page=2`)
    expect(couponPageUrl(65)).toBe(`${ML_COUPONS_URL}&page=65`)
  })
})

describe('rawPageSize', () => {
  it('counts parsed coupons and entries skipped for a missing campaign_id', () => {
    const page = parseCouponPage({ filteredCouponsData: {
      pagination: { page: 1, total: 1 }, totalCouponsQuantity: { number: 3 }, rawCoupons: [{ campaign_id: '1' }, {}, { campaign_id: '2' }],
    } })
    expect(rawPageSize(page)).toBe(3)
  })
})

describe('lastPageToRead', () => {
  const first = { totalCoupons: 1933, totalPages: 65, firstPageCount: 30 }
  it('reads the pages ML reports when they match the total', () => {
    expect(lastPageToRead(first)).toBe(65)
  })
  it('caps a runaway page count one page past what the total needs', () => {
    expect(lastPageToRead({ ...first, totalPages: 100000 })).toBe(66)
  })
  it('reads only page 1 when page 1 had no entries', () => {
    expect(lastPageToRead({ ...first, firstPageCount: 0 })).toBe(1)
  })
  it('reads no page past page 1 when the page count is zero', () => {
    expect(lastPageToRead({ ...first, totalPages: 0 })).toBe(0)
  })
})

describe('emptyPageEndsHarvest', () => {
  const first = { totalCoupons: 1933, totalPages: 65, firstPageCount: 30 }
  it('ends the harvest at the last page the total needs', () => {
    expect(emptyPageEndsHarvest(first, 65)).toBe(true)
  })
  it('ends the harvest past the last page the total needs', () => {
    expect(emptyPageEndsHarvest(first, 66)).toBe(true)
  })
  it('does not end the harvest before the last page the total needs', () => {
    expect(emptyPageEndsHarvest(first, 64)).toBe(false)
  })
  it('does not end the harvest when page 1 had no entries', () => {
    expect(emptyPageEndsHarvest({ ...first, firstPageCount: 0 }, 1)).toBe(false)
  })
})

describe('isFullHarvest', () => {
  const full = { failedPages: 0, totalCoupons: 1933, totalPages: 65, firstPageCount: 30, seen: 1931, skipped: 0 }
  it('is full when every page loaded and the coupons seen cover the total', () => {
    expect(isFullHarvest(full)).toBe(true)
  })
  it('is full when the last page is exactly full', () => {
    expect(isFullHarvest({ ...full, totalCoupons: 1950, seen: 1950 })).toBe(true)
  })
  it('is full when more coupons were seen than the total', () => {
    expect(isFullHarvest({ ...full, seen: 1940 })).toBe(true)
  })
  it('is not full when a page failed', () => {
    expect(isFullHarvest({ ...full, failedPages: 1 })).toBe(false)
  })
  it('is not full when ML reported no coupons', () => {
    expect(isFullHarvest({ ...full, totalCoupons: 0, seen: 0 })).toBe(false)
  })
  it('is not full when page 1 had no coupons', () => {
    expect(isFullHarvest({ ...full, firstPageCount: 0 })).toBe(false)
  })
  it('is not full when the pagination total is missing', () => {
    expect(isFullHarvest({ ...full, totalPages: 0 })).toBe(false)
  })
  it('is not full when the page count is too short for the total', () => {
    expect(isFullHarvest({ ...full, totalPages: 1 })).toBe(false)
  })
  it('is not full when the total drifts over a page boundary', () => {
    expect(isFullHarvest({ ...full, totalCoupons: 1951 })).toBe(false)
  })
  it('is full when the coupons missing are just inside one page of slack', () => {
    expect(isFullHarvest({ ...full, seen: 1933 - 29 })).toBe(true)
  })
  it('is not full when the coupons missing reach one page', () => {
    expect(isFullHarvest({ ...full, seen: 1933 - 30 })).toBe(false)
  })
  it('is not full when any entry was skipped, even if seen plus skipped covers the total', () => {
    expect(isFullHarvest({ ...full, seen: 1933 - 1, skipped: 1 })).toBe(false)
    expect(isFullHarvest({ ...full, seen: 1933 - 30, skipped: 1 })).toBe(false)
  })
  it('is not full when every entry was skipped and none seen', () => {
    expect(isFullHarvest({ ...full, seen: 0, skipped: 1933 })).toBe(false)
    expect(isFullHarvest({ ...full, seen: 0, skipped: 0 })).toBe(false)
  })
  it('is not full when only a fraction of the coupons was seen', () => {
    expect(isFullHarvest({ ...full, seen: 30 })).toBe(false)
  })
})

describe('activationVisits', () => {
  const c = (campaignId: string) => ({ campaignId })
  it('groups candidates by the page where each was last seen, strongest page first', () => {
    const pages = new Map([['a', 5], ['b', 2], ['c', 5]])
    expect(activationVisits([c('a'), c('b'), c('c')], pages)).toEqual([
      { pageNumber: 5, candidates: [c('a'), c('c')] },
      { pageNumber: 2, candidates: [c('b')] },
    ])
  })
  it('sends a candidate without a tracked page to page 1', () => {
    const pages = new Map([['a', 1]])
    expect(activationVisits([c('x'), c('a')], pages)).toEqual([
      { pageNumber: 1, candidates: [c('x'), c('a')] },
    ])
  })
  it('returns no visit for no candidates', () => {
    expect(activationVisits([], new Map())).toEqual([])
  })
})
