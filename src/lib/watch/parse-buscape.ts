import { BUSCAPE_SEARCH_URL, CENTS_PER_REAL } from '../constants'
import { amountCentsOf, markerText, textOf } from '../market/html'
import { statusFailure, storableCents } from '../market/pages'
import { storableText } from '../storable-text'
import { foldAccents } from '../text-search'
import { candidateConfidence } from './choose-match'
import { BUSCAPE_ORIGIN, parseProductLink } from './links'
import { merchantKeyOf } from './merchant-key'
import { sourceFailure, storableHtmlText } from './source-page'
import type { ListingCandidate, ListingQuote, SourcePage } from './types'

type BuscapeOffer = { name?: unknown; price?: unknown; sellerName?: unknown } | null | undefined
type BuscapeOffers = { offerList?: unknown; displayOffers?: unknown } | null | undefined
type BuscapeNextData = { props?: { initialReduxState?: { offers?: BuscapeOffers } | null } | null } | null | undefined
type MerchantQuote = ListingQuote & { merchant: string }

const QUERY_SEPARATOR = /\s+/
const QUERY_JOINER = '+'
const CARD_START = /<a\b[^>]*data-testid="product-card::card"[^>]*>/g
const HREF = /\bhref="([^"]*)"/
const NAME = /data-testid="product-card::name"[^>]*>([\s\S]*?)<\/h2>/
const PRICE = /data-testid="product-card::price"[^>]*>([\s\S]*?)<\/div>/
const AMPERSAND_ENTITY = /&amp;/g
const AMPERSAND = '&'
const EMPTY_MARKER = 'nao encontramos resultados'
const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
const CANONICAL = /<link rel="canonical" href="([^"]*)"/
const PAGE_TITLE = /<title>([^<]*)<\/title>/
const PAGE_TITLE_SUFFIX = /\s+em\s+promoção\s+é\s+no\s+buscapé\s*$/i
const NO_CARDS_REASON = 'página desconhecida'
const EMPTY_REASON = 'nenhum resultado'
const UNREADABLE_CARDS_REASON = 'cards ilegíveis'
const NO_NEXT_DATA_REASON = 'sem __NEXT_DATA__'
const NO_PRODUCT_REASON = 'sem produto'
const NO_OFFERS_REASON = 'sem ofertas'
const DIRECT_ONLY_REASON = 'só ofertas de lojas lidas direto'
const OTHER_PRODUCT_REASON = 'nenhuma oferta do produto'
const HIGH = 'high'
const DIRECT_MERCHANT_KEYS: ReadonlySet<string> = new Set(['KaBuM!', 'Amazon', 'Mercado Livre', 'Americanas'].map(merchantKeyOf))

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function cardsOf(html: string): string[] {
  const starts = [...html.matchAll(CARD_START)]
  return starts.map((match, index) => html.slice(match.index, starts[index + 1]?.index ?? html.length))
}

function candidateOf(markup: string): ListingCandidate | null | undefined {
  const name = markup.match(NAME)?.[1]
  const price = markup.match(PRICE)?.[1]
  const priceCents = price ? amountCentsOf(textOf(price)) : null
  const title = name ? storableHtmlText(name) : ''
  if (!title || priceCents === null || !storableCents(priceCents)) return undefined
  const href = markup.match(HREF)?.[1]?.replace(AMPERSAND_ENTITY, AMPERSAND)
  const link = href ? parseProductLink(href.startsWith('/') ? `${BUSCAPE_ORIGIN}${href}` : href) : null
  if (!link || link.retailer !== 'buscape') return null
  return {
    retailer: 'buscape',
    ref: link.ref,
    url: link.url,
    title,
    ean: null,
    merchant: null,
    priceCents,
    listPriceCents: null,
    inStock: true,
  }
}

function offersOf(html: string): BuscapeOffer[] | null {
  const script = html.match(NEXT_DATA)?.[1]
  const offers = script ? (jsonOf(script) as BuscapeNextData)?.props?.initialReduxState?.offers : undefined
  if (!offers) return null
  const list = Array.isArray(offers.offerList) && offers.offerList.length > 0 ? offers.offerList : offers.displayOffers
  return Array.isArray(list) ? (list as BuscapeOffer[]) : []
}

function offerQuotes(ref: string, offers: BuscapeOffer[]): MerchantQuote[] {
  return offers.flatMap((offer) => {
    const merchant = typeof offer?.sellerName === 'string' ? storableText(offer.sellerName).trim() : ''
    const priceCents = typeof offer?.price === 'number' ? Math.round(offer.price * CENTS_PER_REAL) : 0
    if (!merchant || !storableCents(priceCents)) return []
    const title = typeof offer?.name === 'string' ? storableText(offer.name).trim() || null : null
    return [{ ref, merchant, title, priceCents, listPriceCents: null, finalCents: priceCents, inStock: true }]
  })
}

function isDirectMerchant(quote: MerchantQuote): boolean {
  return DIRECT_MERCHANT_KEYS.has(merchantKeyOf(quote.merchant))
}

function offerOfProduct(productName: string, quote: MerchantQuote): boolean {
  if (quote.title === null) return false
  const candidate: ListingCandidate = {
    retailer: 'buscape',
    ref: quote.ref,
    url: buscapeProductUrl(quote.ref),
    title: quote.title,
    ean: null,
    merchant: quote.merchant,
    priceCents: quote.priceCents,
    listPriceCents: null,
    inStock: true,
  }
  return candidateConfidence(productName, candidate) === HIGH
}

function cheapestPerMerchant(quotes: MerchantQuote[]): MerchantQuote[] {
  const byMerchant = new Map<string, MerchantQuote>()
  for (const quote of quotes) {
    const key = merchantKeyOf(quote.merchant)
    const known = byMerchant.get(key)
    if (!known || quote.priceCents < known.priceCents) byMerchant.set(key, quote)
  }
  return [...byMerchant.values()]
}

function pageTitleOf(html: string, quotes: readonly MerchantQuote[]): string | null {
  const raw = html.match(PAGE_TITLE)?.[1]
  const title = raw ? storableHtmlText(raw).replace(PAGE_TITLE_SUFFIX, '').trim() : ''
  return title || quotes.find((quote) => quote.title)?.title || null
}

export function buscapeSearchUrl(query: string): string {
  return `${BUSCAPE_SEARCH_URL}${query.trim().split(QUERY_SEPARATOR).filter(Boolean).map(encodeURIComponent).join(QUERY_JOINER)}`
}

export function buscapeProductUrl(ref: string): string {
  return `${BUSCAPE_ORIGIN}/${ref}`
}

export function parseBuscapeSearch(status: number, html: string): SourcePage<ListingCandidate[]> {
  const failure = statusFailure(status)
  if (failure) return sourceFailure(failure.kind, failure.reason)
  const cards = cardsOf(html).map(candidateOf)
  if (cards.length === 0) {
    const empty = foldAccents(markerText(html)).includes(EMPTY_MARKER)
    return sourceFailure(empty ? 'empty' : 'unknown', empty ? EMPTY_REASON : NO_CARDS_REASON)
  }
  if (cards.every((card) => card === undefined)) return sourceFailure('unknown', UNREADABLE_CARDS_REASON)
  return { kind: 'ok', value: cards.filter((card): card is ListingCandidate => Boolean(card)) }
}

export function parseBuscapeProduct(status: number, html: string, productName?: string): SourcePage<ListingQuote[]> {
  const failure = statusFailure(status)
  if (failure) return sourceFailure(failure.kind, failure.reason)
  const canonical = html.match(CANONICAL)?.[1]
  const link = canonical ? parseProductLink(canonical) : null
  if (!link || link.retailer !== 'buscape') return sourceFailure('unknown', NO_PRODUCT_REASON)
  const offers = offersOf(html)
  if (offers === null) return sourceFailure('unknown', NO_NEXT_DATA_REASON)
  const quotes = offerQuotes(link.ref, offers)
  if (quotes.length === 0) return sourceFailure('empty', NO_OFFERS_REASON, pageTitleOf(html, quotes))
  const others = quotes.filter((quote) => !isDirectMerchant(quote))
  if (others.length === 0) return sourceFailure('empty', DIRECT_ONLY_REASON, pageTitleOf(html, quotes))
  const ofProduct = productName === undefined ? others : others.filter((quote) => offerOfProduct(productName, quote))
  return ofProduct.length > 0
    ? { kind: 'ok', value: cheapestPerMerchant(ofProduct) }
    : sourceFailure('empty', OTHER_PRODUCT_REASON, pageTitleOf(html, quotes))
}
