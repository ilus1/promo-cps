import { CENTS_PER_REAL, KABUM_ORIGIN, KABUM_SITEMAP_EXCLUDED, SECOND_MS } from '../constants'
import { HTTP_OK } from '../http-status'
import { decodeEntities } from './html'
import { failed, statusFailure, storableOffers } from './pages'
import type { KabumPageExtra, MarketOffer, ParsedPage } from './types'

type KabumCampaign = {
  startsAt?: unknown
  endsAt?: unknown
  price?: unknown
  priceWithDiscount?: unknown
} | null

type ActiveCampaign = { priceCents: number; until: Date }
type OfferPrices = Pick<MarketOffer, 'priceCents' | 'listPriceCents' | 'regularPriceCents' | 'priceUntil'>

type KabumProduct = {
  code?: unknown
  name?: unknown
  friendlyName?: unknown
  sellerName?: unknown
  manufacturer?: { name?: unknown } | null
  price?: unknown
  priceWithDiscount?: unknown
  oldPrice?: unknown
  available?: unknown
  offer?: KabumCampaign
  flags?: { isOpenbox?: unknown } | null
}

type KabumMeta = {
  totalItemsCount?: unknown
  totalPagesCount?: unknown
  page?: { number?: unknown } | null
} | null | undefined

type KabumCatalog = { products: unknown[]; meta: KabumMeta }
type NextData = { props?: { pageProps?: Record<string, unknown> | null } } | null
type PageData = { catalogServer?: { data?: unknown; meta?: KabumMeta } } | null

const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
const URL_PAGE = /[?&]page_number=(\d+)/
const SITEMAP_LOC = /<loc>([^<]*)<\/loc>/g
const SITEMAP_INDEX_PATH = '/sitemap.xml'
const SITEMAP_PREFIX = `${KABUM_ORIGIN}/sitemap/`
const SITEMAP_SUFFIX = '.xml'
const SLUG = /^[a-z0-9-]+$/
const PRODUCT_PATH = '/produto'
const FIRST_PAGE = 1
const NO_NEXT_DATA = 'sem __NEXT_DATA__'
const BAD_JSON = 'JSON inválido'
const NO_CATALOG = 'sem catálogo'
const NO_PRODUCTS = 'sem produtos'
const UNREADABLE_PRODUCTS = 'produtos ilegíveis'
const UNKNOWN_TOTAL = 0

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function filledText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function isProduct(value: unknown): value is KabumProduct {
  return typeof value === 'object' && value !== null
}

function listingIdOf(code: unknown): string | null {
  if (typeof code === 'number' && Number.isInteger(code)) return String(code)
  return filledText(code)
}

function centsOf(amount: number): number {
  return Math.round(amount * CENTS_PER_REAL)
}

function productUrl(listingId: string, friendlyName: string | null): string {
  const path = `${KABUM_ORIGIN}${PRODUCT_PATH}/${listingId}`
  return friendlyName ? `${path}/${friendlyName}` : path
}

function isOpenBox(product: KabumProduct): boolean {
  return product.flags?.isOpenbox === true
}

function activeCampaign(campaign: KabumCampaign | undefined, now: Date): ActiveCampaign | null {
  const startsAt = positiveNumber(campaign?.startsAt)
  const endsAt = positiveNumber(campaign?.endsAt)
  const atSight = positiveNumber(campaign?.priceWithDiscount) ?? positiveNumber(campaign?.price)
  if (startsAt === null || endsAt === null || atSight === null) return null
  const nowMs = now.getTime()
  const until = new Date(endsAt * SECOND_MS)
  if (Number.isNaN(until.getTime()) || nowMs < startsAt * SECOND_MS || nowMs >= until.getTime()) return null
  return { priceCents: centsOf(atSight), until }
}

function pricesOf(product: KabumProduct, atSightCents: number, cardPrice: number | null, now: Date): OfferPrices {
  const campaign = activeCampaign(product.offer, now)
  if (campaign) {
    const cardCents = cardPrice === null ? null : centsOf(cardPrice)
    return {
      priceCents: campaign.priceCents,
      listPriceCents: cardCents !== null && cardCents > campaign.priceCents ? cardCents : null,
      regularPriceCents: atSightCents,
      priceUntil: campaign.until,
    }
  }
  const oldPrice = positiveNumber(product.oldPrice)
  return {
    priceCents: atSightCents,
    listPriceCents: oldPrice !== null && cardPrice !== null && oldPrice > cardPrice ? centsOf(oldPrice) : null,
    regularPriceCents: null,
    priceUntil: null,
  }
}

function offerOf(product: KabumProduct, now: Date): MarketOffer | null {
  const listingId = listingIdOf(product.code)
  const title = filledText(product.name)
  const cardPrice = positiveNumber(product.price)
  const atSight = positiveNumber(product.priceWithDiscount) ?? cardPrice
  if (!listingId || !title || atSight === null) return null
  return {
    retailer: 'kabum',
    listingId,
    title,
    brand: filledText(product.manufacturer?.name),
    seller: filledText(product.sellerName),
    ...pricesOf(product, centsOf(atSight), cardPrice, now),
    inStock: product.available === true,
    url: productUrl(listingId, filledText(product.friendlyName)),
    source: 'kabum_catalog',
  }
}

export function kabumPageProps(html: string): Record<string, unknown> | string {
  const script = html.match(NEXT_DATA)?.[1]
  if (!script) return NO_NEXT_DATA
  const nextData = jsonOf(script) as NextData | undefined
  if (nextData === undefined) return BAD_JSON
  return nextData?.props?.pageProps ?? {}
}

export function kabumProductOffer(product: unknown, now: Date): MarketOffer | null {
  if (!isProduct(product) || isOpenBox(product)) return null
  return storableOffers([offerOf(product, now)])[0] ?? null
}

function catalogOf(pageProps: Record<string, unknown>): KabumCatalog | string {
  const data = pageProps.data
  const pageData = (typeof data === 'string' ? jsonOf(data) : data) as PageData | undefined
  if (typeof data === 'string' && pageData === undefined) return BAD_JSON
  const catalog = pageData?.catalogServer
  return Array.isArray(catalog?.data) ? { products: catalog.data, meta: catalog.meta } : NO_CATALOG
}

function extraOf(meta: KabumMeta, url: string): KabumPageExtra {
  const page = positiveNumber(meta?.page?.number) ?? positiveNumber(Number(url.match(URL_PAGE)?.[1])) ?? FIRST_PAGE
  return {
    page,
    totalPages: positiveNumber(meta?.totalPagesCount) ?? page,
    totalItems: positiveNumber(meta?.totalItemsCount) ?? UNKNOWN_TOTAL,
  }
}

function sitemapSlugOf(loc: string): string | null {
  if (!loc.startsWith(SITEMAP_PREFIX) || !loc.endsWith(SITEMAP_SUFFIX)) return null
  const slug = loc.slice(SITEMAP_PREFIX.length, -SITEMAP_SUFFIX.length)
  return SLUG.test(slug) && !KABUM_SITEMAP_EXCLUDED.includes(slug) ? slug : null
}

export function kabumSitemapIndexUrl(): string {
  return `${KABUM_ORIGIN}${SITEMAP_INDEX_PATH}`
}

export function parseKabumSitemapIndex(status: number, xml: string): string[] | null {
  if (status !== HTTP_OK) return null
  const slugs = [...xml.matchAll(SITEMAP_LOC)].map(([, loc]) => sitemapSlugOf(decodeEntities(loc).trim()))
  const departments = [...new Set(slugs.filter((slug) => slug !== null))]
  return departments.length > 0 ? departments : null
}

export function parseKabumListing(status: number, html: string, url: string, now: Date): ParsedPage<KabumPageExtra> {
  const failure = statusFailure(status)
  if (failure) return failure
  const pageProps = kabumPageProps(html)
  if (typeof pageProps === 'string') return failed('unknown', pageProps)
  const catalog = catalogOf(pageProps)
  if (typeof catalog === 'string') return failed('unknown', catalog)
  if (catalog.products.length === 0) return failed('empty', NO_PRODUCTS)
  const comparable = catalog.products.filter((product) => !isProduct(product) || !isOpenBox(product))
  const offers = storableOffers(comparable.filter(isProduct).map((product) => offerOf(product, now)))
  if (comparable.length > 0 && offers.length === 0) return failed('unknown', UNREADABLE_PRODUCTS)
  return { kind: 'results', offers, extra: extraOf(catalog.meta, url) }
}
