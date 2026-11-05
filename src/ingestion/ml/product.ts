import { safeMlUrl } from '@/lib/ml-url'
import { basisFromComplement } from './basis'
import type { ObservedCard } from './observed-card'
import { INITIAL_STATE_KEY } from './page-keys'
import { at, cents, integer, text, thumbnailOf } from './readers'

export const PRODUCT_PAGE_UNRECOGNIZED = 'Página de produto não reconhecida'
export const PRODUCT_WITHOUT_ITEM = 'Produto sem identificador de item'
export const PRODUCT_WITHOUT_PRICE = 'Produto sem preço'
export const PRODUCT_WITHOUT_TITLE = 'Produto sem título'
export const PRODUCT_URL_UNSAFE = 'Endereço do produto inválido'
export const PDP_FILTERS_PARAM = 'pdp_filters'
export const ITEM_FILTER_PREFIX = 'item_id:'

const PRODUCT_PAGE = 'pdp'
const FULFILLMENT = 'fulfillment'
const STATE = [INITIAL_STATE_KEY]
const COMPONENTS = [...STATE, 'components']
const EVENT_DATA = [...COMPONENTS, 'track', 'melidata_event', 'event_data']
const PRICE = [...COMPONENTS, 'price']

function pinnedUrl(url: string, itemId: string): string {
  const pinned = new URL(url)
  pinned.search = ''
  pinned.searchParams.set(PDP_FILTERS_PARAM, `${ITEM_FILTER_PREFIX}${itemId}`)
  const safe = safeMlUrl(pinned.toString())
  if (safe === null) throw new Error(PRODUCT_URL_UNSAFE)
  return safe
}

export function readProductPage(pageProps: unknown, url: string): ObservedCard {
  if (at(pageProps, ['page']) !== PRODUCT_PAGE) throw new Error(PRODUCT_PAGE_UNRECOGNIZED)
  const id = text(at(pageProps, [...STATE, 'history', 'id'])) ?? text(at(pageProps, [...EVENT_DATA, 'item_id']))
  if (id === null) throw new Error(PRODUCT_WITHOUT_ITEM)
  const title = text(at(pageProps, [...COMPONENTS, 'header', 'title']))
  if (title === null) throw new Error(PRODUCT_WITHOUT_TITLE)
  const priceCents = cents(at(pageProps, [...PRICE, 'price', 'value']))
  if (priceCents === null) throw new Error(PRODUCT_WITHOUT_PRICE)
  const basisText = text(at(pageProps, [...PRICE, 'price_breakdown', 'discount', 'label', 'text']))
  const logistic = text(at(pageProps, [...EVENT_DATA, 'logistic_type']))
  return {
    id,
    productId: text(at(pageProps, [...STATE, 'history', 'product_id'])) ?? text(at(pageProps, [...STATE, 'id'])),
    title,
    thumbnail: thumbnailOf(at(pageProps, [...COMPONENTS, 'gallery', 'pictures', '0', 'id'])),
    url: pinnedUrl(url, id),
    isPad: false,
    priceCents,
    basisText,
    basis: basisFromComplement(basisText ?? undefined),
    listPriceCents: cents(at(pageProps, [...PRICE, 'price', 'original_value'])),
    mlDiscountPct: integer(at(pageProps, [...PRICE, 'discount_label', 'value'])),
    soldQuantity: integer(at(pageProps, [...EVENT_DATA, 'sold_quantity'])),
    full: logistic === null ? null : logistic === FULFILLMENT,
    freeShipping: null,
    categoryId: text(at(pageProps, [...EVENT_DATA, 'category_id'])),
    domainId: text(at(pageProps, [...EVENT_DATA, 'domain_id'])),
    sellerLabel: text(at(pageProps, [...COMPONENTS, 'seller_summary', 'seller', 'name'])),
    couponHint: null,
  }
}
