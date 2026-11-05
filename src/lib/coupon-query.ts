import type { CouponFilters } from '@/db/coupons'
import { CENTS_PER_REAL, MAX_EXPIRY_FILTER_DAYS, UNCAPPED_FROM_CENTS } from './constants'
import { normalizeSearchText, searchTextOf } from './text-search'
import {
  COUPON_KINDS, COUPON_LIST_STATUSES, COUPON_SCOPES, COUPON_SORTS, DEFAULT_COUPON_SORT,
  type CouponListStatus, type CouponScope, type CouponSort, type FilterableKind,
} from './domain'
import { FIRST_PAGE, PAGE_PARAM, pageFromParams } from './paging'
import { centsFromReais, lookup, num, searchParamsToRecord, str, wholePercent, type QueryParams } from './query-params'
import { ROUTES } from './routes'

export type CouponParams = QueryParams
export type CouponQuery = CouponFilters & { page: number; order: CouponSort }

export const STATUS_PARAM: Record<CouponListStatus, string> = {
  active: 'ativo',
  inactive: 'inativo',
  ended: 'encerrado',
}

export const SCOPE_PARAM: Record<CouponScope, string> = {
  ml: 'ml',
  store: 'loja',
}

export const FILTERABLE_KINDS = COUPON_KINDS.filter((kind): kind is FilterableKind => kind !== 'unparsed')

const WITH_OFFERS_ON = '1'

export const CLEARED_COUPON_FILTERS = {
  status: undefined,
  scope: undefined,
  kind: undefined,
  expiringWithinDays: undefined,
  minimumMaxCents: undefined,
  limitMinCents: undefined,
  discountMin: undefined,
  withOffers: undefined,
  text: undefined,
} satisfies Record<keyof CouponFilters, undefined>

const FILTER_ONLY_KEYS = Object.keys(CLEARED_COUPON_FILTERS) as (keyof CouponFilters)[]
const FILTER_KEYS: readonly (keyof CouponQuery)[] = [...FILTER_ONLY_KEYS, 'order']

function limitMinOf(raw: string | string[] | undefined): number | undefined {
  const cents = centsFromReais(raw)
  return cents ? Math.min(cents, UNCAPPED_FROM_CENTS) : undefined
}

export function hasCouponFilters(query: CouponFilters): boolean {
  return FILTER_ONLY_KEYS.some((key) => Boolean(query[key]))
}

export function parseCouponQuery(sp: CouponParams): CouponQuery {
  const kind = str(sp.tipo)
  const days = Math.floor(num(sp.vence) ?? 0)
  const order = str(sp.ordem)
  return {
    status: lookup(STATUS_PARAM, COUPON_LIST_STATUSES, str(sp.status)),
    scope: lookup(SCOPE_PARAM, COUPON_SCOPES, str(sp.escopo)),
    kind: FILTERABLE_KINDS.find((k) => k === kind),
    expiringWithinDays: days >= 1 ? Math.min(days, MAX_EXPIRY_FILTER_DAYS) : undefined,
    minimumMaxCents: centsFromReais(sp.minimoMax) || undefined,
    limitMinCents: limitMinOf(sp.limiteMin),
    discountMin: wholePercent(num(sp.descontoMin)),
    withOffers: str(sp.comOfertas) === WITH_OFFERS_ON ? true : undefined,
    text: searchTextOf(sp.q),
    order: COUPON_SORTS.find((sort) => sort === order) ?? DEFAULT_COUPON_SORT,
    page: pageFromParams(sp),
  }
}

function couponFilterParams(next: CouponFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (next.status) params.set('status', STATUS_PARAM[next.status])
  if (next.scope) params.set('escopo', SCOPE_PARAM[next.scope])
  if (next.kind) params.set('tipo', next.kind)
  if (next.expiringWithinDays) params.set('vence', String(next.expiringWithinDays))
  if (next.minimumMaxCents) params.set('minimoMax', String(next.minimumMaxCents / CENTS_PER_REAL))
  if (next.limitMinCents) params.set('limiteMin', String(next.limitMinCents / CENTS_PER_REAL))
  const discountMin = wholePercent(next.discountMin)
  if (discountMin) params.set('descontoMin', String(discountMin))
  if (next.withOffers) params.set('comOfertas', WITH_OFFERS_ON)
  const text = next.text && normalizeSearchText(next.text)
  if (text) params.set('q', text)
  return params
}

export function couponFilterQuery(query: CouponFilters): string {
  return couponFilterParams(query).toString()
}

export function couponFiltersOf(rawQuery: string): CouponQuery {
  return parseCouponQuery(searchParamsToRecord(new URLSearchParams(rawQuery)))
}

export function canonicalCouponFilterQuery(rawQuery: string | undefined): string | undefined {
  if (!rawQuery) return undefined
  const filters = couponFiltersOf(rawQuery)
  return hasCouponFilters(filters) ? couponFilterQuery(filters) : undefined
}

export function couponHref(query: CouponQuery, changes: Partial<CouponQuery> = {}): string {
  const filterChanged = FILTER_KEYS.some((key) => key in changes)
  const next = { ...query, ...changes }
  const page = 'page' in changes || !filterChanged ? next.page : FIRST_PAGE
  const params = couponFilterParams(next)
  if (next.order && next.order !== DEFAULT_COUPON_SORT) params.set('ordem', next.order)
  if (page > FIRST_PAGE) params.set(PAGE_PARAM, String(page))
  const queryString = params.toString()
  return queryString ? `${ROUTES.coupons}?${queryString}` : ROUTES.coupons
}
