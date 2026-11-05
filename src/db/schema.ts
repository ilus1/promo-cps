import {
  boolean, doublePrecision, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp,
  uuid, index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BASES, BUSCA_KINDS, COUPON_KINDS, ITEM_STATUSES, MATCH_CONFIDENCES, PRICE_CHECK_STATUSES, RUN_KINDS, RUN_ROW_STATUSES, SOURCE_TYPES,
} from '../lib/domain'
import { OFFER_SOURCES, PAGE_KINDS, RETAILERS } from '../lib/market/types'
import { checkKeyOf } from './check-key'

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const coupons = pgTable('coupons', {
  campaignId: text('campaign_id').primaryKey(),
  title: text('title').notNull(),
  kind: text('kind', { enum: COUPON_KINDS }).notNull(),
  percentOff: numeric('percent_off', { mode: 'number' }),
  amountOffCents: integer('amount_off_cents'),
  minPaymentCents: integer('min_payment_cents'),
  capCents: integer('cap_cents'),
  scopeLabel: text('scope_label'),
  isStore: boolean('is_store').notNull(),
  status: text('status').notNull(),
  activationType: text('activation_type'),
  activateCode: text('activate_code'),
  listingUrl: text('listing_url'),
  startsAt: ts('starts_at'),
  expiresAt: ts('expires_at'),
  raw: jsonb('raw').notNull(),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  endedAt: ts('ended_at'),
  activationTriedAt: ts('activation_tried_at'),
  activationError: text('activation_error'),
  lastDiscoveredAt: ts('last_discovered_at'),
  discoveryTriedAt: ts('discovery_tried_at'),
  discoveryPriorityAt: ts('discovery_priority_at'),
})

export const items = pgTable('items', {
  id: text('id').primaryKey(),
  productId: text('product_id'),
  title: text('title').notNull(),
  thumbnail: text('thumbnail'),
  url: text('url'),
  categoryId: text('category_id'),
  domainId: text('domain_id'),
  sellerLabel: text('seller_label'),
  priceCents: integer('price_cents').notNull(),
  basis: text('basis', { enum: BASES }).notNull(),
  basisText: text('basis_text'),
  listPriceCents: integer('list_price_cents'),
  mlDiscountPct: integer('ml_discount_pct'),
  soldQuantity: integer('sold_quantity'),
  full: boolean('full'),
  freeShipping: boolean('free_shipping'),
  couponHint: text('coupon_hint'),
  observedAt: ts('observed_at').notNull(),
  dropRatio: doublePrecision('drop_ratio'),
  status: text('status', { enum: ITEM_STATUSES }).notNull().default(ITEM_STATUSES[0]),
  seenPriceCents: integer('seen_price_cents'),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
}, (t) => [
  index('items_observed_idx').on(t.observedAt),
  index('items_discount_idx').on(t.mlDiscountPct.desc().nullsLast(), t.observedAt.desc()),
  index('items_first_seen_idx').on(t.firstSeenAt),
  index('items_status_observed_idx').on(t.status, t.observedAt),
  index('items_product_idx').on(t.productId),
  index('items_check_key_idx').on(checkKeyOf(t.productId, t.id)),
])

export const priceSegments = pgTable('price_segments', {
  id: serial('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  priceCents: integer('price_cents').notNull(),
  basis: text('basis', { enum: BASES }).notNull(),
  firstSeenAt: ts('first_seen_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
}, (t) => [index('segments_item_idx').on(t.itemId, t.lastSeenAt)])

export const itemSources = pgTable('item_sources', {
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  sourceType: text('source_type', { enum: SOURCE_TYPES }).notNull(),
  sourceId: text('source_id').notNull(),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.itemId, t.sourceType, t.sourceId] }),
  index('sources_source_idx').on(t.sourceType, t.sourceId),
  index('sources_type_seen_idx').on(t.sourceType, t.lastSeenAt),
])

export const searches = pgTable('searches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  kind: text('kind', { enum: BUSCA_KINDS }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  runEveryHours: integer('run_every_hours').notNull().default(3),
  lastRunAt: ts('last_run_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  lastItems: integer('last_items'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('searches_url_unique').on(t.url)])

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: RUN_KINDS }).notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  status: text('status', { enum: RUN_ROW_STATUSES }),
  pages: integer('pages').notNull().default(0),
  counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
  error: text('error'),
}, (t) => [index('runs_kind_started_idx').on(t.kind, t.startedAt)])

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  query: text('query').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('alerts_query_unique').on(t.query)])

export const alertHits = pgTable('alert_hits', {
  alertId: uuid('alert_id').notNull().references(() => alerts.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  priceCents: integer('price_cents').notNull(),
  alertedAt: ts('alerted_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.alertId, t.itemId] }), index('alert_hits_item_idx').on(t.itemId)])

export interface PriceOffer { store: string | null; priceCents: number; name: string }

export const priceChecks = pgTable('price_checks', {
  key: text('key').primaryKey(),
  itemId: text('item_id').notNull(),
  checkedAt: ts('checked_at').notNull(),
  status: text('status', { enum: PRICE_CHECK_STATUSES }).notNull(),
  confidence: text('confidence', { enum: MATCH_CONFIDENCES }),
  query: text('query').notNull(),
  mlPriceCents: integer('ml_price_cents').notNull(),
  marketLowCents: integer('market_low_cents'),
  secondLowCents: integer('second_low_cents'),
  marketStore: text('market_store'),
  storeCount: integer('store_count'),
  offers: jsonb('offers').$type<PriceOffer[]>().notNull().default([]),
  sourceUrl: text('source_url').notNull(),
  reason: text('reason'),
}, (t) => [index('price_checks_checked_idx').on(t.checkedAt)])

export type Coupon = typeof coupons.$inferSelect
export type Item = typeof items.$inferSelect
export type Search = typeof searches.$inferSelect
export type Run = typeof runs.$inferSelect
export type Alert = typeof alerts.$inferSelect
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<boolean>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export type PriceCheck = typeof priceChecks.$inferSelect

export const marketOffers = pgTable('market_offers', {
  key: text('key').primaryKey(),
  retailer: text('retailer', { enum: RETAILERS }).notNull(),
  listingId: text('listing_id').notNull(),
  title: text('title').notNull(),
  brand: text('brand'),
  seller: text('seller'),
  priceCents: integer('price_cents').notNull(),
  listPriceCents: integer('list_price_cents'),
  regularPriceCents: integer('regular_price_cents'),
  priceUntil: ts('price_until'),
  inStock: boolean('in_stock').notNull(),
  url: text('url').notNull(),
  source: text('source', { enum: OFFER_SOURCES }).notNull(),
  tokens: text('tokens').array().notNull(),
  firstSeenAt: ts('first_seen_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
}, (t) => [
  index('market_offers_tokens_idx').using('gin', t.tokens).with({ fastupdate: false }),
  index('market_offers_retailer_seen_idx').on(t.retailer, t.lastSeenAt),
  index('market_offers_seen_idx').on(t.lastSeenAt),
])

export const marketSearches = pgTable('market_searches', {
  key: text('key').primaryKey(),
  query: text('query').notNull(),
  searchedAt: ts('searched_at'),
  status: text('status', { enum: PAGE_KINDS }),
  resultCount: integer('result_count'),
  priorityAt: ts('priority_at'),
}, (t) => [index('market_searches_searched_idx').on(t.searchedAt)])

export const crawlerState = pgTable('crawler_state', {
  site: text('site', { enum: RETAILERS }).primaryKey(),
  cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
  backoffLevel: integer('backoff_level').notNull().default(0),
  blockedUntil: ts('blocked_until'),
  dayKey: text('day_key'),
  pagesToday: integer('pages_today').notNull().default(0),
  lastPageAt: ts('last_page_at'),
  passStartedAt: ts('pass_started_at'),
  bestsellersAt: ts('bestsellers_at'),
  lastError: text('last_error'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})
