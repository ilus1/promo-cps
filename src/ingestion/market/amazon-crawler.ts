import type { CrawlerStatePatch, CrawlerStateRow } from '@/db/crawler-state'
import type { DueSearch } from '@/db/market-searches'
import {
  AMAZON_BESTSELLER_DAILY_PAGES, AMAZON_BESTSELLER_PASS_HOURS, AMAZON_DAILY_PAGES, AMAZON_PAGE_INTERVAL_MS, AMAZON_PAGE_JITTER_MS,
  AMAZON_SESSION_PAGES, HOLD_RECHECK_MS, HOUR_MS, MARKET_BUSY_RECHECK_MS, MARKET_IDLE_RECHECK_MS,
} from '@/lib/constants'
import { pageDelayMs, pagesToday, withinBudget } from '@/lib/market/crawl-rules'
import {
  amazonBestsellersRootUrl, amazonSearchUrl, parseAmazonBestsellerRoot, parseAmazonBestsellers, parseAmazonSearch,
} from '@/lib/market/parse-amazon'
import type { AmazonBestsellerExtra, AmazonSearchExtra, MarketOffer, PageKind, ParsedPage } from '@/lib/market/types'
import type { RequestHold } from '@/lib/request-hold'
import { errorText } from '../errors'
import type { AmazonSession } from './amazon-browser'
import {
  afterPage, blockLine, countOf, failedWrite, failureText, LOG_TAG, nextPageAt, pageCount, remainingMs, RESULTS_VERDICT, waitStep,
  type CrawlStep, type FailedWrite, type FetchedPage, type PageHealth, type PageVerdict,
} from './crawl-page'

const SITE = 'amazon'
const NO_RESULTS = 0
const SESSION_CLOSED = 'amazon session closed'

export type BestsellerPass = { queue: string[]; pages: number }

export type AmazonCursor = { unknownStreak: number; bestsellers: BestsellerPass | null }

export interface AmazonDeps {
  now: () => Date
  hold: (now: Date) => Promise<RequestHold | null>
  idle: () => boolean
  load: () => Promise<CrawlerStateRow>
  save: (patch: CrawlerStatePatch) => Promise<void>
  session: (work: (session: AmazonSession) => Promise<void>) => Promise<void>
  dueSearches: (now: Date, limit: number) => Promise<DueSearch[]>
  recordSearch: (key: string, query: string, status: PageKind, resultCount: number, now: Date) => Promise<void>
  upsert: (offers: readonly MarketOffer[], now: Date) => Promise<number>
  rematchKeys: (keys: readonly string[], now: Date) => Promise<unknown>
  rematch: () => void
  pause: (ms: number) => Promise<boolean>
  random: () => number
  log: (line: string) => void
}

type AmazonWork = { kind: 'bestsellers'; pass: BestsellerPass } | { kind: 'search'; search: DueSearch }

type PageOutcome = { row: CrawlerStateRow; endSession: boolean }

function bestsellerPassOf(raw: unknown): BestsellerPass | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { queue, pages } = raw as { queue?: unknown; pages?: unknown }
  if (!Array.isArray(queue)) return null
  return { queue: queue.filter((url): url is string => typeof url === 'string'), pages: countOf(pages) }
}

export function amazonCursorOf(raw: Record<string, unknown>): AmazonCursor {
  return { unknownStreak: countOf(raw.unknownStreak), bestsellers: bestsellerPassOf(raw.bestsellers) }
}

export function bestsellersDue(bestsellersAt: Date | null, now: Date): boolean {
  return bestsellersAt === null || now.getTime() - bestsellersAt.getTime() >= AMAZON_BESTSELLER_PASS_HOURS * HOUR_MS
}

export function nextBestsellerQueue(pass: BestsellerPass, parsed: ParsedPage<AmazonBestsellerExtra>, root: boolean): string[] {
  const rest = pass.queue.slice(1)
  if (parsed.kind === 'wall') return pass.queue
  if (parsed.kind !== 'results') return rest
  if (root) return [...rest, ...parsed.extra.nodeUrls.filter((url) => !rest.includes(url))]
  return parsed.extra.nextPageUrl ? [parsed.extra.nextPageUrl, ...rest] : rest
}

function pagePauseMs(deps: AmazonDeps): number {
  return pageDelayMs(AMAZON_PAGE_INTERVAL_MS, AMAZON_PAGE_JITTER_MS, deps.random())
}

async function closedGate(deps: AmazonDeps, row: CrawlerStateRow, now: Date): Promise<CrawlStep | null> {
  if (await deps.hold(now)) return waitStep(HOLD_RECHECK_MS)
  const blockedMs = remainingMs(row.blockedUntil, now)
  if (blockedMs > 0) return waitStep(blockedMs)
  if (!deps.idle()) return waitStep(MARKET_BUSY_RECHECK_MS, 'ml_busy')
  if (!withinBudget(pagesToday(row.dayKey, row.pagesToday, now), AMAZON_DAILY_PAGES)) return waitStep(MARKET_IDLE_RECHECK_MS, 'daily_budget')
  return null
}

export function activeBestsellerPass(cursor: AmazonCursor, bestsellersAt: Date | null, now: Date): BestsellerPass | null {
  const saved = cursor.bestsellers
  if (saved && saved.queue.length > 0 && saved.pages < AMAZON_BESTSELLER_DAILY_PAGES) return saved
  return bestsellersDue(bestsellersAt, now) ? { queue: [amazonBestsellersRootUrl()], pages: 0 } : null
}

async function nextWork(deps: AmazonDeps, row: CrawlerStateRow, now: Date): Promise<AmazonWork | null> {
  const pass = activeBestsellerPass(amazonCursorOf(row.cursor), row.bestsellersAt, now)
  if (pass) return { kind: 'bestsellers', pass }
  const [search] = await deps.dueSearches(now, 1)
  return search ? { kind: 'search', search } : null
}

function verdictOf(parsed: ParsedPage<unknown>, fetched: FetchedPage): PageVerdict {
  return parsed.kind === 'results' ? RESULTS_VERDICT : { kind: parsed.kind, reason: failureText(parsed.reason, fetched) }
}

function whileOpen<T>(session: AmazonSession, write: () => Promise<T>): Promise<T> {
  if (!session.isOpen()) return Promise.reject(new Error(SESSION_CLOSED))
  return write()
}

async function loadCounted(deps: AmazonDeps, session: AmazonSession, row: CrawlerStateRow, url: string, scroll: boolean, now: Date): Promise<FetchedPage> {
  const fetched = await session.load(url, scroll)
  await whileOpen(session, () => deps.save(pageCount(row, now)))
  return fetched
}

async function savedOffers(deps: AmazonDeps, session: AmazonSession, offers: readonly MarketOffer[], what: string, now: Date): Promise<FailedWrite | null> {
  const unsaved = await whileOpen(session, () => failedWrite(() => deps.upsert(offers, now)))
  if (unsaved) deps.log(`${LOG_TAG} ${SITE}: ${what} not saved (${unsaved.reason})`)
  return unsaved
}

async function saved(
  deps: AmazonDeps, session: AmazonSession, row: CrawlerStateRow, patch: CrawlerStatePatch, health: PageHealth, verdict: PageVerdict,
): Promise<PageOutcome> {
  await whileOpen(session, () => deps.save(patch))
  if (health.blockedUntil) deps.log(blockLine(SITE, health.blockedUntil, verdict.reason))
  return { row: { ...row, ...patch } as CrawlerStateRow, endSession: verdict.kind === 'wall' || health.blockedUntil !== null }
}

async function crawlBestsellers(deps: AmazonDeps, session: AmazonSession, row: CrawlerStateRow, pass: BestsellerPass, now: Date): Promise<PageOutcome> {
  const url = pass.queue[0]
  const root = url === amazonBestsellersRootUrl()
  const fetched = await loadCounted(deps, session, row, url, !root, now)
  const parsed = root ? parseAmazonBestsellerRoot(fetched.status, fetched.html) : parseAmazonBestsellers(fetched.status, fetched.html, url)
  const unsaved = parsed.kind === 'results' ? await savedOffers(deps, session, parsed.offers, url, now) : null
  const outcome: ParsedPage<AmazonBestsellerExtra> = unsaved ?? parsed
  const verdict = verdictOf(outcome, fetched)
  const health = afterPage(row, amazonCursorOf(row.cursor).unknownStreak, verdict, now)
  const next: BestsellerPass = { queue: nextBestsellerQueue(pass, outcome, root), pages: pass.pages + 1 }
  const finished = next.queue.length === 0 || next.pages >= AMAZON_BESTSELLER_DAILY_PAGES
  const cursor: AmazonCursor = { unknownStreak: health.unknownStreak, bestsellers: finished ? null : next }
  const patch: CrawlerStatePatch = { ...health.patch, cursor, ...(finished ? { bestsellersAt: now } : {}) }
  const pageOutcome = await saved(deps, session, row, patch, health, verdict)
  if (finished) {
    deps.log(`${LOG_TAG} ${SITE}: best sellers finished after ${next.pages} pages`)
    deps.rematch()
  }
  return pageOutcome
}

export function recordedKind(kind: Exclude<PageKind, 'wall'>): PageKind {
  return kind === 'missing' ? 'unknown' : kind
}

async function rematchSearched(deps: AmazonDeps, session: AmazonSession, key: string, now: Date): Promise<void> {
  if (!session.isOpen()) return
  try {
    await deps.rematchKeys([key], now)
  } catch (e) {
    deps.log(`${LOG_TAG} ${SITE}: rematch of ${key} failed: ${errorText(e)}`)
  }
}

async function recorded(
  deps: AmazonDeps, session: AmazonSession, search: DueSearch, parsed: ParsedPage<AmazonSearchExtra>, now: Date,
): Promise<ParsedPage<AmazonSearchExtra>> {
  if (parsed.kind === 'wall') return parsed
  const kind = recordedKind(parsed.kind)
  const resultCount = parsed.kind === 'results' ? parsed.extra.resultCount : NO_RESULTS
  const unrecorded = await whileOpen(session, () => failedWrite(() => deps.recordSearch(search.key, search.query, kind, resultCount, now)))
  if (unrecorded) deps.log(`${LOG_TAG} ${SITE}: search of ${search.key} not recorded (${unrecorded.reason})`)
  return unrecorded ?? parsed
}

async function crawlSearch(deps: AmazonDeps, session: AmazonSession, row: CrawlerStateRow, search: DueSearch, now: Date): Promise<PageOutcome> {
  const fetched = await loadCounted(deps, session, row, amazonSearchUrl(search.query), false, now)
  const parsed = parseAmazonSearch(fetched.status, fetched.html)
  const unsaved = parsed.kind === 'results' ? await savedOffers(deps, session, parsed.offers, search.key, now) : null
  const outcome = await recorded(deps, session, search, unsaved ?? parsed, now)
  const verdict = verdictOf(outcome, fetched)
  const health = afterPage(row, amazonCursorOf(row.cursor).unknownStreak, verdict, now)
  const cursor: AmazonCursor = { ...amazonCursorOf(row.cursor), unknownStreak: health.unknownStreak }
  const pageOutcome = await saved(deps, session, row, { ...health.patch, cursor }, health, verdict)
  if (outcome.kind === 'results' || outcome.kind === 'empty') await rematchSearched(deps, session, search.key, now)
  return pageOutcome
}

function crawlOne(deps: AmazonDeps, session: AmazonSession, row: CrawlerStateRow, work: AmazonWork, now: Date): Promise<PageOutcome> {
  if (work.kind === 'bestsellers') return crawlBestsellers(deps, session, row, work.pass, now)
  return crawlSearch(deps, session, row, work.search, now)
}

async function runSession(deps: AmazonDeps, session: AmazonSession, startRow: CrawlerStateRow, first: AmazonWork): Promise<void> {
  let row = startRow
  for (let pages = 0; pages < AMAZON_SESSION_PAGES; pages += 1) {
    if (pages > 0 && !(await deps.pause(pagePauseMs(deps)))) return
    if (!session.isOpen()) return
    const now = deps.now()
    if (await closedGate(deps, row, now)) return
    const work = pages === 0 ? first : await nextWork(deps, row, now)
    if (!work) return
    const outcome = await crawlOne(deps, session, row, work, now)
    row = outcome.row
    if (outcome.endSession) return
  }
}

export async function amazonStep(deps: AmazonDeps): Promise<CrawlStep> {
  const now = deps.now()
  const row = await deps.load()
  const closed = await closedGate(deps, row, now)
  if (closed) return closed
  const paceMs = remainingMs(nextPageAt(row.lastPageAt, AMAZON_PAGE_INTERVAL_MS), now)
  if (paceMs > 0) return waitStep(paceMs)
  const first = await nextWork(deps, row, now)
  if (!first) return waitStep(MARKET_IDLE_RECHECK_MS, 'queue_empty')
  await deps.session((session) => runSession(deps, session, row, first))
  return { sleepMs: pagePauseMs(deps), waitingFor: null }
}
