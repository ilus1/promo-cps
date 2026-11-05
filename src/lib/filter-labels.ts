import type { CouponFilters } from '@/db/coupons'
import type { DealFilters } from './deal-query'
import { categoryLabel } from './deal-view'
import { STALE_AFTER_HOURS } from './constants'
import { STATUS_SAVED, type ItemStatus } from './domain'
import { formatCents, formatCount } from './format'
import { couponFiltersOf } from './coupon-query'
import {
  COUPON_KIND_LABEL, COUPON_SCOPE_LABEL, COUPON_STATUS_LABEL, DISCOUNT_MIN_LABEL, LIMIT_MIN_LABEL, MINIMUM_MAX_LABEL, ONLY_VERIFIED_LABEL, SAVING_MIN_LABEL, SHOW_INFLATED_LABEL,
} from './labels'

export const FILTER_TOGGLE_LABEL = {
  onlyDrops: 'Só abaixo do menor preço',
  full: 'FULL',
  freeShipping: 'Frete grátis',
  offersOnly: 'Só ofertas',
  showInflated: SHOW_INFLATED_LABEL,
  onlyVerified: ONLY_VERIFIED_LABEL,
  includeStale: `Incluir não lidos nas últimas ${STALE_AFTER_HOURS} h`,
} as const

export function freshnessApplies(tab: ItemStatus): boolean {
  return tab !== STATUS_SAVED
}

export const REMOVED_FACET_TEXT = 'removida'

export interface LabelFacets {
  searches: { id: string; name: string }[]
  coupons: { id: string; label: string }[]
}

export interface ActiveFilterLabels {
  text?: string
  search?: string
  coupon?: string
  couponSet?: string
  priceMax?: string
  discountMin?: string
  savingMin?: string
  savingMinCents?: string
  soldMin?: string
  category?: string
}

export function buscaRemoved(f: DealFilters, facets: LabelFacets): boolean {
  return f.searchId !== undefined && !facets.searches.some((s) => s.id === f.searchId)
}

export function activeFilterLabels(f: DealFilters, facets: LabelFacets): ActiveFilterLabels {
  const labels: ActiveFilterLabels = {}
  if (f.text) labels.text = `Texto: ${f.text}`
  if (f.searchId) labels.search = `Busca: ${facets.searches.find((s) => s.id === f.searchId)?.name ?? REMOVED_FACET_TEXT}`
  if (f.couponId) labels.coupon = `Cupom: ${facets.coupons.find((c) => c.id === f.couponId)?.label ?? f.couponId}`
  if (f.couponSetQuery) labels.couponSet = `${COUPON_SET_LABEL}: ${couponFilterSummary(couponFiltersOf(f.couponSetQuery))}`
  if (f.priceMaxCents !== undefined) labels.priceMax = `Preço até ${formatCents(f.priceMaxCents)}`
  if (f.discountMin) labels.discountMin = `${DISCOUNT_MIN_LABEL}: ${f.discountMin}%`
  if (f.savingMin) labels.savingMin = `${SAVING_MIN_LABEL}: ${f.savingMin}%`
  if (f.savingMinCents) labels.savingMinCents = `${SAVING_MIN_LABEL}: ${formatCents(f.savingMinCents)}`
  if (f.soldMin) labels.soldMin = `Vendidos: ${formatCount(f.soldMin)}+`
  if (f.category) labels.category = `Categoria: ${categoryLabel(f.category)}`
  return labels
}

export function filterChipLabels(f: DealFilters, facets: LabelFacets): string[] {
  const active = activeFilterLabels(f, facets)
  const chips = [active.text, active.search, active.coupon, active.couponSet, active.priceMax, active.discountMin, active.savingMin, active.savingMinCents]
  if (f.onlyDrops) chips.push(FILTER_TOGGLE_LABEL.onlyDrops)
  chips.push(active.soldMin)
  if (f.full) chips.push(FILTER_TOGGLE_LABEL.full)
  if (f.freeShipping) chips.push(FILTER_TOGGLE_LABEL.freeShipping)
  chips.push(active.category)
  if (f.offersOnly) chips.push(FILTER_TOGGLE_LABEL.offersOnly)
  if (f.onlyVerified) chips.push(FILTER_TOGGLE_LABEL.onlyVerified)
  if (f.showInflated) chips.push(FILTER_TOGGLE_LABEL.showInflated)
  if (f.includeStale) chips.push(FILTER_TOGGLE_LABEL.includeStale)
  return chips.filter((chip): chip is string => chip !== undefined)
}

export const COUPON_WITH_OFFERS_LABEL = 'Só com ofertas ligadas'

export interface ActiveCouponLabels {
  minimumMax?: string
  limitMin?: string
  discountMin?: string
  text?: string
}

export function activeCouponLabels(f: CouponFilters): ActiveCouponLabels {
  const labels: ActiveCouponLabels = {}
  if (f.minimumMaxCents) labels.minimumMax = `${MINIMUM_MAX_LABEL} ${formatCents(f.minimumMaxCents)}`
  if (f.limitMinCents) labels.limitMin = `${LIMIT_MIN_LABEL} ${formatCents(f.limitMinCents)}`
  if (f.discountMin) labels.discountMin = `${DISCOUNT_MIN_LABEL}: ${f.discountMin}%`
  if (f.text) labels.text = `Texto: ${f.text}`
  return labels
}

export const COUPON_SET_LABEL = 'Cupons'

export function couponFilterSummary(f: CouponFilters): string {
  const active = activeCouponLabels(f)
  const parts = [
    f.status && COUPON_STATUS_LABEL[f.status],
    f.scope && COUPON_SCOPE_LABEL[f.scope],
    f.kind && f.kind !== 'unparsed' && COUPON_KIND_LABEL[f.kind],
    f.expiringWithinDays && `vencem em até ${f.expiringWithinDays} ${f.expiringWithinDays === 1 ? 'dia' : 'dias'}`,
    active.minimumMax,
    active.limitMin,
    active.discountMin,
    f.withOffers && COUPON_WITH_OFFERS_LABEL,
    active.text,
  ]
  return parts.filter(Boolean).join(', ')
}
