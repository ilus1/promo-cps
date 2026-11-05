import type { CrawlerStatePatch, CrawlerStateRow } from '@/db/crawler-state'
import {
  HOLD_RECHECK_MS, KABUM_DEPARTMENTS, KABUM_MAX_PAGES, KABUM_PAGE_INTERVAL_MS, KABUM_PAGE_JITTER_MS,
} from '@/lib/constants'
import { kabumNextPassAt, kabumPassDue, pageDelayMs } from '@/lib/market/crawl-rules'
import { statusFailure } from '@/lib/market/pages'
import { kabumListingUrl, kabumSitemapIndexUrl, parseKabumListing, parseKabumSitemapIndex } from '@/lib/market/parse-kabum'
import type { KabumPageExtra, MarketOffer, ParsedPage } from '@/lib/market/types'
import type { RequestHold } from '@/lib/request-hold'
import {
  afterPage, blockLine, countOf, failedWrite, failureText, LOG_TAG, nextPageAt, pageCount, remainingMs, RESULTS_VERDICT, waitStep,
  type CrawlStep, type FetchedPage, type PageHealth, type PageVerdict,
} from './crawl-page'

const SITE = 'kabum'
const FIRST_PAGE = 1
const NO_SLUGS_REASON = 'sitemap sem departamentos'

export type KabumCursor = { departments: string[]; index: number; page: number; totalPages: number; unknownStreak: number }

export const IDLE_KABUM_CURSOR: KabumCursor = { departments: [], index: 0, page: 0, totalPages: 0, unknownStreak: 0 }

export interface KabumDeps {
  now: () => Date
  hold: (now: Date) => Promise<RequestHold | null>
  load: () => Promise<CrawlerStateRow>
  save: (patch: CrawlerStatePatch) => Promise<void>
  fetch: (url: string) => Promise<FetchedPage>
  upsert: (offers: readonly MarketOffer[], now: Date) => Promise<number>
  rematch: () => void
  random: () => number
  log: (line: string) => void
}

type KabumMove = { cursor: KabumCursor; departmentDone: boolean; skippedPage: boolean }

export function kabumCursorOf(raw: Record<string, unknown>): KabumCursor {
  const departments = Array.isArray(raw.departments) ? raw.departments.filter((slug): slug is string => typeof slug === 'string') : []
  return {
    departments,
    index: countOf(raw.index),
    page: countOf(raw.page),
    totalPages: countOf(raw.totalPages),
    unknownStreak: countOf(raw.unknownStreak),
  }
}

export function inKabumPass(cursor: KabumCursor): boolean {
  return cursor.index < cursor.departments.length
}

export function kabumPageOf(cursor: KabumCursor): number {
  return Math.max(cursor.page, FIRST_PAGE)
}

function nextDepartment(cursor: KabumCursor, unknownStreak: number): KabumCursor {
  const index = cursor.index + 1
  if (index >= cursor.departments.length) return { ...IDLE_KABUM_CURSOR, unknownStreak }
  return { departments: cursor.departments, index, page: FIRST_PAGE, totalPages: 0, unknownStreak }
}

function nextPage(cursor: KabumCursor, page: number, totalPages: number, unknownStreak: number): KabumMove {
  if (page >= totalPages) return { cursor: nextDepartment(cursor, unknownStreak), departmentDone: true, skippedPage: false }
  return { cursor: { ...cursor, page: page + 1, totalPages, unknownStreak }, departmentDone: false, skippedPage: false }
}

export function kabumMove(cursor: KabumCursor, page: number, parsed: ParsedPage<KabumPageExtra>, unknownStreak: number): KabumMove {
  if (parsed.kind === 'results') return nextPage(cursor, page, Math.min(parsed.extra.totalPages, KABUM_MAX_PAGES), unknownStreak)
  if (parsed.kind === 'missing' || parsed.kind === 'empty') {
    return { cursor: nextDepartment(cursor, unknownStreak), departmentDone: true, skippedPage: false }
  }
  if (parsed.kind === 'unknown') return { ...nextPage(cursor, page, cursor.totalPages, unknownStreak), skippedPage: true }
  return { cursor: { ...cursor, page, unknownStreak }, departmentDone: false, skippedPage: false }
}

function pagePause(deps: KabumDeps): CrawlStep {
  return { sleepMs: pageDelayMs(KABUM_PAGE_INTERVAL_MS, KABUM_PAGE_JITTER_MS, deps.random()), waitingFor: null }
}

function logBlock(deps: KabumDeps, health: PageHealth, verdict: PageVerdict): void {
  if (health.blockedUntil) deps.log(blockLine(SITE, health.blockedUntil, verdict.reason))
}

async function startPass(deps: KabumDeps, row: CrawlerStateRow, cursor: KabumCursor, now: Date): Promise<CrawlStep> {
  const fetched = await deps.fetch(kabumSitemapIndexUrl())
  const slugs = parseKabumSitemapIndex(fetched.status, fetched.html)
  const failure = statusFailure(fetched.status)
  const verdict: PageVerdict = slugs
    ? RESULTS_VERDICT
    : { kind: failure?.kind ?? 'unknown', reason: failureText(failure?.reason ?? NO_SLUGS_REASON, fetched) }
  const health = afterPage(row, cursor.unknownStreak, verdict, now)
  if (verdict.kind === 'wall') {
    await deps.save({ ...health.patch, cursor: { ...cursor, unknownStreak: health.unknownStreak } })
    logBlock(deps, health, verdict)
    return pagePause(deps)
  }
  const departments = slugs ?? [...KABUM_DEPARTMENTS]
  const next: KabumCursor = { departments, index: 0, page: FIRST_PAGE, totalPages: 0, unknownStreak: health.unknownStreak }
  await deps.save({ ...health.patch, cursor: next, passStartedAt: now })
  const source = slugs ? 'sitemap' : `fallback list, ${verdict.reason}`
  deps.log(`${LOG_TAG} ${SITE}: pass started with ${departments.length} departments (${source})`)
  logBlock(deps, health, verdict)
  return pagePause(deps)
}

function logMove(deps: KabumDeps, slug: string, page: number, parsed: ParsedPage<KabumPageExtra>, move: KabumMove): void {
  if ((parsed.kind === 'missing' || parsed.kind === 'empty') && page === FIRST_PAGE) {
    deps.log(`${LOG_TAG} ${SITE}: skipped ${slug} (${parsed.reason})`)
  }
  if (move.skippedPage && parsed.kind !== 'results') deps.log(`${LOG_TAG} ${SITE}: skipped ${slug} page ${page} (${parsed.reason})`)
  if (!inKabumPass(move.cursor)) deps.log(`${LOG_TAG} ${SITE}: pass finished`)
}

async function crawlPage(deps: KabumDeps, row: CrawlerStateRow, cursor: KabumCursor, now: Date): Promise<CrawlStep> {
  const slug = cursor.departments[cursor.index]
  const page = kabumPageOf(cursor)
  const url = kabumListingUrl(slug, page)
  const fetched = await deps.fetch(url)
  await deps.save(pageCount(row, now))
  const parsed = parseKabumListing(fetched.status, fetched.html, url, now)
  const unsaved = parsed.kind === 'results' ? await failedWrite(() => deps.upsert(parsed.offers, now)) : null
  const outcome: ParsedPage<KabumPageExtra> = unsaved ?? parsed
  const known = parsed.kind === 'results' ? { ...cursor, totalPages: Math.min(parsed.extra.totalPages, KABUM_MAX_PAGES) } : cursor
  const verdict: PageVerdict = outcome.kind === 'results' ? RESULTS_VERDICT : { kind: outcome.kind, reason: failureText(outcome.reason, fetched) }
  const health = afterPage(row, cursor.unknownStreak, verdict, now)
  const move = kabumMove(known, page, outcome, health.unknownStreak)
  await deps.save({ ...health.patch, cursor: move.cursor })
  logBlock(deps, health, verdict)
  logMove(deps, slug, page, outcome, move)
  if (move.departmentDone && (page > FIRST_PAGE || outcome.kind === 'results')) deps.rematch()
  return pagePause(deps)
}

export async function kabumStep(deps: KabumDeps): Promise<CrawlStep> {
  const now = deps.now()
  if (await deps.hold(now)) return waitStep(HOLD_RECHECK_MS)
  const row = await deps.load()
  const blockedMs = remainingMs(row.blockedUntil, now)
  if (blockedMs > 0) return waitStep(blockedMs)
  const paceMs = remainingMs(nextPageAt(row.lastPageAt, KABUM_PAGE_INTERVAL_MS), now)
  if (paceMs > 0) return waitStep(paceMs)
  const cursor = kabumCursorOf(row.cursor)
  if (inKabumPass(cursor)) return crawlPage(deps, row, cursor, now)
  if (!kabumPassDue(row.passStartedAt, now)) return waitStep(remainingMs(kabumNextPassAt(row.passStartedAt), now), 'next_pass')
  return startPass(deps, row, cursor, now)
}
