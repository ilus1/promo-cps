import { HOUR_MS, MARKET_CHECK_VALID_HOURS, PERCENT_BASE, SIBLING_CHEAPER_PERCENT } from '../constants'
import { STATUS_SAVED, type ItemStatus, type MatchConfidence, type PriceCheckStatus } from '../domain'

export type VerdictCheck = {
  status: PriceCheckStatus
  confidence: MatchConfidence | null
  checkedAt: Date
  marketLowCents: number | null
}

export type VerdictItem = {
  priceCents: number
  finalCents: number
  showsSaving: boolean
  status: ItemStatus
}

export type VerdictInput = {
  check: VerdictCheck | null
  item: VerdictItem
  siblingPriceCents: number | null
  now: Date
}

export type PriceVerdict = {
  inflated: boolean
  cheaperSibling: boolean
  realSavingCents: number | null
  realSavingRatio: number | null
  hidden: boolean
}

export function cheaperSiblingOf(priceCents: number, siblingPriceCents: number): boolean {
  return siblingPriceCents * PERCENT_BASE <= priceCents * SIBLING_CHEAPER_PERCENT
}

export function sameListingTitle(title: string, siblingTitle: string): boolean {
  return title.toLowerCase() === siblingTitle.toLowerCase()
}

function validHighCheck(check: VerdictCheck | null, now: Date): (VerdictCheck & { marketLowCents: number }) | null {
  if (!check || check.status !== 'matched' || check.confidence !== 'high' || check.marketLowCents === null || check.marketLowCents <= 0) return null
  if (check.checkedAt.getTime() < now.getTime() - MARKET_CHECK_VALID_HOURS * HOUR_MS) return null
  return { ...check, marketLowCents: check.marketLowCents }
}

export function priceVerdict({ check, item, siblingPriceCents, now }: VerdictInput): PriceVerdict {
  const valid = validHighCheck(check, now)
  const inflated = valid !== null && item.showsSaving && item.finalCents >= valid.marketLowCents
  const cheaperSibling = siblingPriceCents !== null && cheaperSiblingOf(item.priceCents, siblingPriceCents)
  const realSavingCents = valid ? valid.marketLowCents - item.finalCents : null
  return {
    inflated,
    cheaperSibling,
    realSavingCents,
    realSavingRatio: valid && realSavingCents !== null ? realSavingCents / valid.marketLowCents : null,
    hidden: (inflated || cheaperSibling) && item.status !== STATUS_SAVED,
  }
}
