import type { Page } from 'playwright'
import { finishRun, lastStatusRun, startRun } from '@/db/runs'
import type { Run } from '@/db/schema'
import type { CyclePhase, RunKind, RunStatus } from '@/lib/domain'
import { withMlBrowser } from './browser'
import { isMainFrameNavigation, stoppedSince } from './cycle-rules'
import { errorText, holdStop, isRunStop, redactQueries } from './errors'
import { mlHoldCheck } from './request-hold'
import { activeKinds, enterKind, leaveKind, type RunningKinds } from '@/lib/running-kinds'
import { serialized } from './run-chain'

declare global {
  var __promoRunningKinds: RunningKinds | undefined
}

function running(): RunningKinds {
  globalThis.__promoRunningKinds ??= new Map()
  return globalThis.__promoRunningKinds
}

export function runningKinds(): Set<RunKind> {
  return activeKinds(running())
}

export type JobPhase = Exclude<CyclePhase, 'idle'>
export type Job<T> = { phase: JobPhase; done: Promise<T> }
export type JobBook<T> = Map<string, Job<T>>

export interface RunReport {
  counts: Record<string, number>
  status: RunStatus
  error: string | undefined
}

export async function stoppedSinceRequest(requestedAt: Date): Promise<boolean> {
  return stoppedSince(await Promise.all([lastStatusRun('cycle'), lastStatusRun('search')]), requestedAt)
}

export function phaseOf<T>(book: JobBook<T> | undefined, key: string): CyclePhase {
  return book?.get(key)?.phase ?? 'idle'
}

export function requestJob<T>(book: JobBook<T>, key: string, work: () => Promise<T>): Promise<T> {
  const current = book.get(key)
  if (current) return current.done
  const job: Job<T> = { phase: 'queued', done: Promise.resolve(undefined as never) }
  book.set(key, job)
  job.done = serialized(() => {
    job.phase = 'running'
    return work()
  }).finally(() => {
    if (book.get(key) === job) book.delete(key)
  })
  return job.done
}

export async function recordedRun(
  kind: RunKind, body: (page: Page, report: RunReport) => Promise<void>,
): Promise<Run> {
  enterKind(running(), kind)
  try {
    return await executeRun(kind, body)
  } finally {
    leaveKind(running(), kind)
  }
}

async function executeRun(
  kind: RunKind, body: (page: Page, report: RunReport) => Promise<void>,
): Promise<Run> {
  const run = await startRun(kind)
  const report: RunReport = { counts: {}, status: 'ok', error: undefined }
  let pages = 0
  try {
    const hold = await mlHoldCheck()
    if (hold) throw holdStop(hold)
    await withMlBrowser('hidden', async (page) => {
      page.on('request', (r) => { if (isMainFrameNavigation(r, page)) pages += 1 })
      await body(page, report)
    })
  } catch (e) {
    report.status = isRunStop(e) ? e.status : 'failed'
    if (isRunStop(e)) Object.assign(report.counts, e.counts)
    report.error = errorText(e)
  }
  return finishRun(run.id, {
    status: report.status,
    pages,
    counts: report.counts,
    error: report.error === undefined ? undefined : redactQueries(report.error),
  })
}
