import { MAX_DISCOUNT_PERCENT, PERCENT_BASE, TRIVIAL_SAVING_CENTS, UNCAPPED_FROM_CENTS } from './constants'
import type { CouponKind } from './domain'

export function isUncapped(capCents: number | null): boolean {
  return capCents !== null && capCents >= UNCAPPED_FROM_CENTS
}

export function validPercent(percentOff: number | null): percentOff is number {
  return percentOff !== null && percentOff > 0 && percentOff <= MAX_DISCOUNT_PERCENT
}

export function discountAtMinimum(
  kind: CouponKind,
  percentOff: number | null,
  amountOffCents: number | null,
  minPaymentCents: number | null,
  capCents: number | null,
): number | null {
  const minimum = minPaymentCents ?? 0
  if (kind === 'fixed') {
    if (amountOffCents === null || amountOffCents <= 0) return null
    return amountOffCents / Math.max(minimum, amountOffCents)
  }
  if (kind !== 'percent' || !validPercent(percentOff)) return null
  const ratio = percentOff / PERCENT_BASE
  if (minimum <= 0 || capCents === null || isUncapped(capCents)) return ratio
  return Math.min(ratio, capCents / minimum)
}

export function isUnboundedSaving(kind: CouponKind, capCents: number | null): boolean {
  return kind === 'percent' && (capCents === null || isUncapped(capCents))
}

export function maxSavingCents(
  kind: CouponKind, amountOffCents: number | null, capCents: number | null,
): number | null {
  if (kind === 'fixed') return amountOffCents !== null && amountOffCents > 0 ? amountOffCents : null
  if (kind !== 'percent' || isUnboundedSaving(kind, capCents)) return null
  return capCents
}

export function effectiveLimitCents(
  kind: CouponKind, amountOffCents: number | null, capCents: number | null,
): number | null {
  if (kind === 'unparsed') return capCents
  return maxSavingCents(kind, amountOffCents, capCents)
}

export function isTrivialSaving(saving: number | null): boolean {
  return saving !== null && saving < TRIVIAL_SAVING_CENTS
}

export function fullPercentUpTo(percentOff: number | null, capCents: number | null): number | null {
  if (!validPercent(percentOff) || capCents === null || isUncapped(capCents)) return null
  return Math.round((capCents * PERCENT_BASE) / percentOff)
}
