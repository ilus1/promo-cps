import type { Search } from '@/db/schema'
import type { RunStatus } from '@/lib/domain'
import { errorText, isHeldCounts, isRunStop, redactQueries } from '../errors'
import type { ObservedCard } from '../ml/observed-card'
import type { LoadedPage } from '../ml/page-state'
import { SearchResultsMissing, type SearchPage } from '../ml/search-page'
import { buscaSlackMs, searchDueAt } from '../schedule'
import { MAX_UNPARSED_PAGES_IN_ROW, type Loaded } from './breaker'

export const BUSCA_STOP_LOG_TAG = '[busca-stop]'
export const SEARCH_UNPARSED = 'Produtos da busca não reconhecidos'

export type BuscaTarget = Pick<Search, 'id' | 'kind' | 'url' | 'enabled' | 'lastRunAt' | 'runEveryHours'>
export type BuscaStatus = Extract<RunStatus, 'ok' | 'partial' | 'failed'>

export interface BuscasIo {
  load(url: string): Promise<Loaded<LoadedPage>>
  readSearch(pageProps: LoadedPage['pageProps'], searchUrl: string): SearchPage
  readProduct(pageProps: LoadedPage['pageProps'], url: string): ObservedCard
  record(cards: ObservedCard[], search: BuscaTarget): Promise<string[]>
  recordRun(search: BuscaTarget, status: BuscaStatus, error: string | null, items: number): Promise<void>
  recordStop(search: BuscaTarget, status: RunStatus, error: string): Promise<void>
}

export interface BuscaOutcome {
  id: string
  status: BuscaStatus
  error: string | null
}

export interface BuscasResult {
  read: number
  pages: number
  items: number
  failed: number
  droppedCards: number
  empty: number
  lastError: string | null
  outcomes: BuscaOutcome[]
}

interface Reading {
  pages: number
  itemIds: string[]
  dropped: number
  error: string | null
  readerFailed: boolean
  empty: boolean
}

export function dueBuscas<T extends Pick<BuscaTarget, 'enabled' | 'lastRunAt' | 'runEveryHours'>>(
  searches: readonly T[], now: Date, cycleEveryHours: number | null = null,
): T[] {
  const slackOf = (s: Pick<BuscaTarget, 'runEveryHours'>) => (cycleEveryHours === null ? 0 : buscaSlackMs(cycleEveryHours, s.runEveryHours))
  return searches
    .filter((s) => s.enabled && searchDueAt(s).getTime() <= now.getTime() + slackOf(s))
    .sort((a, b) => searchDueAt(a).getTime() - searchDueAt(b).getTime())
}

function statusOf(reading: Reading): BuscaStatus {
  if (reading.error === null) return 'ok'
  return reading.pages > 1 || reading.itemIds.length > 0 ? 'partial' : 'failed'
}

async function readProduct(io: BuscasIo, search: BuscaTarget): Promise<Reading> {
  const reading: Reading = { pages: 1, itemIds: [], dropped: 0, error: null, readerFailed: false, empty: false }
  const loaded = await io.load(search.url)
  if (!loaded.ok) return { ...reading, error: loaded.error }
  let card: ObservedCard
  try {
    card = io.readProduct(loaded.value.pageProps, search.url)
  } catch (e) {
    return { ...reading, error: errorText(e), readerFailed: true }
  }
  return { ...reading, itemIds: await io.record([card], search) }
}

async function readSearch(io: BuscasIo, search: BuscaTarget, budgetPages: number): Promise<Reading> {
  const itemIds = new Set<string>()
  const reading: Reading = { pages: 0, itemIds: [], dropped: 0, error: null, readerFailed: false, empty: false }
  let url: string | null = search.url
  while (url !== null && reading.pages < budgetPages) {
    reading.pages += 1
    const loaded = await io.load(url)
    if (!loaded.ok) {
      reading.error = loaded.error
      break
    }
    let page: SearchPage
    try {
      page = io.readSearch(loaded.value.pageProps, search.url)
    } catch (e) {
      if (e instanceof SearchResultsMissing) {
        reading.empty = reading.pages === 1
        break
      }
      reading.error = errorText(e)
      reading.readerFailed = true
      break
    }
    reading.dropped += page.dropped
    if (reading.pages === 1 && page.found === 0) reading.empty = true
    if (page.found > 0 && page.cards.length === 0) {
      reading.error = SEARCH_UNPARSED
      reading.readerFailed = true
      break
    }
    for (const id of await io.record(page.cards, search)) itemIds.add(id)
    url = page.nextUrl === url ? null : page.nextUrl
  }
  reading.itemIds = [...itemIds]
  return reading
}

async function readOne(io: BuscasIo, search: BuscaTarget, budgetPages: number): Promise<Reading> {
  try {
    return search.kind === 'product' ? await readProduct(io, search) : await readSearch(io, search, budgetPages)
  } catch (e) {
    if (isRunStop(e) && !isHeldCounts(e.counts)) {
      await io.recordStop(search, e.status, e.message).catch((failure: unknown) => {
        console.error(BUSCA_STOP_LOG_TAG, redactQueries(errorText(failure)))
      })
    }
    throw e
  }
}

export async function runBuscas(
  io: BuscasIo, searches: readonly BuscaTarget[], budgetPages: number,
): Promise<BuscasResult> {
  const result: BuscasResult = { read: 0, pages: 0, items: 0, failed: 0, droppedCards: 0, empty: 0, lastError: null, outcomes: [] }
  const itemIds = new Set<string>()
  let readerFailuresInRow = 0
  for (const search of searches) {
    if (readerFailuresInRow >= MAX_UNPARSED_PAGES_IN_ROW) break
    if (search.kind === 'search' && budgetPages <= 0) continue
    const reading = await readOne(io, search, budgetPages)
    const status = statusOf(reading)
    await io.recordRun(search, status, reading.error, reading.itemIds.length)
    readerFailuresInRow = reading.readerFailed ? readerFailuresInRow + 1 : 0
    result.read += 1
    result.pages += reading.pages
    result.droppedCards += reading.dropped
    if (reading.empty) result.empty += 1
    for (const id of reading.itemIds) itemIds.add(id)
    if (reading.error !== null) result.lastError = reading.error
    if (status !== 'ok') result.failed += 1
    result.outcomes.push({ id: search.id, status, error: reading.error })
  }
  result.items = itemIds.size
  return result
}

export function runDueBuscasWith(
  io: BuscasIo, searches: readonly BuscaTarget[], now: Date, budgetPages: number, cycleEveryHours: number,
): Promise<BuscasResult> {
  return runBuscas(io, dueBuscas(searches, now, cycleEveryHours), budgetPages)
}
