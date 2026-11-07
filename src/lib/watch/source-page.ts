import { textOf } from '../market/html'
import type { MarketOffer, ParsedPage } from '../market/types'
import { storableText } from '../storable-text'
import type { ListingCandidate, ListingQuote, SourcePage, SourcePageFailure, WatchRetailer } from './types'

const WHITESPACE_RUNS = /\s+/g
const SPACE = ' '

export function storableHtmlText(html: string): string {
  return storableText(textOf(html)).replace(WHITESPACE_RUNS, SPACE).trim()
}

export function sourceFailure(kind: SourcePageFailure, reason: string, title?: string | null): SourcePage<never> {
  return title ? { kind, reason, title } : { kind, reason }
}

export function fromMarketPage<Extra, Value>(page: ParsedPage<Extra>, map: (offers: MarketOffer[]) => Value): SourcePage<Value> {
  return page.kind === 'results' ? { kind: 'ok', value: map(page.offers) } : sourceFailure(page.kind, page.reason)
}

export function candidateOfOffer(offer: MarketOffer, retailer: WatchRetailer): ListingCandidate {
  return {
    retailer,
    ref: offer.listingId,
    url: offer.url,
    title: offer.title,
    ean: null,
    merchant: offer.seller,
    priceCents: offer.priceCents,
    listPriceCents: offer.listPriceCents,
    inStock: offer.inStock,
  }
}

export function quoteOfOffer(offer: MarketOffer): ListingQuote {
  return {
    ref: offer.listingId,
    merchant: offer.seller,
    title: offer.title,
    priceCents: offer.priceCents,
    listPriceCents: offer.listPriceCents,
    finalCents: offer.priceCents,
    inStock: offer.inStock,
  }
}
