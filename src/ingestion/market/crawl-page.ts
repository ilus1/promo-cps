import type { CrawlerStatePatch, CrawlerStateRow } from '@/db/crawler-state'
import { MARKET_IDLE_RECHECK_MS } from '@/lib/constants'
import { dayKey, healthAfterPage, pagesToday } from '@/lib/market/crawl-rules'
import type { PageKind, Retailer, WaitingReason } from '@/lib/market/types'
import { errorText } from '../errors'

export const LOG_TAG = '[market]'

export interface FetchedPage { status: number; html: string; reason?: string }

export interface CrawlStep { sleepMs: number; waitingFor: WaitingReason | null }

export interface PageVerdict { kind: PageKind; reason: string | null }

export interface PageHealth { patch: CrawlerStatePatch; unknownStreak: number; blockedUntil: Date | null }

export interface FailedWrite { kind: 'unknown'; reason: string }

export const RESULTS_VERDICT: PageVerdict = { kind: 'results', reason: null }

const FAILED_KINDS: readonly PageKind[] = ['wall', 'unknown']
const NO_REASON = 'no reason'
const SAVE_FAILED = 'falha ao gravar'

export function remainingMs(until: Date | null, now: Date): number {
  return until ? Math.max(until.getTime() - now.getTime(), 0) : 0
}

export function nextPageAt(lastPageAt: Date | null, intervalMs: number): Date | null {
  return lastPageAt ? new Date(lastPageAt.getTime() + intervalMs) : null
}

export function waitStep(ms: number, waitingFor: WaitingReason | null = null): CrawlStep {
  return { sleepMs: Math.min(Math.max(ms, 0), MARKET_IDLE_RECHECK_MS), waitingFor }
}

export function failureText(reason: string, fetched: FetchedPage): string {
  return fetched.reason ? `${reason}: ${fetched.reason}` : reason
}

export async function failedWrite(write: () => Promise<unknown>): Promise<FailedWrite | null> {
  try {
    await write()
    return null
  } catch (e) {
    return { kind: 'unknown', reason: `${SAVE_FAILED}: ${errorText(e)}` }
  }
}

export function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

export function pageCount(row: CrawlerStateRow, now: Date): CrawlerStatePatch {
  return { dayKey: dayKey(now), pagesToday: pagesToday(row.dayKey, row.pagesToday, now) + 1, lastPageAt: now }
}

export function afterPage(row: CrawlerStateRow, unknownStreak: number, verdict: PageVerdict, now: Date): PageHealth {
  const health = healthAfterPage({ backoffLevel: row.backoffLevel, unknownStreak }, verdict.kind, now)
  const blockedUntil = health.blockedUntilMs === null ? null : new Date(health.blockedUntilMs)
  const lastError = verdict.kind === 'results' ? null : FAILED_KINDS.includes(verdict.kind) ? verdict.reason : row.lastError
  return {
    unknownStreak: health.unknownStreak,
    blockedUntil,
    patch: { ...pageCount(row, now), backoffLevel: health.backoffLevel, blockedUntil, lastError },
  }
}

export function blockLine(site: Retailer, until: Date, reason: string | null): string {
  return `${LOG_TAG} ${site}: blocked until ${until.toISOString()} (${reason ?? NO_REASON})`
}
