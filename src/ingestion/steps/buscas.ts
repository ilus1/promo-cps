import type { Page } from 'playwright'
import { listEnabledSearches, recordRun, recordStop } from '@/db/searches'
import { recordObservations } from '@/db/items'
import { SEARCH_PAGES } from '@/lib/constants'
import { CYCLE_COUNT } from '@/lib/cycle-counts'
import { SOURCE_SEARCH } from '@/lib/domain'
import { redactQueries } from '../errors'
import { readProductPage } from '../ml/product'
import { loadWithRetry } from '../ml/page-state'
import { readSearchPage } from '../ml/search-page'
import type { LoadBreaker } from './breaker'
import {
  runBuscas, runDueBuscasWith, type BuscaTarget, type BuscasIo, type BuscasResult,
} from './buscas-pages'

export interface BuscasStep {
  counts: Record<string, number>
  failed: number
  lastError: string | null
  outcomes: BuscasResult['outcomes']
}

function ioFor(page: Page, now: Date, breaker: LoadBreaker): BuscasIo {
  return {
    load: (url) => breaker.load(() => loadWithRetry(page, url)),
    readSearch: readSearchPage,
    readProduct: readProductPage,
    record: (cards, search) => recordObservations(cards, { type: SOURCE_SEARCH, id: search.id, url: search.url }, now),
    recordRun: (search, status, error, items) => (
      recordRun(search.id, search.url, status, error === null ? null : redactQueries(error), new Date(), items)
    ),
    recordStop: (search, status, error) => recordStop(search.id, search.url, status, redactQueries(error)),
  }
}

function stepOf(result: BuscasResult): BuscasStep {
  return {
    counts: {
      [CYCLE_COUNT.buscaReads]: result.read,
      [CYCLE_COUNT.buscaPages]: result.pages,
      [CYCLE_COUNT.buscaItems]: result.items,
      [CYCLE_COUNT.buscaFailed]: result.failed,
      [CYCLE_COUNT.buscaDropped]: result.droppedCards,
      [CYCLE_COUNT.buscaEmpty]: result.empty,
    },
    failed: result.failed,
    lastError: result.lastError,
    outcomes: result.outcomes,
  }
}

export async function runDueBuscas(page: Page, now: Date, breaker: LoadBreaker, cycleEveryHours: number): Promise<BuscasStep> {
  const searches = await listEnabledSearches()
  return stepOf(await runDueBuscasWith(ioFor(page, now, breaker), searches, now, SEARCH_PAGES, cycleEveryHours))
}

export async function runBuscasOn(page: Page, searches: readonly BuscaTarget[], now: Date, breaker: LoadBreaker): Promise<BuscasStep> {
  return stepOf(await runBuscas(ioFor(page, now, breaker), searches, SEARCH_PAGES))
}
