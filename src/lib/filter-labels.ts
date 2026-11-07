import type { CouponFilters } from '@/db/coupons'
import { formatCents } from './format'
import { DISCOUNT_MIN_LABEL, LIMIT_MIN_LABEL, MINIMUM_MAX_LABEL } from './labels'

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
