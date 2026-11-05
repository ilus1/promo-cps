import { describe, expect, it } from 'vitest'
import { RunStop } from '../errors'
import { COUPON_PAGE_WITHOUT_DATA, type CouponPage } from '../ml/coupons'
import type { PageProps } from '../ml/page-state'
import { MAX_UNPARSED_PAGES_IN_ROW, type Loaded } from './breaker'
import {
  EMPTY_COUPON_PAGE, readCouponPages, WRONG_COUPON_PAGE, type HarvestIo,
} from './harvest-pages'

const PAGE_SIZE = 3

type Counts = { totalPages: number; totalCoupons: number }

function couponPage(pageNumber: number, ids: string[], { totalPages, totalCoupons }: Counts): PageProps {
  return {
    filteredCouponsData: {
      pagination: { page: pageNumber, total: totalPages },
      totalCouponsQuantity: { number: totalCoupons },
      rawCoupons: ids.map((id) => ({ campaign_id: id, title: { text: `${id}% OFF` } })),
    },
  }
}

function idsOf(pageNumber: number): string[] {
  return Array.from({ length: PAGE_SIZE }, (_, i) => `${pageNumber}-${i}`)
}

function fakeIo(pageFor: (pageNumber: number) => Loaded<PageProps>) {
  const requested: number[] = []
  const stored: CouponPage['coupons'][] = []
  const io: HarvestIo = {
    load: async (pageNumber) => {
      requested.push(pageNumber)
      return pageFor(pageNumber)
    },
    store: async (coupons) => {
      stored.push(coupons)
      return coupons.length
    },
  }
  return { io, requested, stored }
}

const loaded = (value: PageProps): Loaded<PageProps> => ({ ok: true, value })
const counts = { totalPages: 4, totalCoupons: 4 * PAGE_SIZE }
const regular = (pageNumber: number) => loaded(couponPage(pageNumber, idsOf(pageNumber), counts))

describe('readCouponPages', () => {
  it('reads every page and is full when all coupons were seen', async () => {
    const { io, requested } = fakeIo(regular)
    const result = await readCouponPages(io)
    expect(requested).toEqual([1, 2, 3, 4])
    expect(result).toMatchObject({
      allPagesLoaded: true, pages: 4, seen: 12, inserted: 12, skipped: 0, totalCoupons: 12, failedPages: 0, lastError: null,
    })
    expect(result.couponPages.get('3-1')).toBe(3)
  })

  it('keeps the last page where a coupon shifted to', async () => {
    const shifted = (n: number) => loaded(couponPage(n, n === 3 ? ['2-2', '3-0', '3-1'] : idsOf(n), counts))
    const result = await readCouponPages(fakeIo(shifted).io)
    expect(result.couponPages.get('2-2')).toBe(3)
    expect(result.seen).toBe(11)
    expect(result.allPagesLoaded).toBe(true)
  })

  it('counts pages that report page 1 for every request as failed and stops after the limit', async () => {
    const { io, requested } = fakeIo(() => loaded(couponPage(1, idsOf(1), { totalPages: 100, totalCoupons: 300 })))
    const result = await readCouponPages(io)
    expect(requested).toEqual(Array.from({ length: MAX_UNPARSED_PAGES_IN_ROW + 1 }, (_, i) => i + 1))
    expect(result.failedPages).toBe(MAX_UNPARSED_PAGES_IN_ROW)
    expect(result.lastError).toBe(`${WRONG_COUPON_PAGE}: pedida ${MAX_UNPARSED_PAGES_IN_ROW + 1}, recebida 1`)
    expect(result.allPagesLoaded).toBe(false)
  })

  it('ends without a failure at an empty page that is the last one the total needs', async () => {
    const drifted = { totalPages: 4, totalCoupons: 3 * PAGE_SIZE + 1 }
    const { io, requested } = fakeIo((n) => loaded(couponPage(n, n < 4 ? idsOf(n) : [], drifted)))
    const result = await readCouponPages(io)
    expect(requested).toEqual([1, 2, 3, 4])
    expect(result).toMatchObject({ failedPages: 0, lastError: null, seen: 3 * PAGE_SIZE, allPagesLoaded: true })
  })

  it('ends without a failure at an empty page past the last one the total needs', async () => {
    const runaway = { totalPages: 100000, totalCoupons: 2 * PAGE_SIZE }
    const { io, requested } = fakeIo((n) => loaded(couponPage(n, n < 3 ? idsOf(n) : [], runaway)))
    const result = await readCouponPages(io)
    expect(requested).toEqual([1, 2, 3])
    expect(result).toMatchObject({ failedPages: 0, allPagesLoaded: true })
  })

  it('propagates a RunStop thrown by the page load', async () => {
    const expired = new RunStop('session_expired', 'expirada')
    const { io } = fakeIo((n) => {
      if (n === 2) throw expired
      return regular(n)
    })
    await expect(readCouponPages(io)).rejects.toBe(expired)
  })

  it('stops at an empty page before the last one the total needs and counts it as failed', async () => {
    const { io, requested } = fakeIo((n) => loaded(couponPage(n, n < 3 ? idsOf(n) : [], counts)))
    const result = await readCouponPages(io)
    expect(requested).toEqual([1, 2, 3])
    expect(result.failedPages).toBe(1)
    expect(result.lastError).toBe(`${EMPTY_COUPON_PAGE}: 3`)
    expect(result.allPagesLoaded).toBe(false)
  })

  it('reads only page 1 when page 1 is empty', async () => {
    const { io, requested, stored } = fakeIo((n) => loaded(couponPage(n, [], counts)))
    const result = await readCouponPages(io)
    expect(requested).toEqual([1])
    expect(stored).toEqual([])
    expect(result.allPagesLoaded).toBe(false)
  })

  it('caps a runaway page count one page past what the total needs', async () => {
    const runaway = { totalPages: 100000, totalCoupons: 2 * PAGE_SIZE }
    const { io, requested } = fakeIo((n) => loaded(couponPage(n, idsOf(n), runaway)))
    await readCouponPages(io)
    expect(requested).toEqual([1, 2, 3])
  })

  it('is not full when ML reports fewer pages than its total needs', async () => {
    const short = { totalPages: 4, totalCoupons: 5 * PAGE_SIZE }
    const result = await readCouponPages(fakeIo((n) => loaded(couponPage(n, idsOf(n), short))).io)
    expect(result.failedPages).toBe(0)
    expect(result.allPagesLoaded).toBe(false)
  })

  it('is full when the coupons missing are just inside one page of slack', async () => {
    const repeats = (n: number) => loaded(couponPage(n, n === 4 ? ['3-0', '3-1', '4-0'] : idsOf(n), counts))
    const result = await readCouponPages(fakeIo(repeats).io)
    expect(result.seen).toBe(4 * PAGE_SIZE - (PAGE_SIZE - 1))
    expect(result.allPagesLoaded).toBe(true)
  })

  it('is not full when the coupons missing reach one page', async () => {
    const repeats = (n: number) => loaded(couponPage(n, idsOf(n === 4 ? 3 : n), counts))
    const result = await readCouponPages(fakeIo(repeats).io)
    expect(result.seen).toBe(3 * PAGE_SIZE)
    expect(result.failedPages).toBe(0)
    expect(result.allPagesLoaded).toBe(false)
  })

  it('counts a load failure as a failed page with its error and keeps reading', async () => {
    const { io, requested } = fakeIo((n) => (n === 2 ? { ok: false, error: 'Timeout 45000ms exceeded.' } : regular(n)))
    const result = await readCouponPages(io)
    expect(requested).toEqual([1, 2, 3, 4])
    expect(result.failedPages).toBe(1)
    expect(result.lastError).toBe('Timeout 45000ms exceeded.')
    expect(result.allPagesLoaded).toBe(false)
  })

  it('stops after the limit of unparseable pages in a row and keeps the parse error', async () => {
    const { io, requested } = fakeIo((n) => (n === 1 ? loaded(couponPage(1, idsOf(1), { totalPages: 10, totalCoupons: 30 })) : loaded({})))
    const result = await readCouponPages(io)
    expect(requested).toEqual(Array.from({ length: MAX_UNPARSED_PAGES_IN_ROW + 1 }, (_, i) => i + 1))
    expect(result.lastError).toBe(COUPON_PAGE_WITHOUT_DATA)
    expect(result.allPagesLoaded).toBe(false)
  })

  it('resets the unparseable count after a good page', async () => {
    const bad = new Set([2, 3, 5, 6])
    const { io, requested } = fakeIo((n) => (bad.has(n) ? loaded({}) : loaded(couponPage(n, idsOf(n), { totalPages: 7, totalCoupons: 21 }))))
    const result = await readCouponPages(io)
    expect(requested).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(result.failedPages).toBe(4)
  })

  it('reads nothing past page 1 when page 1 fails to load', async () => {
    const { io, requested } = fakeIo(() => ({ ok: false, error: 'net::ERR_TIMED_OUT' }))
    const result = await readCouponPages(io)
    expect(requested).toEqual([1])
    expect(result).toMatchObject({ allPagesLoaded: false, failedPages: 1, totalCoupons: 0, lastError: 'net::ERR_TIMED_OUT' })
  })

  it('counts entries without campaign_id as skipped, part of page 1 size, and makes the harvest not full', async () => {
    const withGap = (n: number): Loaded<PageProps> => {
      const page = couponPage(n, idsOf(n), counts)
      const data = page.filteredCouponsData as { rawCoupons: unknown[] }
      if (n === 1) data.rawCoupons[0] = {}
      return loaded(page)
    }
    const result = await readCouponPages(fakeIo(withGap).io)
    expect(result).toMatchObject({ skipped: 1, seen: 11, allPagesLoaded: false })
  })
})
