import { couponLabel, type LabeledCoupon } from './coupon-label'
import { COUPON_BASES } from '@/ingestion/ml/basis'
import { DAY_MS, HISTORY_DAYS, HISTORY_MIN_DAYS } from './constants'
import { STATUS_NOT_SEEN, type ItemStatus, type MatchConfidence, type PriceCheckStatus } from './domain'
import { hintIsPrice, hintMatches, hintOfText } from './coupon-hint'
import { formatAgo, formatCents, formatCount, formatDate, formatDayMonth, formatPercent, formatPercentOneDecimal } from './format'
import { couponPart, finalPrice, totalSaving, type LinkedCouponTerms, type PricedItem } from './deal-saving'
import { minimumGap, eachCents } from './minimum-gap'
import type { PriceHistory } from './price-history'
import { compareLinks } from './price-compare/links'
import {
  AMAZON_LABEL, BUSCAPE_LABEL, CHEAPER_SIBLING_LABEL, GOOGLE_SHOPPING_LABEL, MAGALU_LABEL, NO_REAL_SAVING_LABEL, OUTSIDE_ML_LABEL, POSSIBLE_EQUIVALENT_LABEL, REAL_SAVING_LABEL,
} from './labels'
import { BELOW_MINIMUM_TEXT, COUPON_PART_LABEL, HINT_PRICE_LINE_LABEL, COUPON_PRICE_LABEL, SELLER_DISCOUNT_LABEL, PRICE_DROPPED_SINCE_SEEN_LABEL, ESTIMATED_TEXT, HINT_LINE_LABEL, HINT_UNKNOWN_TERMS_TEXT, NO_EXPIRY_TEXT, SAVING_TOTAL_LABEL, SELLER_LABEL } from './labels'

export const NO_BASIS_TEXT = 'sem desconto de Pix/Cupom'
export const NO_HISTORY_TEXT = 'sem histórico'
export const MAX_COUPON_CHIPS = 3
const LINE_JOINER = ' - '
const SINGLE_STORE = 1

export interface DealCoupon extends LinkedCouponTerms, LabeledCoupon {
  campaignId: string
  expiresAt: Date | null
}

export type SavingRow = PricedItem & {
  couponHint: string | null
  coupons: readonly LinkedCouponTerms[]
}

export interface SavingLines {
  saving: string | null
  couponPrice: string | null
  hint: string | null
}

export function savingLines(row: SavingRow): SavingLines {
  const final = finalPrice(row, row.coupons)
  const total = totalSaving(row, final)
  return {
    saving: total.savingCents > 0 && total.ratio !== null
      ? `${SAVING_TOTAL_LABEL}: ${formatCents(total.savingCents)} (${formatPercentOneDecimal(total.ratio)})`
      : null,
    couponPrice: final.estimated
      ? `${COUPON_PRICE_LABEL}: ${formatCents(final.cents)} (${ESTIMATED_TEXT}, -${formatCents(row.priceCents - final.cents)})`
      : null,
    hint: final.estimated ? null : hintLine(row),
  }
}

function hintLine(row: SavingRow): string | null {
  if (row.couponHint === null) return null
  const hint = hintOfText(row.couponHint)
  const text = couponHintText(row.couponHint)
  if (hintIsPrice(hint)) return `${HINT_PRICE_LINE_LABEL}: ${text}`
  const shown = row.coupons.slice(0, MAX_COUPON_CHIPS)
  if (shown.some((coupon) => hintMatches(hint, row.priceCents, coupon))) return null
  return `${HINT_LINE_LABEL}: ${text} (${HINT_UNKNOWN_TERMS_TEXT})`
}

export function basisLabel(basisText: string | null): string {
  return basisText ?? NO_BASIS_TEXT
}

export function discountLine(mlDiscountPct: number | null, listPriceCents: number | null): string | null {
  if (mlDiscountPct === null || mlDiscountPct <= 0) return null
  const off = `${mlDiscountPct}% OFF`
  return listPriceCents === null ? off : `${off}, de ${formatCents(listPriceCents)}`
}

export function dropBadge(dropRatio: number | null): string | null {
  if (dropRatio === null || dropRatio <= 0) return null
  return `${formatPercent(dropRatio)} abaixo do menor preço em ${HISTORY_DAYS} dias`
}

export function couponChip(coupon: DealCoupon, priceCents: number, minimumStated = false): { text: string; minimum: string | null } {
  const until = coupon.expiresAt ? `até ${formatDate(coupon.expiresAt)}` : NO_EXPIRY_TEXT
  const minimum = coupon.minPaymentCents !== null && coupon.minPaymentCents > 0 ? coupon.minPaymentCents : null
  const terms = minimum === null || minimumStated ? until : `mín. ${formatCents(minimum)}, ${until}`
  return {
    text: `na lista do cupom: ${couponLabel(coupon)} (${terms})`,
    minimum: minimum !== null && priceCents < minimum ? BELOW_MINIMUM_TEXT : null,
  }
}

export function observedLine(observedAt: Date, now: Date): string {
  return `lido ${formatAgo(observedAt, now)}`
}

export function priceDroppedLine(
  status: ItemStatus, seenPriceCents: number | null, priceCents: number,
): string | null {
  if (status !== STATUS_NOT_SEEN || seenPriceCents === null || seenPriceCents <= priceCents) return null
  return `${PRICE_DROPPED_SINCE_SEEN_LABEL}: era ${formatCents(seenPriceCents)}`
}

export function soldLine(soldQuantity: number | null): string | null {
  if (soldQuantity === null || soldQuantity <= 0) return null
  return soldQuantity === 1 ? '1 vendido' : `${formatCount(soldQuantity)} vendidos`
}

const TRAILING_WITH_COUPON = /\s+com cupom$/i

export function couponHintText(hint: string): string {
  return hint.replace(TRAILING_WITH_COUPON, '')
}

const DOMAIN_PREFIX = /^[A-Z]+-/
const WORD_SEPARATOR = /_/g

export function categoryLabel(domainId: string): string {
  if (!DOMAIN_PREFIX.test(domainId)) return domainId
  const words = domainId.replace(DOMAIN_PREFIX, '').replace(WORD_SEPARATOR, ' ').toLowerCase()
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : domainId
}

export function countsLine(items: number, offers: number): string {
  return `${formatCount(items)} ${items === 1 ? 'item' : 'itens'}, ${formatCount(offers)} ${offers === 1 ? 'oferta' : 'ofertas'}`
}

const BRAND_STORE_SEPARATOR = ' por '

export function sellerName(sellerLabel: string | null): string | null {
  if (!sellerLabel) return null
  const at = sellerLabel.indexOf(BRAND_STORE_SEPARATOR)
  if (at < 0) return null
  return sellerLabel.slice(at + BRAND_STORE_SEPARATOR.length).trim() || null
}

export function sellerLine(sellerLabel: string | null): string | null {
  const seller = sellerName(sellerLabel)
  return seller ? `${SELLER_LABEL} ${seller}` : null
}

export function historyLine(history: PriceHistory | null): string | null {
  if (history === null) return null
  const since = `mesmo preço desde ${formatDayMonth(history.currentSince)}`
  if (history.segments <= 1 || (history.lowestCents !== null && history.lowestCents === history.highestCents)) return capitalized(since)
  const range = history.lowestCents !== null && history.highestCents !== null
    ? `: menor ${formatCents(history.lowestCents)}, maior ${formatCents(history.highestCents)}`
    : ''
  return `Desde ${formatDayMonth(history.firstReadAt)}${range}${LINE_JOINER}${since}`
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

export function dropsNotice(earliestSegmentAt: Date | null, now: Date): string | null {
  if (earliestSegmentAt === null) return null
  const firstDropAt = new Date(earliestSegmentAt.getTime() + HISTORY_MIN_DAYS * DAY_MS)
  if (firstDropAt <= now) return null
  return `Quedas reais aparecem a partir de ${formatDayMonth(firstDropAt)} (${HISTORY_MIN_DAYS} dias de histórico)`
}

export function couponPartLine(row: SavingRow): string | null {
  const part = couponPart(row, row.coupons)
  if (part === null) return null
  const coupon = `${COUPON_PART_LABEL}: -${formatCents(part.couponCents)} (${ESTIMATED_TEXT})`
  return part.sellerCents > 0 ? `${coupon}${LINE_JOINER}${SELLER_DISCOUNT_LABEL}: -${formatCents(part.sellerCents)}` : coupon
}

export interface MinimumGapLine {
  text: string
  couponId: string
}

export function minimumGapLine(
  row: Pick<PricedItem, 'priceCents' | 'basis'>, coupons: readonly DealCoupon[],
): MinimumGapLine | null {
  if (COUPON_BASES.includes(row.basis)) return null
  const gap = minimumGap(row.priceCents, coupons)
  if (gap === null) return null
  const missing = `Faltam ${formatCents(gap.gapCents)} para o pedido mínimo de ${formatCents(gap.minimumCents)}`
  const coupon = coupons.find((c) => c.campaignId === gap.campaignId)
  if (!coupon) return null
  const { units, valueCents } = gap.reach
  return {
    text: `${missing} (cupom ${couponLabel(coupon)}); com ${units} unidades o cupom vale ${formatCents(valueCents)} (${formatCents(eachCents(gap.reach))} cada)`,
    couponId: coupon.campaignId,
  }
}

export interface DealPriceCheck {
  status: PriceCheckStatus
  confidence: MatchConfidence | null
  marketLowCents: number | null
  marketStore: string | null
  storeCount: number | null
  finalCents: number
  inflated: boolean
  realSavingCents: number | null
}

export interface DealSibling {
  id: string
  url: string | null
  priceCents: number
}

export interface PriceCompareLines {
  inflated: boolean
  line: string | null
  noEquivalent: boolean
}

function marketText(check: DealPriceCheck & { marketLowCents: number }): string {
  return check.marketStore ? `${formatCents(check.marketLowCents)} na ${check.marketStore}` : formatCents(check.marketLowCents)
}

function highConfidenceLine(check: DealPriceCheck & { marketLowCents: number }): string | null {
  const market = marketText(check)
  if (check.inflated) {
    const stores = check.storeCount === null || check.storeCount <= SINGLE_STORE ? '' : ` (${check.storeCount} lojas)`
    return `${OUTSIDE_ML_LABEL}: ${market}${stores}; aqui ${formatCents(check.finalCents)}`
  }
  if (check.realSavingCents === null) return null
  if (check.realSavingCents <= 0) return `${NO_REAL_SAVING_LABEL}: ${market}`
  return `${REAL_SAVING_LABEL}: ${formatCents(check.realSavingCents)} (${formatPercentOneDecimal(check.realSavingCents / check.marketLowCents)}) vs ${market}`
}

export function priceCompareLines(check: DealPriceCheck | null): PriceCompareLines {
  if (check === null) return { inflated: false, line: null, noEquivalent: false }
  if (check.status === 'no_match') return { inflated: false, line: null, noEquivalent: true }
  if (check.status !== 'matched' || check.marketLowCents === null) return { inflated: false, line: null, noEquivalent: false }
  const priced = { ...check, marketLowCents: check.marketLowCents }
  const line = check.confidence === 'high'
    ? highConfidenceLine(priced)
    : check.confidence === 'medium' ? `${POSSIBLE_EQUIVALENT_LABEL}: ${marketText(priced)}` : null
  return { inflated: check.inflated, line, noEquivalent: false }
}

export function siblingLine(sibling: DealSibling | null): { text: string; url: string | null } | null {
  if (sibling === null) return null
  return { text: `${CHEAPER_SIBLING_LABEL}: ${formatCents(sibling.priceCents)}`, url: sibling.url }
}

export interface CompareLinkItem {
  label: string
  href: string
}

export function compareLinkItems(title: string): CompareLinkItem[] {
  const links = compareLinks(title)
  if (links === null) return []
  return [
    { label: BUSCAPE_LABEL, href: links.buscape },
    { label: GOOGLE_SHOPPING_LABEL, href: links.googleShopping },
    { label: AMAZON_LABEL, href: links.amazon },
    { label: MAGALU_LABEL, href: links.magalu },
  ]
}

export const HIDDEN_REASON_TEXT = '(desconto inflado ou anúncio igual mais barato)'

export function hiddenNote(hidden: number): { link: string; rest: string } {
  return { link: `${formatCount(hidden)} ${hidden === 1 ? 'oculto' : 'ocultos'}`, rest: HIDDEN_REASON_TEXT }
}
