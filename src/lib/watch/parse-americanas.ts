import { CENTS_PER_REAL } from '../constants'
import { statusFailure, storableCents, storableOptionalCents } from '../market/pages'
import { storableText } from '../storable-text'
import { validEan } from './ean'
import { AMERICANAS_ORIGIN } from './links'
import { sourceFailure } from './source-page'
import type { ListingCandidate, ListingQuote, SourcePage } from './types'

type VtexOffer = { Price?: unknown; ListPrice?: unknown; AvailableQuantity?: unknown } | null | undefined
type VtexSeller = { sellerName?: unknown; commertialOffer?: VtexOffer } | null | undefined
type VtexItem = { itemId?: unknown; ean?: unknown; nameComplete?: unknown; name?: unknown; sellers?: unknown } | null | undefined
type VtexProduct = { productId?: unknown; productName?: unknown; linkText?: unknown; link?: unknown; items?: unknown } | null | undefined
type BestSeller = { merchant: string | null; priceCents: number; listPriceCents: number | null }
type Sku = { ref: string; url: string; title: string; ean: string | null; best: BestSeller | null; priced: boolean; sold: boolean }

const API_PATH = '/api/catalog_system/pub/products/search'
const VTEX_PARTIAL_STATUS = 206
const EAN_FILTER = 'fq=alternateIds_Ean:'
const PRODUCT_FILTER = 'fq=productId:'
const TEXT_PARAM = 'ft='
const LINK_SUFFIX = '/p'
const REF_SEPARATOR = ':'
const BAD_JSON_REASON = 'JSON inválido'
const NO_PRODUCTS_REASON = 'nenhum produto'
const UNREADABLE_REASON = 'produtos ilegíveis'
const NO_SKU_REASON = 'SKU ausente'
const OUT_OF_STOCK_REASON = 'sem estoque'

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function filledText(value: unknown): string | null {
  const text = typeof value === 'string' ? storableText(value).trim() : ''
  return text === '' ? null : text
}

function idOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value)
  return filledText(value)
}

function centsOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value * CENTS_PER_REAL) : null
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function bestSellerOf(sellers: VtexSeller[]): BestSeller | null {
  const available = sellers.flatMap((seller) => {
    const offer = seller?.commertialOffer
    const priceCents = centsOf(offer?.Price)
    const quantity = offer?.AvailableQuantity
    if (priceCents === null || typeof quantity !== 'number' || quantity <= 0 || !storableCents(priceCents)) return []
    const listCents = centsOf(offer?.ListPrice)
    const listPriceCents = listCents !== null && listCents > priceCents && storableOptionalCents(listCents) ? listCents : null
    return [{ merchant: filledText(seller?.sellerName), priceCents, listPriceCents }]
  })
  return available.reduce<BestSeller | null>((best, seller) => (best === null || seller.priceCents < best.priceCents ? seller : best), null)
}

function hasPriceField(sellers: VtexSeller[]): boolean {
  return sellers.some((seller) => typeof seller?.commertialOffer?.Price === 'number')
}

function skusOf(product: VtexProduct): Sku[] {
  const productId = idOf(product?.productId)
  const slug = filledText(product?.linkText)
  if (!productId) return []
  const url = slug ? `${AMERICANAS_ORIGIN}/${slug}${LINK_SUFFIX}` : filledText(product?.link)
  return arrayOf<VtexItem>(product?.items).flatMap((item) => {
    const itemId = idOf(item?.itemId)
    const title = filledText(item?.nameComplete) ?? filledText(product?.productName) ?? filledText(item?.name)
    if (!itemId || !title || !url) return []
    const sellers = arrayOf<VtexSeller>(item?.sellers)
    return [{
      ref: `${productId}${REF_SEPARATOR}${itemId}`,
      url,
      title,
      ean: validEan(typeof item?.ean === 'string' ? item.ean : null),
      best: bestSellerOf(sellers),
      priced: hasPriceField(sellers),
      sold: sellers.length > 0,
    }]
  })
}

function wellFormed(products: VtexProduct[], skus: Sku[]): boolean {
  const items = products.reduce((total, product) => total + arrayOf(product?.items).length, 0)
  return products.every((product) => idOf(product?.productId) !== null && Array.isArray(product?.items)) && skus.length === items
}

function unavailable(skus: Sku[], products: VtexProduct[]): boolean {
  return skus.some((sku) => sku.priced) || (wellFormed(products, skus) && skus.every((sku) => !sku.sold))
}

function productsOf(status: number, body: string): VtexProduct[] | SourcePage<never> {
  const failure = status === VTEX_PARTIAL_STATUS ? null : statusFailure(status)
  if (failure) return sourceFailure(failure.kind, failure.reason)
  const parsed = jsonOf(body)
  if (!Array.isArray(parsed)) return sourceFailure('unknown', BAD_JSON_REASON)
  return parsed.length === 0 ? sourceFailure('empty', NO_PRODUCTS_REASON) : (parsed as VtexProduct[])
}

function productTitleOf(products: VtexProduct[]): string | null {
  const name = products.map((product) => filledText(product?.productName)).find((text) => text !== null)
  return name ? storableText(name) : null
}

export function americanasEanUrl(ean: string): string {
  return `${AMERICANAS_ORIGIN}${API_PATH}?${EAN_FILTER}${encodeURIComponent(ean)}`
}

export function americanasSearchUrl(query: string): string {
  return `${AMERICANAS_ORIGIN}${API_PATH}?${TEXT_PARAM}${encodeURIComponent(query.trim())}`
}

export function americanasLinkUrl(slug: string): string {
  return `${AMERICANAS_ORIGIN}${API_PATH}/${encodeURIComponent(slug)}${LINK_SUFFIX}`
}

export function americanasRefreshUrl(ref: string): string {
  return `${AMERICANAS_ORIGIN}${API_PATH}?${PRODUCT_FILTER}${encodeURIComponent(ref.split(REF_SEPARATOR)[0])}`
}

export function parseAmericanasSearch(status: number, body: string): SourcePage<ListingCandidate[]> {
  const products = productsOf(status, body)
  if (!Array.isArray(products)) return products
  const skus = products.flatMap(skusOf)
  const candidates = skus.flatMap((sku): ListingCandidate[] => (sku.best ? [{
    retailer: 'americanas',
    ref: sku.ref,
    url: sku.url,
    title: sku.title,
    ean: sku.ean,
    merchant: sku.best.merchant,
    priceCents: sku.best.priceCents,
    listPriceCents: sku.best.listPriceCents,
    inStock: true,
  }] : []))
  if (candidates.length > 0) return { kind: 'ok', value: candidates }
  const title = productTitleOf(products)
  return unavailable(skus, products)
    ? sourceFailure('empty', OUT_OF_STOCK_REASON, title)
    : sourceFailure('unknown', UNREADABLE_REASON, title)
}

export function parseAmericanasQuote(status: number, body: string, ref: string): SourcePage<ListingQuote> {
  const products = productsOf(status, body)
  if (!Array.isArray(products)) return products.kind === 'empty' ? sourceFailure('missing', products.reason) : products
  const sku = products.flatMap(skusOf).find((candidate) => candidate.ref === ref)
  if (!sku) return sourceFailure('missing', NO_SKU_REASON)
  if (!sku.best) return sku.priced || !sku.sold ? sourceFailure('empty', OUT_OF_STOCK_REASON) : sourceFailure('unknown', UNREADABLE_REASON)
  const { merchant, priceCents, listPriceCents } = sku.best
  return { kind: 'ok', value: { ref, merchant, title: sku.title, priceCents, listPriceCents, finalCents: priceCents, inStock: true } }
}
