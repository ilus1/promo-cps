import { safeMlUrl } from '@/lib/ml-url'
import { isRecord } from '@/lib/records'
import { cardsOfResults, mergeCards, type ListingCards } from './cards'
import { INITIAL_STATE_KEY, RESULTS_KEY } from './page-keys'
import { at, text } from './readers'

export const SEARCH_RESULTS_MISSING = 'Busca sem resultados no estado da página'

export class SearchResultsMissing extends Error {
  constructor() {
    super(SEARCH_RESULTS_MISSING)
  }
}

const RESPONSE_PATHS: readonly (readonly string[])[] = [
  ['getResultsPromise', 'value', 'optimizedResponse'],
  ['getResultsPromise', 'value', 'sharedState', 'search'],
  [INITIAL_STATE_KEY],
]
const PAGINATION_KEY = 'pagination'
const NEXT_PAGE_KEY = 'next_page'
const NEXT_PAGE_SHOWN_KEY = 'show'
const NEXT_PAGE_URL_KEY = 'url'

export interface SearchPage extends ListingCards {
  nextUrl: string | null
}

function nextPageUrl(response: Record<string, unknown>, ownHost: string): string | null {
  const next = at(response, [PAGINATION_KEY, NEXT_PAGE_KEY])
  if (!isRecord(next) || next[NEXT_PAGE_SHOWN_KEY] !== true) return null
  const url = text(next[NEXT_PAGE_URL_KEY])
  const safe = url === null ? null : safeMlUrl(url)
  return safe !== null && new URL(safe).hostname === ownHost ? safe : null
}

export function readSearchPage(pageProps: unknown, searchUrl: string): SearchPage {
  const responses = RESPONSE_PATHS.map((path) => at(pageProps, path)).filter(isRecord)
  const withResults = responses.filter((response) => Array.isArray(response[RESULTS_KEY]))
  if (withResults.length === 0) throw new SearchResultsMissing()
  const reads = withResults.map((response) => cardsOfResults(response[RESULTS_KEY] as unknown[]))
  const ownHost = new URL(searchUrl).hostname
  return {
    cards: mergeCards(reads.flatMap((read) => read.cards)),
    found: Math.max(...reads.map((read) => read.found)),
    dropped: Math.max(...reads.map((read) => read.dropped)),
    nextUrl: responses.map((response) => nextPageUrl(response, ownHost)).find((url) => url !== null) ?? null,
  }
}
