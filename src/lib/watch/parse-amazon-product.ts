import { AMAZON_ORIGIN } from '../constants'
import { amountCentsOf, decodeEntities, markerText } from '../market/html'
import { storableCents } from '../market/pages'
import { amazonFailure, parseAmazonSearch } from '../market/parse-amazon'
import { candidateOfOffer, fromMarketPage, sourceFailure, storableHtmlText } from './source-page'
import type { ListingCandidate, ListingQuote, SourcePage } from './types'

type PriceSpan = { classes: string[]; strike: boolean; cents: number | null }

const CORE_PRICE_AREAS = ['id="corePrice_feature_div"', 'id="corePriceDisplay_desktop_feature_div"']
const FEATURE_BOUNDARY = 'data-feature-name='
const TAG_END = '>'
const PRICE_SPANS = /<span class="([^"]*)"([^>]*)>\s*<span class="a-offscreen">([^<]*)<\/span>/g
const PRICE_CLASS = 'a-price'
const TEXT_PRICE_CLASS = 'a-text-price'
const STRIKE_ATTRIBUTE = 'data-a-strike="true"'
const WHITESPACE = /\s+/
const TITLE = /<span id="productTitle"[^>]*>([\s\S]*?)<\/span>/
const AVAILABILITY = /<div id="availability"[^>]*>([\s\S]*?)<\/div>/
const IN_STOCK_MARKER = 'em estoque'
const MERCHANT_INFO = 'offer-display-feature-name="desktop-merchant-info"'
const MERCHANT_TEXT = /class="[^"]*offer-display-feature-text-message[^"]*"[^>]*>([^<]+)</
const NO_PRICE_REASON = 'sem preço'
const OUT_OF_STOCK_REASON = 'sem estoque'
const NO_TITLE_REASON = 'sem título'
const DETAIL_PATH = '/dp/'

function areaOf(html: string, marker: string): string {
  const start = html.indexOf(marker)
  if (start === -1) return ''
  const end = html.indexOf(FEATURE_BOUNDARY, html.indexOf(TAG_END, start))
  return html.slice(start, end === -1 ? undefined : end)
}

function corePriceSpans(html: string): PriceSpan[] {
  for (const marker of CORE_PRICE_AREAS) {
    const spans = priceSpansOf(areaOf(html, marker))
    if (spans.length > 0) return spans
  }
  return []
}

function priceSpansOf(area: string): PriceSpan[] {
  return [...area.matchAll(PRICE_SPANS)]
    .map(([, classes, attributes, amount]) => ({
      classes: classes.split(WHITESPACE),
      strike: attributes.includes(STRIKE_ATTRIBUTE),
      cents: amountCentsOf(decodeEntities(amount)),
    }))
    .filter((span) => span.classes.includes(PRICE_CLASS) && span.cents !== null)
}

function inStockOf(html: string): boolean {
  const availability = html.match(AVAILABILITY)?.[1]
  return availability === undefined || markerText(availability).includes(IN_STOCK_MARKER)
}

function merchantOf(html: string): string | null {
  const start = html.indexOf(MERCHANT_INFO)
  const text = start === -1 ? undefined : html.slice(start).match(MERCHANT_TEXT)?.[1]
  return text ? storableHtmlText(text) || null : null
}

export function amazonProductUrl(asin: string): string {
  return `${AMAZON_ORIGIN}${DETAIL_PATH}${asin}`
}

export function parseAmazonCandidates(status: number, html: string): SourcePage<ListingCandidate[]> {
  return fromMarketPage(parseAmazonSearch(status, html), (offers) => offers.map((offer) => candidateOfOffer(offer, 'amazon')))
}

export function parseAmazonProduct(status: number, html: string, asin: string): SourcePage<ListingQuote> {
  const failure = amazonFailure(status, html)
  if (failure) return sourceFailure(failure.kind, failure.reason)
  const spans = corePriceSpans(html)
  const priceCents = spans.find((span) => !span.classes.includes(TEXT_PRICE_CLASS))?.cents ?? null
  const inStock = inStockOf(html)
  const titleHtml = html.match(TITLE)?.[1]
  const title = titleHtml ? storableHtmlText(titleHtml) : ''
  if (priceCents === null || !storableCents(priceCents)) {
    return inStock ? sourceFailure('unknown', NO_PRICE_REASON, title) : sourceFailure('empty', OUT_OF_STOCK_REASON, title)
  }
  if (!title) return sourceFailure('unknown', NO_TITLE_REASON)
  const listPriceCents = spans.find((span) => span.classes.includes(TEXT_PRICE_CLASS) && span.strike)?.cents ?? null
  return {
    kind: 'ok',
    value: {
      ref: asin,
      merchant: merchantOf(html),
      title,
      priceCents,
      listPriceCents: listPriceCents !== null && listPriceCents > priceCents && storableCents(listPriceCents) ? listPriceCents : null,
      finalCents: priceCents,
      inStock,
    },
  }
}
