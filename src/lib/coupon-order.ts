import { compareStrength, type StrengthFields } from '@/ingestion/ml/coupons'

type PriorityFields = { discoveryTriedAt: Date | null; discoveryPriorityAt: Date | null }
type RotationFields = StrengthFields & PriorityFields

export function isDiscoveryPending(c: PriorityFields): boolean {
  if (c.discoveryPriorityAt === null) return false
  return c.discoveryTriedAt === null || c.discoveryTriedAt.getTime() < c.discoveryPriorityAt.getTime()
}

function comparePending(a: RotationFields, b: RotationFields): number {
  const pa = isDiscoveryPending(a)
  const pb = isDiscoveryPending(b)
  if (pa !== pb) return pa ? -1 : 1
  if (!pa || !a.discoveryPriorityAt || !b.discoveryPriorityAt) return 0
  return b.discoveryPriorityAt.getTime() - a.discoveryPriorityAt.getTime()
}

export function compareDiscoveryRotation(a: RotationFields, b: RotationFields): number {
  const pending = comparePending(a, b)
  if (pending !== 0) return pending
  if (isDiscoveryPending(a)) {
    const strength = compareStrength(a, b)
    if (strength !== 0) return strength
  }
  const ta = a.discoveryTriedAt?.getTime() ?? Number.NEGATIVE_INFINITY
  const tb = b.discoveryTriedAt?.getTime() ?? Number.NEGATIVE_INFINITY
  if (ta !== tb) return ta < tb ? -1 : 1
  return compareStrength(a, b)
}

export function discoveryRotation<T extends RotationFields>(rows: readonly T[], limit?: number): T[] {
  return [...rows].sort(compareDiscoveryRotation).slice(0, limit)
}
