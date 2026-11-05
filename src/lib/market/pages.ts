import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVICE_UNAVAILABLE, HTTP_TOO_MANY_REQUESTS } from '../http-status'
import type { MarketOffer, PageKind } from './types'

export type FailedPage = { kind: Exclude<PageKind, 'results'>; reason: string }

const WALL_STATUSES: ReadonlySet<number> = new Set([HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS, HTTP_SERVICE_UNAVAILABLE])
const NO_RESPONSE_STATUS = 0
const NO_RESPONSE_REASON = 'sem resposta'
const NUL = /\u0000/g
const MIN_CENTS = 1
const MAX_CENTS = 2_147_483_647

export function failed(kind: FailedPage['kind'], reason: string): FailedPage {
  return { kind, reason }
}

export function statusFailure(status: number): FailedPage | null {
  if (status === HTTP_OK) return null
  if (status === NO_RESPONSE_STATUS) return failed('unknown', NO_RESPONSE_REASON)
  const reason = `HTTP ${status}`
  if (WALL_STATUSES.has(status)) return failed('wall', reason)
  return failed(status === HTTP_NOT_FOUND ? 'missing' : 'unknown', reason)
}

function withoutNul(text: string): string {
  return text.replace(NUL, '')
}

function filledOrNull(text: string | null): string | null {
  const cleaned = text === null ? '' : withoutNul(text)
  return cleaned === '' ? null : cleaned
}

function storableCents(cents: number): boolean {
  return Number.isInteger(cents) && cents >= MIN_CENTS && cents <= MAX_CENTS
}

function storableOptionalCents(cents: number | null): boolean {
  return cents === null || storableCents(cents)
}

function storableOffer(offer: MarketOffer): MarketOffer | null {
  const title = withoutNul(offer.title)
  const url = withoutNul(offer.url)
  if (!title || !url || !storableCents(offer.priceCents)) return null
  if (!storableOptionalCents(offer.listPriceCents) || !storableOptionalCents(offer.regularPriceCents)) return null
  if (offer.priceUntil !== null && Number.isNaN(offer.priceUntil.getTime())) return null
  return { ...offer, title, url, brand: filledOrNull(offer.brand), seller: filledOrNull(offer.seller) }
}

export function storableOffers(offers: (MarketOffer | null)[]): MarketOffer[] {
  const byListing = new Map<string, MarketOffer>()
  for (const offer of offers) {
    const storable = offer && storableOffer(offer)
    if (storable && !byListing.has(storable.listingId)) byListing.set(storable.listingId, storable)
  }
  return [...byListing.values()]
}
