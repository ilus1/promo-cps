import { z } from 'zod'
import { MINUTE_MS, OFERTAS_QUERY_MAX, PAGE_SIZE } from './constants'
import { dealFiltersFromParams, type DealFilters } from './deal-query'
import { searchParamsToRecord } from './query-params'

export const BULK_SEEN_MAX_IDS = PAGE_SIZE
export const BULK_SEEN_CLOCK_SKEW_MS = MINUTE_MS

export type BulkSeenRequest = ({ ids: string[] } | { query: string }) & { asOf: string }
export type BulkSeenTarget = ({ ids: string[] } | { filters: DealFilters }) & { asOf: Date }

const asOf = z.iso.datetime()

const BulkSeen = z.union([
  z.strictObject({ ids: z.array(z.string().min(1)).min(1).max(BULK_SEEN_MAX_IDS), asOf }),
  z.strictObject({ query: z.string().max(OFERTAS_QUERY_MAX), asOf }),
])

export function parseBulkSeen(input: unknown, now: Date): BulkSeenTarget {
  const body = BulkSeen.parse(input)
  const at = new Date(body.asOf)
  if (at.getTime() > now.getTime() + BULK_SEEN_CLOCK_SKEW_MS) {
    throw new z.ZodError([{ code: 'custom', path: ['asOf'], message: 'asOf is in the future' }])
  }
  if ('ids' in body) return { ids: [...new Set(body.ids)], asOf: at }
  return { filters: dealFiltersFromParams(searchParamsToRecord(new URLSearchParams(body.query))), asOf: at }
}
