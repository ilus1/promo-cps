import { amazonSearchUrl } from '@/lib/market/parse-amazon'
import { amazonProductUrl, parseAmazonCandidates, parseAmazonProduct } from '@/lib/watch/parse-amazon-product'
import {
  americanasEanUrl, americanasLinkUrl, americanasRefreshUrl, americanasSearchUrl, parseAmericanasQuote, parseAmericanasSearch,
} from '@/lib/watch/parse-americanas'
import { buscapeProductUrl, buscapeSearchUrl, parseBuscapeProduct, parseBuscapeSearch } from '@/lib/watch/parse-buscape'
import { kabumProductUrl, parseKabumProduct } from '@/lib/watch/parse-kabum-product'
import { kabumSearchUrl, parseKabumSearch } from '@/lib/watch/parse-kabum-search'
import type { ListingCandidate, ListingQuote, SourcePage } from '@/lib/watch/types'
import type { FetchedPage } from '../market/fetched-page'
import type { ChromePool } from './chrome-pool'
import { ML_BUSY, type GateResult, type SiteGate, type WatchSite } from './site-gate'

export interface SourceIo {
  gate: SiteGate
  http: (url: string) => Promise<FetchedPage>
  chrome: Pick<ChromePool, 'load' | 'close'>
  now: () => Date
}

export type Candidates = GateResult<ListingCandidate[]>
export type Quote = GateResult<ListingQuote>

export interface WatchSources {
  americanasByEan(ean: string): Promise<Candidates>
  americanasByText(query: string): Promise<Candidates>
  americanasLink(slug: string): Promise<Candidates>
  americanasQuote(ref: string): Promise<Quote>
  amazonSearch(query: string): Promise<Candidates>
  amazonQuote(asin: string): Promise<Quote>
  kabumSearch(query: string): Promise<Candidates>
  kabumQuote(code: string): Promise<Quote>
  buscapeSearch(query: string): Promise<Candidates>
  buscapeQuotes(ref: string, productName: string | null): Promise<GateResult<ListingQuote[]>>
}

const NO_SCROLL = false
const SETTLE_SCROLL = true

export function watchSources({ gate, http, chrome, now }: SourceIo): WatchSources {
  const americanas = (url: string) => gate.request('americanas', 'http', () => http(url), (page) => parseAmericanasSearch(page.status, page.html))
  async function viaChrome<Value>(
    site: WatchSite, url: string, scroll: boolean, parse: (page: FetchedPage) => SourcePage<Value>,
  ): Promise<GateResult<Value>> {
    const result = await gate.request(site, 'chrome', () => chrome.load(url, scroll), parse)
    if (result.kind === 'skipped' && result.reason === ML_BUSY) await chrome.close()
    return result
  }
  return {
    americanasByEan: (ean) => americanas(americanasEanUrl(ean)),
    americanasByText: (query) => americanas(americanasSearchUrl(query)),
    americanasLink: (slug) => americanas(americanasLinkUrl(slug)),
    americanasQuote: (ref) => gate.request(
      'americanas', 'http', () => http(americanasRefreshUrl(ref)), (page) => parseAmericanasQuote(page.status, page.html, ref),
    ),
    amazonSearch: (query) => viaChrome('amazon', amazonSearchUrl(query), NO_SCROLL, (page) => parseAmazonCandidates(page.status, page.html)),
    amazonQuote: (asin) => viaChrome('amazon', amazonProductUrl(asin), NO_SCROLL, (page) => parseAmazonProduct(page.status, page.html, asin)),
    kabumSearch: (query) => viaChrome('kabum', kabumSearchUrl(query), SETTLE_SCROLL, (page) => parseKabumSearch(page.status, page.html, now())),
    kabumQuote: (code) => gate.request(
      'kabum', 'http', () => http(kabumProductUrl(code)), (page) => parseKabumProduct(page.status, page.html, now()),
    ),
    buscapeSearch: (query) => gate.request(
      'buscape', 'http', () => http(buscapeSearchUrl(query)), (page) => parseBuscapeSearch(page.status, page.html),
    ),
    buscapeQuotes: (ref, productName) => gate.request(
      'buscape', 'http', () => http(buscapeProductUrl(ref)), (page) => parseBuscapeProduct(page.status, page.html, productName ?? undefined),
    ),
  }
}
