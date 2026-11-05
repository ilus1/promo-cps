import { CENTS_PER_REAL } from './constants'
import { canonicalCouponFilterQuery } from './coupon-query'
import { searchTextOf } from './text-search'
import { ITEM_STATUSES, type ItemStatus } from './domain'
import { clampPage, FIRST_PAGE, PAGE_PARAM, pageFromParams } from './paging'
import { centsFromReais, lookup, num, searchParamsToRecord, str, wholePercent, type QueryParams } from './query-params'
import { ROUTES } from './routes'

export type DealParams = QueryParams

export const DEAL_FILTER_KEYS = [
  'q', 'busca', 'cupom', 'cupons', 'precoMax', 'descontoMin', 'economiaMin', 'economiaReaisMin', 'queda', 'vendidosMin', 'full', 'frete', 'categoria',
  'inflados', 'verificados', 'ofertas', 'antigos', 'sort',
] as const
export type DealFilterKey = (typeof DEAL_FILTER_KEYS)[number]

export const DEAL_SORTS = ['desconto', 'queda', 'preco', 'recentes', 'economia', 'economiaReais', 'economiaCupom', 'economiaReal'] as const
export type DealSort = (typeof DEAL_SORTS)[number]
export const DEFAULT_DEAL_SORT: DealSort = DEAL_SORTS[0]

const NON_ALERT_KEYS: readonly DealFilterKey[] = ['sort', 'ofertas']
const ALERT_KEYS = DEAL_FILTER_KEYS.filter((k) => !NON_ALERT_KEYS.includes(k)).sort()

const FLAG_ON = '1'

export interface DealFilters {
  text?: string
  searchId?: string
  couponId?: string
  couponSetQuery?: string
  priceMaxCents?: number
  discountMin?: number
  savingMin?: number
  savingMinCents?: number
  onlyDrops: boolean
  soldMin?: number
  full: boolean
  freeShipping: boolean
  offersOnly: boolean
  includeStale: boolean
  showInflated: boolean
  onlyVerified: boolean
  sort: DealSort
  category?: string
}

const flag = (v: string | string[] | undefined) => v === FLAG_ON

function wholeMin(v: string | string[] | undefined): number | undefined {
  const n = Math.ceil(num(v) ?? 0)
  return n > 0 ? n : undefined
}

function dealSort(v: string | string[] | undefined): DealSort {
  return DEAL_SORTS.find((s) => s === v) ?? DEFAULT_DEAL_SORT
}

export function dealFiltersFromParams(sp: DealParams): DealFilters {
  return {
    text: searchTextOf(sp.q),
    searchId: str(sp.busca),
    couponId: str(sp.cupom),
    couponSetQuery: canonicalCouponFilterQuery(str(sp.cupons)),
    priceMaxCents: centsFromReais(sp.precoMax) || undefined,
    discountMin: wholePercent(num(sp.descontoMin)),
    savingMin: wholePercent(num(sp.economiaMin)),
    savingMinCents: centsFromReais(sp.economiaReaisMin) || undefined,
    onlyDrops: flag(sp.queda),
    soldMin: wholeMin(sp.vendidosMin),
    full: flag(sp.full),
    freeShipping: flag(sp.frete),
    offersOnly: flag(sp.ofertas),
    includeStale: flag(sp.antigos),
    showInflated: flag(sp.inflados),
    onlyVerified: flag(sp.verificados),
    sort: dealSort(sp.sort),
    category: str(sp.categoria),
  }
}

const flagParam = (on: boolean) => (on ? FLAG_ON : undefined)

export function filterParams(f: DealFilters): Record<DealFilterKey, string | undefined> {
  return {
    q: f.text,
    busca: f.searchId,
    cupom: f.couponId,
    cupons: f.couponSetQuery,
    precoMax: f.priceMaxCents === undefined ? undefined : String(f.priceMaxCents / CENTS_PER_REAL),
    descontoMin: wholePercent(f.discountMin)?.toString(),
    economiaMin: wholePercent(f.savingMin)?.toString(),
    economiaReaisMin: f.savingMinCents === undefined ? undefined : String(f.savingMinCents / CENTS_PER_REAL),
    queda: flagParam(f.onlyDrops),
    vendidosMin: f.soldMin?.toString(),
    full: flagParam(f.full),
    frete: flagParam(f.freeShipping),
    categoria: f.category,
    ofertas: flagParam(f.offersOnly),
    antigos: flagParam(f.includeStale),
    inflados: flagParam(f.showInflated),
    verificados: flagParam(f.onlyVerified),
    sort: f.sort,
  }
}

export function alertFilters(query: string): DealFilters {
  return dealFiltersFromParams(searchParamsToRecord(new URLSearchParams(query)))
}

export function alertQueryOf(f: DealFilters): string {
  const values = filterParams(f)
  const out = new URLSearchParams()
  for (const key of ALERT_KEYS) {
    const value = values[key]
    if (value !== undefined) out.append(key, value)
  }
  return out.toString()
}

const ALERT_WIDENING_KEYS: readonly DealFilterKey[] = ['antigos', 'inflados']

export function alertNarrows(f: DealFilters): boolean {
  const values = filterParams(f)
  return ALERT_KEYS.some((key) => !ALERT_WIDENING_KEYS.includes(key) && values[key] !== undefined)
}

export function normalizeAlertQuery(params: URLSearchParams): string {
  return alertQueryOf(dealFiltersFromParams(searchParamsToRecord(params)))
}

export const TAB_PARAM: Record<ItemStatus, string> = {
  NOT_SEEN: 'novos',
  SAVED: 'salvos',
  SEEN: 'vistos',
}
export const DEFAULT_DEAL_TAB: ItemStatus = ITEM_STATUSES[0]

const TAB_KEY = 'aba'

export interface DealListOptions extends DealFilters {
  tab: ItemStatus | readonly ItemStatus[]
  observedSince?: Date
}
export interface DealQuery extends DealFilters {
  tab: ItemStatus
  page: number
}

export function parseDealQuery(sp: DealParams): DealQuery {
  const tab = str(sp[TAB_KEY])
  return {
    ...dealFiltersFromParams(sp),
    tab: lookup(TAB_PARAM, ITEM_STATUSES, tab) ?? DEFAULT_DEAL_TAB,
    page: pageFromParams(sp),
  }
}

export function dealSearchParams(query: DealQuery, changes: Partial<DealQuery> = {}): URLSearchParams {
  const filterChanged = Object.keys(changes).some((key) => key !== 'page')
  const next = { ...query, ...changes }
  const page = 'page' in changes || !filterChanged ? clampPage(next.page) : FIRST_PAGE
  const values = filterParams(next)
  const params = new URLSearchParams()
  for (const key of DEAL_FILTER_KEYS) {
    const value = values[key]
    if (value === undefined || (key === 'sort' && next.sort === DEFAULT_DEAL_SORT)) continue
    params.set(key, value)
  }
  if (next.tab !== DEFAULT_DEAL_TAB) params.set(TAB_KEY, TAB_PARAM[next.tab])
  if (page > FIRST_PAGE) params.set(PAGE_PARAM, String(page))
  return params
}

export function dealHref(query: DealQuery, changes: Partial<DealQuery> = {}): string {
  const queryString = dealSearchParams(query, changes).toString()
  return queryString ? `${ROUTES.offers}?${queryString}` : ROUTES.offers
}

export function viewsDrops(f: Pick<DealFilters, 'sort' | 'onlyDrops'>): boolean {
  return f.onlyDrops || f.sort === 'queda'
}

export function hasDealFilters(query: DealFilters): boolean {
  const values = filterParams(query)
  return DEAL_FILTER_KEYS.some((key) => key !== 'sort' && values[key] !== undefined)
}

type FilterKeyOfQuery = Exclude<keyof DealFilters, 'sort'>

export const CLEARED_FILTERS = {
  text: undefined,
  searchId: undefined,
  couponId: undefined,
  couponSetQuery: undefined,
  priceMaxCents: undefined,
  discountMin: undefined,
  savingMin: undefined,
  savingMinCents: undefined,
  onlyDrops: false,
  soldMin: undefined,
  full: false,
  freeShipping: false,
  offersOnly: false,
  includeStale: false,
  showInflated: false,
  onlyVerified: false,
  category: undefined,
} satisfies { [K in FilterKeyOfQuery]-?: DealFilters[K] }

const UNFILTERED_QUERY = parseDealQuery({})

export function offersByCouponHref(campaignId: string): string {
  return dealHref(UNFILTERED_QUERY, { couponId: campaignId })
}

export function offersByBuscaHref(searchId: string): string {
  return dealHref(UNFILTERED_QUERY, { searchId })
}

export function offersByCouponSetHref(couponFilterQuery: string): string {
  return dealHref(UNFILTERED_QUERY, { couponSetQuery: canonicalCouponFilterQuery(couponFilterQuery) })
}
