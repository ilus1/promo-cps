import { AMAZON_ORIGIN, AMAZON_SEARCH_URL } from '../constants'
import { amountCentsOf, decodeEntities, markerText, textOf } from './html'
import { failed, statusFailure, storableOffers, type FailedPage } from './pages'
import type { AmazonBestsellerExtra, AmazonSearchExtra, MarketOffer, OfferSource, ParsedPage } from './types'

type Card = { asin: string; markup: string }
type CardPrices = { priceCents: number | null; listPriceCents: number | null }
type PriceSpan = { classes: string[]; strike: boolean; cents: number | null }

const CAPTCHA_MARKERS = ['validatecaptcha', 'digite os caracteres']
const ERROR_MARKER = 'algo deu errado'
const EMPTY_MARKER = 'nenhum resultado para'
const CAPTCHA_REASON = 'captcha'
const ERROR_REASON = 'página de erro'
const EMPTY_REASON = 'nenhum resultado'
const UNKNOWN_REASON = 'página desconhecida'
const NO_DEPARTMENTS_REASON = 'sem departamentos'
const UNREADABLE_CARDS_REASON = 'cards ilegíveis'
const PAGINATION_MARKER = 'data-component-type="s-pagination"'
const SEARCH_CARD = /<div\b[^>]*\bdata-component-type="s-search-result"[^>]*>/g
const BESTSELLER_CARD = /<div\b[^>]*\bdata-asin="[^"]*"[^>]*>/g
const ASIN_ATTRIBUTE = /\bdata-asin="([A-Z0-9]{10})"/
const HEADING = /<h2\b[^>]*>([\s\S]*?)<\/h2>/
const OFFSCREEN_PRICE = /<span class="([^"]*)"([^>]*)>\s*<span class="a-offscreen">([^<]*)<\/span>/g
const BESTSELLER_TITLE = /<div class="[^"]*p13n-sc-css-line-clamp[^"]*"[^>]*>([\s\S]*?)<\/div>/
const BESTSELLER_PRICE = /<span class="[^"]*p13n-sc-price[^"]*"[^>]*>([\s\S]*?)<\/span>/
const PRICE_CLASS = 'a-price'
const TEXT_PRICE_CLASS = 'a-text-price'
const STRIKE_ATTRIBUTE = 'data-a-strike="true"'
const WHITESPACE = /\s+/
const QUERY_JOINER = '+'
const HREF = /\bhref="([^"]*)"/g
const REF_SEGMENT = /\/ref=[^/?#]*/
const TRAILING_SLASHES = /\/+(?=\?|#|$)/
const QUERY_START = /[?#]/
const PAGE_PARAM = /[?&]pg=(\d+)/
const BESTSELLERS_PATH = '/gp/bestsellers'
const NODE_PATH = /^\/gp\/bestsellers\/[a-z0-9_-]+\/\d+$/
const DEPARTMENT_PATH = /^\/gp\/bestsellers\/[a-z][a-z0-9_-]*$/
const DETAIL_PATH = '/dp/'
const FIRST_PAGE = 1
const NEXT_PAGE = 2

function amazonFailure(status: number, html: string): FailedPage | null {
  const failure = statusFailure(status)
  if (failure) return failure
  const text = markerText(html)
  if (CAPTCHA_MARKERS.some((marker) => text.includes(marker))) return failed('wall', CAPTCHA_REASON)
  if (text.includes(ERROR_MARKER)) return failed('wall', ERROR_REASON)
  return text.includes(EMPTY_MARKER) ? failed('empty', EMPTY_REASON) : null
}

function lastCardEnd(html: string, lastStart: number, stopMarker: string | null): number {
  const stop = stopMarker === null ? -1 : html.indexOf(stopMarker, lastStart)
  return stop === -1 ? html.length : stop
}

function cardsOf(html: string, start: RegExp, stopMarker: string | null): Card[] {
  const starts = [...html.matchAll(start)]
  return starts.flatMap((match, index) => {
    const asin = match[0].match(ASIN_ATTRIBUTE)?.[1]
    const end = starts[index + 1]?.index ?? lastCardEnd(html, match.index, stopMarker)
    return asin ? [{ asin, markup: html.slice(match.index, end) }] : []
  })
}

function priceSpansOf(markup: string): PriceSpan[] {
  return [...markup.matchAll(OFFSCREEN_PRICE)]
    .map(([, classes, attributes, amount]) => ({
      classes: classes.split(WHITESPACE),
      strike: attributes.includes(STRIKE_ATTRIBUTE),
      cents: amountCentsOf(decodeEntities(amount)),
    }))
    .filter((span) => span.classes.includes(PRICE_CLASS))
}

function searchPricesOf(markup: string): CardPrices {
  const spans = priceSpansOf(markup)
  return {
    priceCents: spans.find((span) => !span.classes.includes(TEXT_PRICE_CLASS))?.cents ?? null,
    listPriceCents: spans.find((span) => span.classes.includes(TEXT_PRICE_CLASS) && span.strike)?.cents ?? null,
  }
}

function bestsellerPricesOf(markup: string): CardPrices {
  const price = markup.match(BESTSELLER_PRICE)?.[1]
  return { priceCents: price ? amountCentsOf(textOf(price)) : null, listPriceCents: null }
}

function offerOf(asin: string, title: string | undefined, prices: CardPrices, source: OfferSource): MarketOffer | null {
  const name = title ? textOf(title) : ''
  const { priceCents, listPriceCents } = prices
  if (!name || priceCents === null) return null
  return {
    retailer: 'amazon',
    listingId: asin,
    title: name,
    brand: null,
    seller: null,
    priceCents,
    listPriceCents: listPriceCents !== null && listPriceCents > priceCents ? listPriceCents : null,
    regularPriceCents: null,
    priceUntil: null,
    inStock: true,
    url: `${AMAZON_ORIGIN}${DETAIL_PATH}${asin}`,
    source,
  }
}

function searchOffersOf(cards: Card[]): MarketOffer[] {
  return storableOffers(cards
    .map(({ asin, markup }) => offerOf(asin, markup.match(HEADING)?.[1], searchPricesOf(markup), 'amazon_search')))
}

function bestsellerOffersOf(html: string): MarketOffer[] {
  return storableOffers(cardsOf(html, BESTSELLER_CARD, null)
    .map(({ asin, markup }) => offerOf(asin, markup.match(BESTSELLER_TITLE)?.[1], bestsellerPricesOf(markup), 'amazon_bestsellers')))
}

function bestsellersLink(href: string): string | null {
  const absolute = href.startsWith('/') ? `${AMAZON_ORIGIN}${href}` : href
  if (!absolute.startsWith(`${AMAZON_ORIGIN}${BESTSELLERS_PATH}`)) return null
  return absolute.replace(REF_SEGMENT, '').replace(TRAILING_SLASHES, '')
}

function pathOf(link: string): string {
  return link.slice(AMAZON_ORIGIN.length).split(QUERY_START)[0]
}

function bestsellersLinksOf(html: string): string[] {
  return [...html.matchAll(HREF)].map(([, href]) => bestsellersLink(decodeEntities(href))).filter((link) => link !== null)
}

function pathsLike(links: string[], shape: RegExp, except: string | null): string[] {
  const paths = links.map(pathOf).filter((path) => shape.test(path) && path !== except)
  return [...new Set(paths)].map((path) => `${AMAZON_ORIGIN}${path}`)
}

function pageNumberOf(url: string): number {
  return Number(url.match(PAGE_PARAM)?.[1] ?? FIRST_PAGE)
}

function nextPageOf(links: string[], url: string, ownPath: string | null): string | null {
  if (pageNumberOf(url) !== FIRST_PAGE) return null
  return links.find((link) => pageNumberOf(link) === NEXT_PAGE && pathOf(link) === ownPath) ?? null
}

export function amazonSearchUrl(query: string): string {
  return `${AMAZON_SEARCH_URL}${query.split(WHITESPACE).filter(Boolean).map(encodeURIComponent).join(QUERY_JOINER)}`
}

export function amazonBestsellersRootUrl(): string {
  return `${AMAZON_ORIGIN}${BESTSELLERS_PATH}/`
}

export function parseAmazonSearch(status: number, html: string): ParsedPage<AmazonSearchExtra> {
  const failure = amazonFailure(status, html)
  if (failure) return failure
  const cards = cardsOf(html, SEARCH_CARD, PAGINATION_MARKER)
  if (cards.length === 0) return failed('unknown', UNKNOWN_REASON)
  const offers = searchOffersOf(cards)
  if (offers.length === 0) return failed('unknown', UNREADABLE_CARDS_REASON)
  return { kind: 'results', offers, extra: { resultCount: new Set(cards.map((card) => card.asin)).size } }
}

export function parseAmazonBestsellers(status: number, html: string, url: string): ParsedPage<AmazonBestsellerExtra> {
  const failure = amazonFailure(status, html)
  if (failure) return failure
  const offers = bestsellerOffersOf(html)
  if (offers.length === 0) return failed('unknown', UNKNOWN_REASON)
  const links = bestsellersLinksOf(html)
  const ownLink = bestsellersLink(url)
  const ownPath = ownLink ? pathOf(ownLink) : null
  return { kind: 'results', offers, extra: { nextPageUrl: nextPageOf(links, url, ownPath), nodeUrls: pathsLike(links, NODE_PATH, ownPath) } }
}

export function parseAmazonBestsellerRoot(status: number, html: string): ParsedPage<AmazonBestsellerExtra> {
  const failure = amazonFailure(status, html)
  if (failure) return failure
  const departments = pathsLike(bestsellersLinksOf(html), DEPARTMENT_PATH, null)
  if (departments.length === 0) return failed('unknown', NO_DEPARTMENTS_REASON)
  return { kind: 'results', offers: bestsellerOffersOf(html), extra: { nextPageUrl: null, nodeUrls: departments } }
}
