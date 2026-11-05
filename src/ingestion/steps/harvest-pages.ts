import { tryParseCouponPage, type CouponPage, type CouponPageParse } from '../ml/coupons'
import type { PageProps } from '../ml/page-state'
import { failureTally, MAX_UNPARSED_PAGES_IN_ROW, type Loaded } from './breaker'
import {
  emptyPageEndsHarvest, FIRST_COUPON_PAGE, isFullHarvest, lastPageToRead, rawPageSize, type FirstPageTotals,
} from './coupon-pages'

export const WRONG_COUPON_PAGE = 'Página de cupons diferente da pedida'
export const EMPTY_COUPON_PAGE = 'Página de cupons vazia'

export interface HarvestIo {
  load(pageNumber: number): Promise<Loaded<PageProps>>
  store(coupons: CouponPage['coupons']): Promise<number>
}

export interface HarvestResult {
  allPagesLoaded: boolean
  pages: number
  seen: number
  inserted: number
  skipped: number
  unparsed: number
  totalCoupons: number
  failedPages: number
  lastError: string | null
  couponPages: ReadonlyMap<string, number>
}

function requestedPage(pageProps: PageProps, pageNumber: number): CouponPageParse {
  const parse = tryParseCouponPage(pageProps)
  if (!parse.ok || parse.page.pageNumber === pageNumber) return parse
  return { ok: false, error: `${WRONG_COUPON_PAGE}: pedida ${pageNumber}, recebida ${parse.page.pageNumber}` }
}

export async function readCouponPages(io: HarvestIo): Promise<HarvestResult> {
  const couponPages = new Map<string, number>()
  const unparsed = new Set<string>()
  let first: FirstPageTotals = { totalCoupons: 0, totalPages: 0, firstPageCount: 0 }
  let lastPage = FIRST_COUPON_PAGE
  let pages = 0
  let skipped = 0
  let inserted = 0
  let unparsedInRow = 0
  const tally = failureTally()
  for (let pageNumber = FIRST_COUPON_PAGE; pageNumber <= lastPage; pageNumber++) {
    pages += 1
    const loaded = await io.load(pageNumber)
    if (!loaded.ok) {
      tally.fail(loaded.error)
      continue
    }
    const parse = requestedPage(loaded.value, pageNumber)
    if (!parse.ok) {
      tally.fail(parse.error)
      unparsedInRow += 1
      if (unparsedInRow >= MAX_UNPARSED_PAGES_IN_ROW) break
      continue
    }
    unparsedInRow = 0
    const read = parse.page
    if (rawPageSize(read) === 0) {
      if (!emptyPageEndsHarvest(first, pageNumber)) tally.fail(`${EMPTY_COUPON_PAGE}: ${pageNumber}`)
      break
    }
    if (pageNumber === FIRST_COUPON_PAGE) {
      first = { totalCoupons: read.totalCoupons, totalPages: read.totalPages, firstPageCount: rawPageSize(read) }
      lastPage = lastPageToRead(first)
    }
    inserted += await io.store(read.coupons)
    skipped += read.skipped
    for (const { parsed } of read.coupons) {
      couponPages.set(parsed.campaignId, pageNumber)
      if (parsed.kind === 'unparsed') unparsed.add(parsed.campaignId)
    }
  }
  return {
    allPagesLoaded: isFullHarvest({ ...first, failedPages: tally.failed, seen: couponPages.size, skipped }),
    pages,
    seen: couponPages.size,
    inserted,
    skipped,
    unparsed: unparsed.size,
    totalCoupons: first.totalCoupons,
    failedPages: tally.failed,
    lastError: tally.lastError,
    couponPages,
  }
}
