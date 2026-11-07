import { KABUM_ORIGIN } from '../constants'
import { parseKabumListing } from '../market/parse-kabum'
import { candidateOfOffer, fromMarketPage } from './source-page'
import type { ListingCandidate, SourcePage } from './types'

const SEARCH_PATH = '/busca'
const SEARCH_SEPARATOR = /\s+/
const SEARCH_JOINER = '-'
const NO_PAGE_URL = ''

export function kabumSearchUrl(query: string): string {
  return `${KABUM_ORIGIN}${SEARCH_PATH}/${query.trim().split(SEARCH_SEPARATOR).filter(Boolean).map(encodeURIComponent).join(SEARCH_JOINER)}`
}

export function parseKabumSearch(status: number, html: string, now: Date): SourcePage<ListingCandidate[]> {
  return fromMarketPage(parseKabumListing(status, html, NO_PAGE_URL, now), (offers) => offers.map((offer) => candidateOfOffer(offer, 'kabum')))
}
