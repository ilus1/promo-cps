import { KABUM_ORIGIN } from '../constants'
import { statusFailure } from '../market/pages'
import { kabumPageProps, kabumProductOffer } from '../market/parse-kabum'
import { storableText } from '../storable-text'
import { quoteOfOffer, sourceFailure } from './source-page'
import type { ListingQuote, SourcePage } from './types'

type KabumProductPage = {
  id?: unknown
  title?: unknown
  friendlyName?: unknown
  sellerName?: unknown
  manufacturer?: unknown
  prices?: { price?: unknown; priceWithDiscount?: unknown; oldPrice?: unknown } | null
  price?: unknown
  available?: unknown
  offer?: unknown
  flags?: unknown
} | null | undefined

const PRODUCT_PATH = '/produto'
const NO_PRODUCT_REASON = 'sem produto'
const UNREADABLE_PRODUCT_REASON = 'produto ilegível'
const OUT_OF_STOCK_REASON = 'sem estoque'

function listingShape(product: NonNullable<KabumProductPage>) {
  return {
    code: product.id,
    name: product.title,
    friendlyName: product.friendlyName,
    sellerName: product.sellerName,
    manufacturer: product.manufacturer,
    price: product.prices?.price ?? product.price,
    priceWithDiscount: product.prices?.priceWithDiscount,
    oldPrice: product.prices?.oldPrice,
    available: product.available,
    offer: product.offer,
    flags: product.flags,
  }
}

export function kabumProductUrl(code: string): string {
  return `${KABUM_ORIGIN}${PRODUCT_PATH}/${code}`
}

export function parseKabumProduct(status: number, html: string, now: Date): SourcePage<ListingQuote> {
  const failure = statusFailure(status)
  if (failure) return sourceFailure(failure.kind, failure.reason)
  const pageProps = kabumPageProps(html)
  if (typeof pageProps === 'string') return sourceFailure('unknown', pageProps)
  const product = pageProps.product as KabumProductPage
  if (!product || typeof product !== 'object') return sourceFailure('missing', NO_PRODUCT_REASON)
  const offer = kabumProductOffer(listingShape(product), now)
  if (offer) return { kind: 'ok', value: quoteOfOffer(offer) }
  const title = typeof product.title === 'string' ? storableText(product.title).trim() : ''
  return product.available === false
    ? sourceFailure('empty', OUT_OF_STOCK_REASON, title)
    : sourceFailure('unknown', UNREADABLE_PRODUCT_REASON, title)
}
