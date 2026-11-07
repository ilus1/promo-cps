export const RETAILERS = ['kabum', 'amazon'] as const
export type Retailer = (typeof RETAILERS)[number]

export const OFFER_SOURCES = ['kabum_catalog', 'amazon_search', 'amazon_bestsellers'] as const
export type OfferSource = (typeof OFFER_SOURCES)[number]

export interface MarketOffer {
  retailer: Retailer
  listingId: string
  title: string
  brand: string | null
  seller: string | null
  priceCents: number
  listPriceCents: number | null
  regularPriceCents: number | null
  priceUntil: Date | null
  inStock: boolean
  url: string
  source: OfferSource
}

export interface MarketCard {
  name: string
  priceCents: number
  store: string | null
  storeCount: number | null
  url: string
  brand?: string | null
}

export const PAGE_KINDS = ['results', 'empty', 'wall', 'unknown', 'missing'] as const
export type PageKind = (typeof PAGE_KINDS)[number]

export type ParsedPage<Extra> =
  | { kind: 'results'; offers: MarketOffer[]; extra: Extra }
  | { kind: Exclude<PageKind, 'results'>; reason: string }

export interface KabumPageExtra { page: number; totalPages: number; totalItems: number }

export interface AmazonSearchExtra { resultCount: number }

export interface AmazonBestsellerExtra { nextPageUrl: string | null; nodeUrls: string[] }
