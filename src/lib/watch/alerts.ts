import { DAY_MS, PERCENT_BASE, WATCH_LOW_WINDOW_DAYS } from '../constants'
import { quotesPrice } from './listing-state'
import type { BestOffer, PricePoint, SentWatchAlert, WatchAlertDecision, WatchAlertKind, WatchListingView } from './types'

export interface AlertSettings { targetPriceCents: number | null; dropPercent: number }

export interface KnownListings { listings: readonly WatchListingView[]; knownIds: ReadonlySet<string> }

const MIN_HISTORY_DAYS = 1

function alreadySent(sent: SentWatchAlert[], kind: WatchAlertKind, priceCents: number): boolean {
  return sent.some((alert) => alert.kind === kind && alert.priceCents <= priceCents)
}

function pastPoints(history: PricePoint[], now: Date): PricePoint[] {
  return history.filter((point) => point.at.getTime() < now.getTime()).sort((left, right) => left.at.getTime() - right.at.getTime())
}

function hitsTarget(settings: AlertSettings, best: BestOffer): boolean {
  return settings.targetPriceCents !== null && best.finalCents <= settings.targetPriceCents
}

function windowPoints(points: PricePoint[], now: Date): PricePoint[] {
  const start = now.getTime() - WATCH_LOW_WINDOW_DAYS * DAY_MS
  const inside = points.filter((point) => point.at.getTime() >= start)
  const atStart = points.findLast((point) => point.at.getTime() <= start)
  return atStart && !inside.includes(atStart) ? [atStart, ...inside] : inside
}

function newLow(points: PricePoint[], best: BestOffer, now: Date): boolean {
  const earliest = points[0]
  if (!earliest || now.getTime() - earliest.at.getTime() < MIN_HISTORY_DAYS * DAY_MS) return false
  return windowPoints(points, now).every((point) => best.finalCents < point.finalCents)
}

function dropped(settings: AlertSettings, previousCents: number | null, offer: BestOffer | null): boolean {
  if (previousCents === null || offer === null || offer.finalCents >= previousCents) return false
  return offer.finalCents * PERCENT_BASE <= previousCents * (PERCENT_BASE - settings.dropPercent)
}

export function knownBest({ listings, knownIds }: KnownListings): BestOffer | null {
  let found: BestOffer | null = null
  for (const listing of listings) {
    if (!knownIds.has(listing.id) || !quotesPrice(listing)) continue
    if (found !== null && found.finalCents <= listing.finalCents) continue
    found = { listingId: listing.id, retailer: listing.retailer, merchant: listing.merchant, finalCents: listing.finalCents, url: listing.url }
  }
  return found
}

export function decideAlerts(
  settings: AlertSettings, best: BestOffer | null, history: PricePoint[], sent: SentWatchAlert[], now: Date, known?: KnownListings,
): WatchAlertDecision[] {
  if (!best) return []
  const points = pastPoints(history, now)
  const previousBestCents = points.at(-1)?.finalCents ?? null
  const knownOffer = known ? knownBest(known) : best
  const decided: [WatchAlertKind, BestOffer | null, boolean][] = [
    ['target', best, hitsTarget(settings, best)],
    ['low_30d', best, newLow(points, best, now)],
    ['drop', knownOffer, dropped(settings, previousBestCents, knownOffer)],
  ]
  return decided.flatMap(([kind, offer, fires]) => (
    fires && offer && !alreadySent(sent, kind, offer.finalCents) ? [{ kind, best: offer, previousBestCents }] : []
  ))
}
