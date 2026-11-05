import type { Page } from 'playwright'
import { discoveryTargets, markDiscoveryAttempt } from '@/db/coupons'
import { recordObservations } from '@/db/items'
import { sourceLinks } from '@/lib/observations'
import { cardsOfPage } from '../ml/cards'
import { loadWithRetry } from '../ml/page-state'
import type { LoadBreaker } from './breaker'
import { discoverListings, type DiscoverResult } from './discover-pages'

export type { DiscoverResult }

const NO_DISCOVERY: DiscoverResult = {
  pages: 0, read: 0, items: 0, failed: 0, empty: 0, couponLinks: 0, cards: 0, basisOther: 0, droppedCards: 0, itemIds: [], lastError: null,
}

export async function discover(page: Page, budgetPages: number, now: Date, breaker: LoadBreaker): Promise<DiscoverResult> {
  if (budgetPages <= 0) return { ...NO_DISCOVERY, itemIds: [] }
  const targets = await discoveryTargets(undefined, now)
  return discoverListings({
    load: (url) => breaker.load(() => loadWithRetry(page, url)),
    parse: cardsOfPage,
    record: (cards, coupons) => recordObservations(cards, { type: 'coupon', coupons }, now),
    linkCount: (cards, coupons) => sourceLinks(cards, { type: 'coupon', coupons }, now).length,
    markAttempt: (ids, succeeded) => markDiscoveryAttempt(ids, now, succeeded),
  }, targets, budgetPages)
}
