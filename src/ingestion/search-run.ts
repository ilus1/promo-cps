import type { Page } from 'playwright'
import { getSearch, listEnabledSearches, markUnreadTried } from '@/db/searches'
import type { Run, Search } from '@/db/schema'
import { BUSCA_NOT_READ_TEXT } from '@/lib/busca-rules'
import { isRunStatus, isStopStatus, type CycleActivity, type RunStatus } from '@/lib/domain'
import { phaseOf, recordedRun, requestJob, stoppedSinceRequest, type JobBook } from './recorded-run'
import { mlHoldCheck } from './request-hold'
import { serialized } from './run-chain'
import { loadBreaker, type LoadBreaker } from './steps/breaker'
import { runBuscasOn, type BuscasStep } from './steps/buscas'
import { dueBuscas } from './steps/buscas-pages'
import { errorText, isHeldCounts, redactQueries } from './errors'
import { afterRun } from './after-run'
import { replanAutoRun } from './auto-run'

const NOT_READ_LOG_TAG = '[busca-not-read]'

declare global {
  var __promoBuscaJobs: JobBook<Run | null> | undefined
}

function book(): JobBook<Run | null> {
  globalThis.__promoBuscaJobs ??= new Map()
  return globalThis.__promoBuscaJobs
}

function statusOf(step: BuscasStep): RunStatus {
  if (step.outcomes.every((outcome) => outcome.status === 'ok')) return 'ok'
  return step.outcomes.every((outcome) => outcome.status === 'failed') ? 'failed' : 'partial'
}

export function buscaActivity(id: string): CycleActivity {
  return { phase: phaseOf(globalThis.__promoBuscaJobs, id) }
}

export function activeBuscas(): Record<string, CycleActivity> {
  const active: Record<string, CycleActivity> = {}
  for (const [id, job] of globalThis.__promoBuscaJobs ?? []) active[id] = { phase: job.phase }
  return active
}

function notReadStatus(run: Run | undefined): RunStatus {
  const status = run?.status ?? null
  return isRunStatus(status) && isStopStatus(status) ? status : 'failed'
}

async function recordNotRead(attempted: readonly Pick<Search, 'id'>[], run: Run | undefined): Promise<void> {
  if (run?.status === 'ok' || isHeldCounts(run?.counts)) return
  try {
    await markUnreadTried(attempted.map((search) => search.id), notReadStatus(run), redactQueries(run?.error ?? BUSCA_NOT_READ_TEXT))
  } catch (e) {
    console.error(NOT_READ_LOG_TAG, 'marking failed', errorText(e))
  }
}

export async function recordSearchRun(
  read: (page: Page, now: Date, breaker: LoadBreaker) => Promise<BuscasStep>, attempted: readonly Pick<Search, 'id'>[] = [],
): Promise<Run> {
  let run: Run | undefined
  try {
    run = await recordedRun('search', async (page, report) => {
      const step = await read(page, new Date(), loadBreaker(mlHoldCheck))
      Object.assign(report.counts, step.counts)
      report.status = statusOf(step)
      report.error = step.lastError ?? undefined
    })
  } finally {
    await recordNotRead(attempted, run)
  }
  afterRun(run)
  return run
}

async function runBusca(id: string, requestedAt: Date): Promise<Run | null> {
  const search = await getSearch(id)
  if (!search) return null
  if (search.lastRunAt !== null && search.lastRunAt.getTime() >= requestedAt.getTime()) return null
  if (await stoppedSinceRequest(requestedAt)) return null
  return recordSearchRun((page, now, breaker) => runBuscasOn(page, [search], now, breaker), [search])
}

export function requestBuscaRun(id: string): Promise<Run | null> {
  const requestedAt = new Date()
  return requestJob(book(), id, () => runBusca(id, requestedAt).finally(replanAutoRun))
}

export function runDueBuscasTick(requestedAt: Date): Promise<Run | null> {
  return serialized(async () => {
    const due = dueBuscas(await listEnabledSearches(), new Date())
    if (due.length === 0) return null
    if (await stoppedSinceRequest(requestedAt)) return null
    return recordSearchRun((page, now, breaker) => runBuscasOn(page, due, now, breaker), due)
  }).finally(replanAutoRun)
}
