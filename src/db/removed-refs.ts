import type { ListingCandidate, WatchRetailer } from '@/lib/watch/types'

export type RemovedRefs = ReadonlySet<string>

export const NO_REMOVED_REFS: RemovedRefs = new Set()

export function removedKey(retailer: WatchRetailer, ref: string): string {
  return `${retailer}:${ref}`
}

export function withoutRemoved(candidates: readonly ListingCandidate[], removed: RemovedRefs): ListingCandidate[] {
  return removed.size === 0 ? [...candidates] : candidates.filter((candidate) => !removed.has(removedKey(candidate.retailer, candidate.ref)))
}
