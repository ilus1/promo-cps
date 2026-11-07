export const WATCH_RETAILERS = ['ml', 'amazon', 'kabum', 'americanas', 'buscape'] as const
export type WatchRetailer = (typeof WATCH_RETAILERS)[number]
export const ML_RETAILER = 'ml' satisfies WatchRetailer

export const MATCH_KINDS = ['barcode', 'auto', 'link'] as const
export type MatchKind = (typeof MATCH_KINDS)[number]

export const EAN_SOURCES = ['manual', 'link', 'americanas'] as const
export type EanSource = (typeof EAN_SOURCES)[number]

export const WATCH_ALERT_KINDS = ['target', 'low_30d', 'drop'] as const
export type WatchAlertKind = (typeof WATCH_ALERT_KINDS)[number]

export const SOURCE_PAGE_FAILURES = ['wall', 'unknown', 'missing', 'empty'] as const
export type SourcePageFailure = (typeof SOURCE_PAGE_FAILURES)[number]

export type SourcePage<Value> =
  | { kind: 'ok'; value: Value }
  | { kind: SourcePageFailure; reason: string; title?: string }

export interface ProductLink { retailer: WatchRetailer; ref: string; url: string }

export interface ListingCandidate {
  retailer: WatchRetailer
  ref: string
  url: string
  title: string
  ean: string | null
  merchant: string | null
  priceCents: number
  listPriceCents: number | null
  inStock: boolean
}

export interface ListingQuote {
  ref: string
  merchant: string | null
  title: string | null
  priceCents: number
  listPriceCents: number | null
  finalCents: number
  inStock: boolean
}

export interface ChosenMatch { candidate: ListingCandidate; match: MatchKind }

export interface WatchListingView {
  id: string
  retailer: WatchRetailer
  merchant: string | null
  title: string
  url: string
  match: MatchKind
  priceCents: number | null
  listPriceCents: number | null
  finalCents: number | null
  inStock: boolean | null
  checkedAt: Date | null
  lastError: string | null
}

export interface BestOffer {
  listingId: string
  retailer: WatchRetailer
  merchant: string | null
  finalCents: number
  url: string
}

export interface WatchProductView {
  id: string
  name: string
  query: string
  ean: string | null
  eanSource: EanSource | null
  targetPriceCents: number | null
  dropPercent: number
  best: BestOffer | null
  low30dCents: number | null
  lastCheckedAt: Date | null
  resolvedAt: Date | null
  listings: WatchListingView[]
}

export interface PricePoint { finalCents: number; at: Date }

export interface WatchAlertDecision { kind: WatchAlertKind; best: BestOffer; previousBestCents: number | null }

export interface SentWatchAlert { kind: WatchAlertKind; priceCents: number; sentAt: Date }

export const WATCH_SOURCE_STATES = ['running', 'held', 'blocked', 'waiting', 'stopped'] as const
export type WatchSourceState = (typeof WATCH_SOURCE_STATES)[number]

export const WATCH_WAITING_REASONS = ['next_refresh', 'ml_busy', 'ml_cycle'] as const
export type WatchWaitingReason = (typeof WATCH_WAITING_REASONS)[number]

export interface WatchSourceStatus {
  retailer: WatchRetailer
  state: WatchSourceState
  waitingFor: WatchWaitingReason | null
  holdText: string | null
  blockedUntil: Date | null
  lastError: string | null
  lastRequestAt: Date | null
  requestsToday: number
  listings: number
  nextRefreshAt: Date | null
}

export interface WatchLastAlert { productName: string; kind: WatchAlertKind; priceCents: number; sentAt: Date }

export interface WatchStatus {
  products: number
  sources: WatchSourceStatus[]
  lastAlert: WatchLastAlert | null
}
