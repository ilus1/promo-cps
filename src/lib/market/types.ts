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

export interface RetrievalTerms { all: string[]; any: string[] }

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

export const CRAWLER_STATES = ['running', 'held', 'blocked', 'waiting', 'stopped'] as const
export type CrawlerState = (typeof CRAWLER_STATES)[number]

export interface KabumProgress {
  site: 'kabum'
  department: string | null
  departmentIndex: number
  departmentCount: number
  page: number
  passStartedAt: Date | null
  nextPassAt: Date | null
}

export interface AmazonProgress {
  site: 'amazon'
  searchedKeys: number
  dueKeys: number
  bestsellersAt: Date | null
}

export const WAITING_REASONS = ['next_pass', 'daily_budget', 'ml_busy', 'queue_empty'] as const
export type WaitingReason = (typeof WAITING_REASONS)[number]

export interface CrawlerStatus {
  state: CrawlerState
  holdText: string | null
  waitingFor: WaitingReason | null
  blockedUntil: Date | null
  lastError: string | null
  pagesToday: number
  dailyBudget: number | null
  intervalMs: number
  lastPageAt: Date | null
  validOffers: number
  progress: KabumProgress | AmazonProgress
}

export interface MarketCoverage { matched: number; total: number; minPercent: number }

export interface MarketStatus {
  kabum: CrawlerStatus
  amazon: CrawlerStatus
  coverage: MarketCoverage
}

export const COMPARE_OUTCOMES = ['matched', 'no_match'] as const
export type CompareOutcome = (typeof COMPARE_OUTCOMES)[number]

export interface CompareResponse { status: CompareOutcome; amazonQueued: boolean; amazonSearchedAt: string | null }

export interface SearchPriority { queued: boolean; searchedAt: Date | null }
