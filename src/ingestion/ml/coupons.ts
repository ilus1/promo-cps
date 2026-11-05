import { CENTS_PER_REAL, MAX_DISCOUNT_PERCENT, PERCENT_BASE } from '@/lib/constants'
import { safeMlUrl } from '@/lib/ml-url'
import type { CouponKind } from '@/lib/domain'
import { firstLine } from '../errors'
import { parseAmountCents } from './amounts'

export const COUPON_STATUS_ACTIVE = 'ACTIVE'
export const COUPON_STATUS_INACTIVE = 'INACTIVE'
export const ACTIVATION_EU_QUERO = 'EU_QUERO'
export const COUPON_ACTION_LINK = 'link'
export const COUPON_PAGE_WITHOUT_DATA = 'Página de cupons sem dados'
export const COUPON_PAGE_BAD_COUNT = 'Página de cupons com contagem inválida'
export const STORE_SCOPE_PREFIX = 'Em produtos de '
const PERCENT_SIGN = '%'
const REAIS_SIGN = 'R$'

export function storeName(scopeLabel: string | null): string | undefined {
  return scopeLabel?.startsWith(STORE_SCOPE_PREFIX) ? scopeLabel.slice(STORE_SCOPE_PREFIX.length) : undefined
}

type Amount = { fractional_amount?: string; decimal_amount?: string }
export interface RawCoupon {
  campaign_id: string
  title?: { text?: string; accessibility?: { title?: Amount } }
  initial_subtitle?: { text?: string }
  amount?: { accessibility?: { min_amount?: Amount; cap_amount?: Amount } }
  status?: { id?: string }
  activation_type?: string
  code?: string
  action?: { type?: string; text?: string; value?: string; accessibility?: { sr_label?: string } }
  future_coupon_info?: { start_date?: string; expiration_date?: string }
}

export interface ParsedCoupon {
  campaignId: string
  title: string
  kind: CouponKind
  percentOff: number | null
  amountOffCents: number | null
  minPaymentCents: number | null
  capCents: number | null
  scopeLabel: string | null
  isStore: boolean
  status: string
  activationType: string | null
  activateCode: string | null
  listingUrl: string | null
  startsAt: Date | null
  expiresAt: Date | null
}

function cents(a: Amount | undefined): number | null {
  return parseAmountCents(a?.fractional_amount, a?.decimal_amount)
}

function date(s: string | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function mlLink(action: RawCoupon['action']): string | null {
  if (action?.type !== COUPON_ACTION_LINK || !action.value) return null
  return safeMlUrl(action.value)
}

export function parseCoupon(raw: RawCoupon): ParsedCoupon {
  const title = raw.title?.text?.trim() ?? ''
  const headline = cents(raw.title?.accessibility?.title)
  const kind: CouponKind = headline === null ? 'unparsed'
    : title.startsWith(REAIS_SIGN) ? 'fixed'
      : title.includes(PERCENT_SIGN) ? 'percent' : 'unparsed'
  const scopeLabel = raw.initial_subtitle?.text?.trim() || null
  return {
    campaignId: raw.campaign_id,
    title,
    kind,
    percentOff: kind === 'percent' && headline !== null ? headline / CENTS_PER_REAL : null,
    amountOffCents: kind === 'fixed' ? headline : null,
    minPaymentCents: cents(raw.amount?.accessibility?.min_amount),
    capCents: cents(raw.amount?.accessibility?.cap_amount),
    scopeLabel,
    isStore: scopeLabel?.startsWith(STORE_SCOPE_PREFIX) ?? false,
    status: raw.status?.id ?? 'UNKNOWN',
    activationType: raw.activation_type ?? null,
    activateCode: raw.code?.trim() || null,
    listingUrl: mlLink(raw.action),
    startsAt: date(raw.future_coupon_info?.start_date),
    expiresAt: date(raw.future_coupon_info?.expiration_date),
  }
}

export interface CouponPage {
  coupons: { parsed: ParsedCoupon; raw: RawCoupon }[]
  pageNumber: number
  totalPages: number
  totalCoupons: number
  skipped: number
}

export type CouponPageParse = { ok: true; page: CouponPage } | { ok: false; error: string }

type CouponPageData = {
  rawCoupons: unknown[]; pagination?: { total?: unknown; page?: unknown }; totalCouponsQuantity?: { number?: unknown }
}

function isCouponPageData(data: unknown): data is CouponPageData {
  return typeof data === 'object' && data !== null && 'rawCoupons' in data && Array.isArray(data.rawCoupons)
}

function hasCampaignId(raw: unknown): raw is RawCoupon {
  return typeof raw === 'object' && raw !== null && 'campaign_id' in raw && Boolean(raw.campaign_id)
}

function countOf(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw new Error(`${COUPON_PAGE_BAD_COUNT}: ${field}`)
}

export function parseCouponPage(pageProps: Record<string, unknown>): CouponPage {
  const data = pageProps.filteredCouponsData
  if (!isCouponPageData(data)) throw new Error(COUPON_PAGE_WITHOUT_DATA)
  const pageNumber = countOf(data.pagination?.page, 'pagination.page')
  const totalPages = countOf(data.pagination?.total, 'pagination.total')
  const totalCoupons = countOf(data.totalCouponsQuantity?.number, 'totalCouponsQuantity.number')
  const coupons = data.rawCoupons.filter(hasCampaignId).map((raw) => ({ parsed: parseCoupon(raw), raw }))
  return { coupons, pageNumber, totalPages, totalCoupons, skipped: data.rawCoupons.length - coupons.length }
}

export function tryParseCouponPage(pageProps: Record<string, unknown>): CouponPageParse {
  try {
    return { ok: true, page: parseCouponPage(pageProps) }
  } catch (e) {
    return { ok: false, error: firstLine(e) }
  }
}

export type StrengthFields = Pick<ParsedCoupon, 'isStore' | 'kind' | 'percentOff' | 'amountOffCents' | 'minPaymentCents'>

export function equivalentPercent(c: Omit<StrengthFields, 'isStore'>): number | null {
  if (c.kind === 'percent') return c.percentOff
  if (c.kind !== 'fixed' || !c.amountOffCents || !c.minPaymentCents) return null
  return Math.min(MAX_DISCOUNT_PERCENT, (c.amountOffCents / c.minPaymentCents) * PERCENT_BASE)
}

export function compareStrength(a: StrengthFields, b: StrengthFields): number {
  if (a.isStore !== b.isStore) return a.isStore ? 1 : -1
  const ea = equivalentPercent(a)
  const eb = equivalentPercent(b)
  if (ea === null || eb === null) return ea === eb ? 0 : ea === null ? 1 : -1
  return eb - ea
}
