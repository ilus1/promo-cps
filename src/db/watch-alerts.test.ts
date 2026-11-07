import { beforeEach, expect, test, vi } from 'vitest'
import { HOUR_MS } from '@/lib/constants'
import { decideAlerts } from '@/lib/watch/alerts'
import type { BestOffer, PricePoint } from '@/lib/watch/types'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb } from './__fixtures__/fake-db'
import { bestHistory, bestSteps, knownListingsOf, logAlert, sentAlerts, type ListingSegment } from './watch-alerts'

const PRODUCT = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const LISTING = '1b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f12'
const KABUM = 'a1'
const AMAZON = 'a2'
const AMERICANAS = 'a3'
const BASE = Date.UTC(2026, 10, 6)
const DAY_HOURS = 24
const SETTINGS = { targetPriceCents: null, dropPercent: 10 }
const at = (hour: number) => new Date(BASE + hour * HOUR_MS)
const day = (days: number) => days * DAY_HOURS
const kinds = (decisions: { kind: string }[]) => decisions.map((decision) => decision.kind)
const steps = (points: PricePoint[]) => points.map((point) => [point.finalCents, (point.at.getTime() - BASE) / HOUR_MS])
const offer = (listingId: string, finalCents: number): BestOffer => ({ listingId, retailer: 'kabum', merchant: null, finalCents, url: 'u' })

type ListingNow = ListingSegment['listing']
const quoting = (finalCents: number, checkedHour: number): ListingNow => ({
  inStock: true, finalCents, lastError: null, checkedAt: at(checkedHour), unavailableSince: null,
})
const outOfStock = (finalCents: number, sinceHour: number, checkedHour = sinceHour): ListingNow => ({
  inStock: false, finalCents, lastError: null, checkedAt: at(checkedHour), unavailableSince: at(sinceHour),
})
const failing = (finalCents: number, sinceHour: number): ListingNow => ({
  inStock: true, finalCents, lastError: 'HTTP 503', checkedAt: at(sinceHour), unavailableSince: at(sinceHour),
})
const listing = (listingId: string, now: ListingNow, ...prices: [finalCents: number, fromHour: number, endedHour?: number][]): ListingSegment[] =>
  prices.map(([finalCents, fromHour, endedHour]) => ({
    listingId, finalCents, firstSeenAt: at(fromHour), endedAt: endedHour === undefined ? null : at(endedHour), listing: now,
  }))

beforeEach(resetFakeDb)

test('a price counts until the listing quotes another one, giving one point per change', () => {
  expect(steps(bestSteps(listing(KABUM, quoting(90, 9), [100, 0], [90, 6]), at(0)))).toEqual([[100, 0], [90, 6]])
})

test('across listings the best is the lowest quoted price, and it rises when the cheaper one stops quoting', () => {
  const segments = [
    ...listing(KABUM, outOfStock(100, 9), [100, 0]),
    ...listing(AMAZON, failing(80, 6), [80, 3]),
    ...listing(AMERICANAS, quoting(120, 12), [120, 1]),
  ]
  expect(steps(bestSteps(segments, at(0)))).toEqual([[100, 0], [80, 3], [100, 6], [120, 9]])
})

test('an unchanged best adds no point, and a time with nothing quoting adds none either', () => {
  const segments = [
    ...listing(KABUM, outOfStock(100, 3), [100, 0]),
    ...listing(AMAZON, quoting(100, 9), [100, 6]),
    ...listing(AMERICANAS, outOfStock(150, 2), [150, 1]),
  ]
  expect(steps(bestSteps(segments, at(0)))).toEqual([[100, 0]])
})

test('a price seen before the window counts from the window start, and one that stopped before it does not count', () => {
  const segments = [...listing(KABUM, quoting(100, 9), [100, 0]), ...listing(AMAZON, outOfStock(80, 4), [80, 0])]
  expect(steps(bestSteps(segments, at(5)))).toEqual([[100, 5]])
})

test('a listing that stopped quoting counts until the first check that found it so, not until its latest check', () => {
  const segments = [...listing(KABUM, outOfStock(80, 3, 12), [80, 0]), ...listing(AMAZON, quoting(100, 12), [100, 0])]
  expect(steps(bestSteps(segments, at(0), at(12)))).toEqual([[80, 0], [100, 3]])
})

test('before excludes the current check, so the history ends with the previous best', () => {
  const segments = listing(KABUM, quoting(80, 9), [100, 0], [80, 9])
  expect(steps(bestSteps(segments, at(0), at(9)))).toEqual([[100, 0]])
  expect(steps(bestSteps(segments, at(0)))).toEqual([[100, 0], [80, 9]])
})

test('no segments give no history', () => {
  expect(bestSteps([], at(0))).toEqual([])
})

test('stores checked at different times with unchanged prices keep the best flat, so there is no drop', async () => {
  queueRows([
    [PRODUCT, KABUM, 8000, at(0).toISOString(), null, true, 8000, null, at(24).toISOString(), null],
    [PRODUCT, AMAZON, 10000, at(0).toISOString(), null, true, 10000, null, at(25).toISOString(), null],
    [PRODUCT, AMERICANAS, 12000, at(0).toISOString(), null, true, 12000, null, at(26).toISOString(), null],
  ])
  const history = await bestHistory(PRODUCT, at(0), at(26))
  expect(steps(history)).toEqual([[8000, 0]])
  expect(decideAlerts(SETTINGS, offer(KABUM, 8000), history, [], at(26))).toEqual([])
  const [select] = captured
  expect(select.sql).toBe('select "watched_listings"."product_id", "listing_price_segments"."listing_id", "listing_price_segments"."final_cents", '
    + '"listing_price_segments"."first_seen_at", "listing_price_segments"."ended_at", "watched_listings"."in_stock", "watched_listings"."final_cents", "watched_listings"."last_error", "watched_listings"."checked_at", '
    + '"watched_listings"."unavailable_since" '
    + 'from "listing_price_segments" inner join "watched_listings" on "watched_listings"."id" = "listing_price_segments"."listing_id" '
    + 'where ("watched_listings"."product_id" in ($1) and "watched_listings"."removed" = false and ("listing_price_segments"."last_seen_at" >= $2 '
    + 'or "listing_price_segments"."last_seen_at" = (select max("last_seen_at") from "listing_price_segments" "earlier" '
    + 'where ("earlier"."listing_id" = "listing_price_segments"."listing_id" and "earlier"."last_seen_at" < $3))))')
  expect(select.params).toEqual([PRODUCT, at(0).toISOString(), at(0).toISOString()])
})

test('when this check changed the best, the previous best is the one before it, and the drop is measured from it', () => {
  const segments = [
    ...listing(KABUM, quoting(85, 9.5), [100, 0], [85, 9.5]),
    ...listing(AMAZON, quoting(120, 9), [120, 0]),
    ...listing(AMERICANAS, quoting(150, 0), [150, 0]),
  ]
  const now = at(9.5)
  const history = bestSteps(segments, at(0), now)
  expect(steps(history)).toEqual([[100, 0]])
  expect(decideAlerts(SETTINGS, offer(KABUM, 85), history, [], now)).toEqual([{ kind: 'drop', best: offer(KABUM, 85), previousBestCents: 100 }])
  expect(steps(bestSteps(segments, at(0)))).toEqual([[100, 0], [85, 9.5]])
})

test('when this check left the best unchanged, the last point is the earlier one equal to the current best', () => {
  const segments = [...listing(KABUM, quoting(100, 9), [100, 0]), ...listing(AMAZON, quoting(120, 9), [120, 3])]
  expect(steps(bestSteps(segments, at(0), at(9)))).toEqual([[100, 0]])
})

test('a merchant that left the page at c1 and is marked gone again at c2 stops counting at c1, so the drop at c2 is measured from 100', () => {
  const [c1, c2] = [3, 6]
  const segments = [...listing(KABUM, outOfStock(80, c1, c2), [80, 0]), ...listing(AMAZON, quoting(85, c2), [100, 0], [85, c2])]
  const history = bestSteps(segments, at(0), at(c2))
  expect(steps(history)).toEqual([[80, 0], [100, c1]])
  expect(decideAlerts(SETTINGS, offer(AMAZON, 85), history, [], at(c2))).toEqual([{ kind: 'drop', best: offer(AMAZON, 85), previousBestCents: 100 }])
})

test('a listing out of stock for many checks leaves the history when it first went out, so it does not pin the 30-day low', () => {
  const now = at(day(40))
  const segments = [
    ...listing(KABUM, outOfStock(80, day(1), day(40) - 1), [80, 0]),
    ...listing(AMAZON, quoting(90, day(40)), [100, 0], [90, day(40)]),
  ]
  const history = bestSteps(segments, at(day(10)), now)
  expect(steps(history)).toEqual([[100, day(10)]])
  expect(kinds(decideAlerts(SETTINGS, offer(AMAZON, 90), history, [], now))).toEqual(['low_30d', 'drop'])
})

test('a listing back in stock at the same price after a gap keeps one open segment, so there is no false drop or low', () => {
  const now = at(day(3))
  const segments = [...listing(KABUM, quoting(80, day(3)), [80, 0]), ...listing(AMAZON, quoting(100, day(3)), [100, 0])]
  const history = bestSteps(segments, at(0), now)
  expect(steps(history)).toEqual([[80, 0]])
  expect(decideAlerts(SETTINGS, offer(KABUM, 80), history, [], now)).toEqual([])
})

test('an error and then a different price keep the earlier price through the error, and the drop is measured from it', () => {
  const segments = [...listing(KABUM, quoting(90, 6), [100, 0], [90, 6]), ...listing(AMAZON, quoting(120, 6), [120, 0])]
  const history = bestSteps(segments, at(0), at(6))
  expect(steps(history)).toEqual([[100, 0]])
  expect(decideAlerts(SETTINGS, offer(KABUM, 90), history, [], at(6))).toEqual([{ kind: 'drop', best: offer(KABUM, 90), previousBestCents: 100 }])
})

test('an error and then a 5% move are measured from the price before the error, not from the second-best store', () => {
  const now = at(day(3))
  const segments = [...listing(KABUM, quoting(95, day(3)), [100, 0], [95, day(3)]), ...listing(AMAZON, quoting(120, day(3)), [120, 0])]
  const history = bestSteps(segments, at(0), now)
  expect(steps(history)).toEqual([[100, 0]])
  expect(kinds(decideAlerts(SETTINGS, offer(KABUM, 95), history, [], now))).toEqual(['low_30d'])
})

test('an out-of-stock spell and then a different price drop the old price from the spell on, so a later drop is a 30-day low', () => {
  const now = at(day(40))
  const segments = [
    ...listing(KABUM, quoting(6000, day(40)), [5000, 0, day(6)], [9000, day(20)], [6000, day(40)]),
    ...listing(AMAZON, quoting(10000, day(40)), [10000, 0]),
  ]
  const history = bestSteps(segments, at(day(10)), now)
  expect(steps(history)).toEqual([[10000, day(10)], [9000, day(20)]])
  expect(kinds(decideAlerts(SETTINGS, offer(KABUM, 6000), history, [], now))).toEqual(['low_30d', 'drop'])
})

test('sent alerts come newest first', async () => {
  queueRows([['drop', 17000, at(9).toISOString()], ['target', 18000, at(3).toISOString()]])
  expect(await sentAlerts(PRODUCT)).toEqual([{ kind: 'drop', priceCents: 17000, sentAt: at(9) }, { kind: 'target', priceCents: 18000, sentAt: at(3) }])
  expect(captured[0].sql).toMatch(/where "watch_alerts"\."product_id" = \$1 order by "watch_alerts"\."sent_at" desc$/)
})

test('an alert is logged once per product, kind and price', async () => {
  queueRows([['x']], [])
  expect(await logAlert(PRODUCT, 'target', 15000, LISTING, at(9))).toBe(true)
  expect(await logAlert(PRODUCT, 'target', 15000, LISTING, at(10))).toBe(false)
  expect(captured[0].sql).toMatch(/on conflict do nothing returning "id"$/)
  expect(captured[0].params).toEqual([PRODUCT, 'target', 15000, LISTING, at(9).toISOString()])
})

test('a listing is known when one of its segments started before this evaluation; a first quote at now is not', () => {
  const now = at(9)
  const known = knownListingsOf([
    { listingId: 'old', finalCents: 100, firstSeenAt: at(1), endedAt: at(3), listing: { inStock: false, finalCents: 100, lastError: null, checkedAt: at(3), unavailableSince: at(3) } },
    { listingId: 'old', finalCents: 90, firstSeenAt: now, endedAt: null, listing: { inStock: true, finalCents: 90, lastError: null, checkedAt: now, unavailableSince: null } },
    { listingId: 'fresh', finalCents: 80, firstSeenAt: now, endedAt: null, listing: { inStock: true, finalCents: 80, lastError: null, checkedAt: now, unavailableSince: null } },
  ], now)
  expect([...known]).toEqual(['old'])
})

test('a listing whose segments never held the best price is still known once one started before this evaluation', () => {
  const now = at(9)
  const segments: ListingSegment[] = [
    { listingId: 'cheap', finalCents: 80, firstSeenAt: at(1), endedAt: null, listing: { inStock: true, finalCents: 80, lastError: null, checkedAt: at(8), unavailableSince: null } },
    { listingId: 'pricey', finalCents: 120, firstSeenAt: at(2), endedAt: null, listing: { inStock: true, finalCents: 120, lastError: null, checkedAt: at(8), unavailableSince: null } },
  ]
  expect(bestSteps(segments, at(0), now).every((step) => step.finalCents === 80)).toBe(true)
  expect([...knownListingsOf(segments, now)].sort()).toEqual(['cheap', 'pricey'])
})
