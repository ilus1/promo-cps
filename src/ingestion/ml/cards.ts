import { ML_HOST } from '@/lib/constants'
import { PERCENT_OFF, type CouponHint } from '@/lib/coupon-hint'
import { formatCents } from '@/lib/format'
import { safeMlUrl } from '@/lib/ml-url'
import { isRecord } from '@/lib/records'
import { basisFromComplement } from './basis'
import type { ObservedCard } from './observed-card'
import { INITIAL_STATE_KEY, RESULTS_KEY } from './page-keys'
import { cents, integer, records, text, thumbnailOf } from './readers'

const POLYCARD_KEY = 'polycard'
export const LISTING_RESULTS_MISSING = 'Listagem sem resultados no estado da página'

export class ListingResultsMissing extends Error {
  constructor() {
    super(LISTING_RESULTS_MISSING)
  }
}
const PAD_FLAG = 'true'
const URL_SCHEME = 'https://'
const CLICK_TRACKER_HOST = `click1.${ML_HOST}`
const PLACEHOLDER = /\{([^{}]*)\}/g
const PRICE_PLACEHOLDER = /\{([^{}]*)\}(\s*OFF\b)?/gi
const AFTER_PRICE = /^\s*com cupom\b/i
const SPACES = /\s+/g
const FREE = /gr[aá]tis/i
const NEW_BUYER_KEY = 'new_buyer'
const FULL_ICON_KEY = 'vpp_full_icon'
const COUPON_PROMOTION = 'coupon'
const PRICE_COUPLED: readonly (keyof ObservedCard)[] = ['basisText', 'basis', 'couponHint', 'listPriceCents', 'mlDiscountPct']

type RawValue = {
  key?: unknown
  label?: { text?: unknown }
  price?: { value?: unknown; previous?: unknown }
  pill?: { text?: unknown }
  icon?: { key?: unknown }
}
type RawTemplate = { type?: unknown; text?: unknown; values?: unknown }
type RawPrice = {
  current_price?: { value?: unknown }
  price_labels?: unknown
  discount_pct?: unknown
  discount_complement?: RawTemplate
}
type RawComponent = {
  type?: unknown
  title?: { text?: unknown }
  price?: RawPrice
  seller?: RawTemplate
  shipping_v2?: unknown
  promotions?: unknown
}
type RawMetadata = {
  id?: unknown
  product_id?: unknown
  url?: unknown
  url_params?: unknown
  is_pad?: unknown
  category_id?: unknown
  domain_id?: unknown
  tracks?: { sold_quantity?: unknown }
}

export type Polycard = { metadata?: RawMetadata; pictures?: { pictures?: unknown }; components?: unknown }

export function findPolycards(root: unknown): Polycard[] {
  const found: Polycard[] = []
  const visited = new WeakSet<object>()
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (typeof node !== 'object' || node === null || visited.has(node)) continue
    visited.add(node)
    if (isRecord(node) && isRecord(node[POLYCARD_KEY])) found.push(node[POLYCARD_KEY])
    const children = Object.values(node)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return found
}

function valueText(value: RawValue | undefined): string {
  const label = text(value?.label?.text)
  if (label !== null) return label
  const amount = cents(value?.price?.value)
  return amount === null ? '' : formatCents(amount)
}

function valueFor(values: RawValue[], key: string): RawValue | undefined {
  return values.find((v) => String(v.key) === key)
}

function render(template: RawTemplate | undefined): string | null {
  const source = text(template?.text)
  if (source === null) return null
  const values = records<RawValue>(template?.values)
  const rendered = source
    .replace(PLACEHOLDER, (_, key: string) => valueText(valueFor(values, key)))
    .replace(SPACES, ' ')
    .trim()
  return rendered || null
}

function component(components: RawComponent[], type: string): RawComponent | undefined {
  return components.find((c) => c.type === type)
}

function thumbnail(pictures: Polycard['pictures']): string | null {
  return thumbnailOf(records<{ id?: unknown }>(pictures?.pictures)[0]?.id)
}

function listingUrl(metadata: RawMetadata | undefined): string | null {
  const path = text(metadata?.url)
  const url = path === null ? null : safeMlUrl(`${URL_SCHEME}${path}${text(metadata?.url_params) ?? ''}`)
  return url !== null && new URL(url).hostname !== CLICK_TRACKER_HOST ? url : null
}

function listPriceCents(price: RawPrice | undefined): number | null {
  const previous = records<RawTemplate>(price?.price_labels)
    .flatMap((priceLabel) => records<RawValue>(priceLabel.values))
    .find((v) => v.price?.previous === true)
  return cents(previous?.price?.value)
}

function isFull(entry: RawTemplate): boolean {
  return records<RawValue>(entry.values).some((v) => v.icon?.key === FULL_ICON_KEY)
}

function isFreeForEveryone(entry: RawTemplate): boolean {
  const values = records<RawValue>(entry.values)
  const texts = [entry.text, ...values.map((v) => v.pill?.text)]
  return texts.some((t) => FREE.test(text(t) ?? '')) && !values.some((v) => v.key === NEW_BUYER_KEY)
}

function startsWithPriceAfter(rendered: string, amount: number): boolean {
  const price = formatCents(amount)
  return rendered.startsWith(price) && AFTER_PRICE.test(rendered.slice(price.length))
}

function hintAmounts(entry: RawTemplate, rendered: string): Pick<CouponHint, 'amountOffCents' | 'priceAfterCents'> {
  const values = records<RawValue>(entry.values)
  let amountOffCents: number | null = null
  let priceAfterCents: number | null = null
  for (const [, key, off] of (text(entry.text) ?? '').matchAll(PRICE_PLACEHOLDER)) {
    const amount = cents(valueFor(values, key)?.price?.value)
    if (amount === null) continue
    if (off) amountOffCents ??= amount
    else if (startsWithPriceAfter(rendered, amount)) priceAfterCents ??= amount
  }
  return { amountOffCents, priceAfterCents }
}

function couponHint(components: RawComponent[]): CouponHint | null {
  const entry = components
    .filter((c) => c.type === 'promotions')
    .flatMap((c) => records<RawTemplate>(c.promotions))
    .find((p) => p.type === COUPON_PROMOTION)
  if (!entry) return null
  const hintText = render(entry)
  if (hintText === null) return null
  const percent = hintText.match(PERCENT_OFF)
  return {
    text: hintText,
    percentOff: percent ? Number(percent[1].replace(',', '.')) : null,
    ...hintAmounts(entry, hintText),
  }
}

export function parseCard(p: Polycard): ObservedCard | null {
  const metadata = p.metadata
  const components = records<RawComponent>(p.components)
  const id = text(metadata?.id)
  const title = text(component(components, 'title')?.title?.text)
  const price = component(components, 'price')?.price
  const priceCents = cents(price?.current_price?.value)
  if (id === null || title === null || priceCents === null) return null
  const isPad = String(metadata?.is_pad) === PAD_FLAG
  const basisText = render(price?.discount_complement)
  const shipping = component(components, 'shipping_v2')
  const shippingEntries = records<RawTemplate>(shipping?.shipping_v2)
  return {
    id,
    productId: text(metadata?.product_id),
    title,
    thumbnail: thumbnail(p.pictures),
    url: isPad ? null : listingUrl(metadata),
    isPad,
    priceCents,
    basisText,
    basis: basisFromComplement(basisText ?? undefined),
    listPriceCents: listPriceCents(price),
    mlDiscountPct: integer(price?.discount_pct),
    soldQuantity: integer(metadata?.tracks?.sold_quantity),
    full: shipping ? shippingEntries.some(isFull) : null,
    freeShipping: shipping ? shippingEntries.some(isFreeForEveryone) : null,
    categoryId: text(metadata?.category_id),
    domainId: text(metadata?.domain_id),
    sellerLabel: render(component(components, 'seller')?.seller),
    couponHint: couponHint(components),
  }
}

function fillNulls<T extends object>(kept: T, other: T, skipped: readonly (keyof T)[]): T {
  const filled = { ...kept }
  for (const key of Object.keys(filled) as (keyof T)[]) {
    if (filled[key] === null && !skipped.includes(key)) filled[key] = other[key]
  }
  return filled
}

function mergePair(first: ObservedCard, second: ObservedCard): ObservedCard {
  const [kept, other] = first.isPad && !second.isPad ? [second, first] : [first, second]
  const filled = fillNulls(kept, other, kept.priceCents === other.priceCents ? [] : PRICE_COUPLED)
  return { ...filled, basis: basisFromComplement(filled.basisText ?? undefined) }
}

export function mergeCards(cards: ObservedCard[]): ObservedCard[] {
  const byId = new Map<string, ObservedCard>()
  for (const card of cards) {
    const seen = byId.get(card.id)
    byId.set(card.id, seen ? mergePair(seen, card) : card)
  }
  return [...byId.values()]
}

export interface ListingCards {
  cards: ObservedCard[]
  found: number
  dropped: number
}

export function cardsOfResults(results: readonly unknown[]): ListingCards {
  const polycards = results.flatMap((entry): Polycard[] => (isRecord(entry) && isRecord(entry[POLYCARD_KEY]) ? [entry[POLYCARD_KEY]] : []))
  const parsed = polycards.map(parseCard).filter((card): card is ObservedCard => card !== null)
  return { cards: mergeCards(parsed), found: polycards.length, dropped: polycards.length - parsed.length }
}

export function cardsOfPage(pageProps: unknown): ListingCards {
  const initialState = isRecord(pageProps) ? pageProps[INITIAL_STATE_KEY] : undefined
  const results = isRecord(initialState) ? initialState[RESULTS_KEY] : undefined
  if (!Array.isArray(results)) throw new ListingResultsMissing()
  return cardsOfResults(results)
}
