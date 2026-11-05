import { candidateOffers, type CandidateOffer } from '@/db/market-offers'
import { saveCheck, type PriceCheckRow } from '@/db/price-checks'
import { SITE_LABEL } from '@/lib/labels'
import { hasRetrievalTerms, retrievalTerms } from '@/lib/market/tokens'
import type { CompareOutcome, MarketCard, RetrievalTerms } from '@/lib/market/types'
import { compareQuery } from '@/lib/price-compare/clean-title'
import { matchCandidates, type Match } from '@/lib/price-compare/match'
import { checkKey, type CheckItem } from '@/lib/price-check-rules'

const KABUM_OWN_SELLER = 'kabum!'
const SINGLE_STORE = 1
const NO_SOURCE_URL = ''

export interface LocalMatchDeps {
  candidates: (terms: RetrievalTerms, finalCents: number, now: Date) => Promise<CandidateOffer[]>
  save: (row: PriceCheckRow) => Promise<void>
}

export const localMatchDeps: LocalMatchDeps = { candidates: candidateOffers, save: saveCheck }

export function storeName(offer: Pick<CandidateOffer, 'retailer' | 'seller'>): string {
  const store = SITE_LABEL[offer.retailer]
  const seller = offer.seller?.trim() ?? ''
  if (offer.retailer !== 'kabum' || seller === '' || seller.toLowerCase() === KABUM_OWN_SELLER) return store
  return `${store} (${seller})`
}

export function offerCard(offer: CandidateOffer): MarketCard {
  return {
    name: offer.title, brand: offer.brand, priceCents: offer.priceCents, store: storeName(offer), storeCount: SINGLE_STORE, url: offer.url,
  }
}

function cheapestUrl(match: Match, cards: readonly MarketCard[]): string {
  const cheapest = match.offers.find((offer) => offer.priceCents === match.marketLowCents && offer.store === match.marketStore)
  if (!cheapest) return NO_SOURCE_URL
  const card = cards.find((c) => c.name === cheapest.name && c.store === cheapest.store && c.priceCents === cheapest.priceCents)
  return card?.url ?? NO_SOURCE_URL
}

function localCheckRow(item: CheckItem, now: Date, cards: MarketCard[]): PriceCheckRow {
  const row: PriceCheckRow = {
    key: checkKey(item),
    itemId: item.id,
    checkedAt: now,
    status: 'no_match',
    query: compareQuery(item.title),
    confidence: null,
    mlPriceCents: item.finalCents,
    marketLowCents: null,
    secondLowCents: null,
    marketStore: null,
    storeCount: null,
    offers: [],
    sourceUrl: NO_SOURCE_URL,
    reason: null,
  }
  if (cards.length === 0) return row
  const match = matchCandidates(item.title, item.finalCents, cards)
  if (match.confidence === null) return row
  return {
    ...row,
    status: 'matched',
    confidence: match.confidence,
    marketLowCents: match.marketLowCents,
    secondLowCents: match.secondLowCents,
    marketStore: match.marketStore,
    storeCount: match.storeCount,
    offers: match.offers,
    sourceUrl: cheapestUrl(match, cards),
  }
}

export function outcomeOf(row: Pick<PriceCheckRow, 'status'>): CompareOutcome {
  return row.status === 'matched' ? 'matched' : 'no_match'
}

export async function localMatchRow(
  item: CheckItem, now: Date, candidates: LocalMatchDeps['candidates'] = candidateOffers,
): Promise<PriceCheckRow> {
  const terms = retrievalTerms(item.title)
  const offers = hasRetrievalTerms(terms) ? await candidates(terms, item.finalCents, now) : []
  return localCheckRow(item, now, offers.map(offerCard))
}

export async function matchItemLocally(item: CheckItem, now: Date, deps: LocalMatchDeps = localMatchDeps): Promise<CompareOutcome> {
  const row = await localMatchRow(item, now, deps.candidates)
  await deps.save(row)
  return outcomeOf(row)
}
