import type { RunKind, RunRowStatus } from './domain'
import { sessionNotification, type DealDigest, type DealSample, type DesktopNotification } from './desktop-notify'
import { dealHref, parseDealQuery } from './deal-query'
import { searchParamsToRecord } from './query-params'
import type { Run } from '@/db/schema'

export const DIGEST_SAMPLE_COUNT = 3
export const TITLE_NAME_MAX_CHARS = 60
const ELLIPSIS = '...'

export type AlertHit = DealSample & { id: string }
export interface AlertHits { alert: { name: string; query: string }; hits: AlertHit[] }

export function titleName(name: string): string {
  if (name.length <= TITLE_NAME_MAX_CHARS) return name
  return `${name.slice(0, TITLE_NAME_MAX_CHARS - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`
}

export function viewHref(baseUrl: string, query: string): string {
  const view = parseDealQuery(searchParamsToRecord(new URLSearchParams(query)))
  return `${baseUrl}${dealHref(view, { offersOnly: true })}`
}

export function digestsOf(groups: AlertHits[], baseUrl: string): DealDigest[] {
  const announced = new Set<string>()
  const digests: DealDigest[] = []
  for (const { alert, hits } of groups) {
    const fresh = hits.filter((hit) => !announced.has(hit.id))
    for (const hit of hits) announced.add(hit.id)
    if (fresh.length === 0) continue
    digests.push({
      alertName: titleName(alert.name),
      count: fresh.length,
      samples: fresh.slice(0, DIGEST_SAMPLE_COUNT),
      url: viewHref(baseUrl, alert.query),
    })
  }
  return digests
}

export async function sessionAlertFor(
  run: Pick<Run, 'kind' | 'status' | 'error' | 'startedAt'>,
  loadPrevious: (kind: RunKind, before: Date) => Promise<RunRowStatus | null>,
  baseUrl: string,
): Promise<DesktopNotification | null> {
  const problem = sessionNotification(run, baseUrl)
  if (!problem) return null
  return run.status === await loadPrevious(run.kind, run.startedAt) ? null : problem
}
