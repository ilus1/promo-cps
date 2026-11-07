import { expect, test } from 'vitest'
import type { ListingCandidate } from '@/lib/watch/types'
import { NO_REMOVED_REFS, removedKey, withoutRemoved } from './removed-refs'

const candidate = (retailer: ListingCandidate['retailer'], ref: string): ListingCandidate => ({
  retailer, ref, url: `https://x/${ref}`, title: 't', ean: null, merchant: null, priceCents: 100, listPriceCents: null, inStock: true,
})

test('a removed ref of the same store is filtered out, the same ref at another store is not', () => {
  const removed = new Set([removedKey('americanas', '1:2')])
  expect(withoutRemoved([candidate('americanas', '1:2'), candidate('americanas', '3:4'), candidate('kabum', '1:2')], removed))
    .toEqual([candidate('americanas', '3:4'), candidate('kabum', '1:2')])
})

test('no removed refs keep every candidate', () => {
  const all = [candidate('amazon', 'B0C1234567')]
  expect(withoutRemoved(all, NO_REMOVED_REFS)).toEqual(all)
})
