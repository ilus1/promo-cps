import type { Page, Request } from 'playwright'
import { ENDING_MAX_SHARE, ENDING_MIN_CAP, RUN_DEADLINE_MS } from '@/lib/constants'
import { CYCLE_COUNT } from '@/lib/cycle-counts'
import type { Run } from '@/db/schema'
import { skippedEntriesText } from '@/lib/labels'
import { isHeldRun, isStopStatus, type RunStatus } from '@/lib/domain'

export type PreviousCycle = { startedAt: Date; counts: Record<string, number> }
export type HarvestOutcome = {
  allPagesLoaded: boolean; seen: number; skipped: number; failedPages: number; totalCoupons: number; lastError: string | null
}

export function isMainFrameNavigation(
  request: Pick<Request, 'isNavigationRequest' | 'frame'>,
  page: Pick<Page, 'mainFrame'>,
): boolean {
  if (!request.isNavigationRequest()) return false
  try {
    return request.frame() === page.mainFrame()
  } catch {
    return false
  }
}

export function endingCutoff(thisHarvestFull: boolean, previous: PreviousCycle | null | undefined): Date | null {
  if (!thisHarvestFull || !previous) return null
  return previous.counts[CYCLE_COUNT.fullHarvest] === 1 ? previous.startedAt : null
}

export function cycleStatus(harvestFull: boolean, failedSteps: number): Extract<RunStatus, 'ok' | 'partial'> {
  return harvestFull && failedSteps === 0 ? 'ok' : 'partial'
}

export function partialReason(harvest: HarvestOutcome, stepError: string | null): string | undefined {
  if (harvest.lastError) return harvest.lastError
  if (!harvest.allPagesLoaded && harvest.skipped > 0 && harvest.failedPages === 0 && harvest.seen >= harvest.totalCoupons - harvest.skipped) {
    return `Leitura de cupons incompleta: ${skippedEntriesText(harvest.skipped)}`
  }
  if (!harvest.allPagesLoaded) return `Leitura de cupons incompleta: ${harvest.seen} de ${harvest.totalCoupons}`
  return stepError ?? undefined
}

export function activationLimit(harvestSeen: number, limit: number): number {
  return harvestSeen > 0 ? limit : 0
}

export function stoppedSince(runs: readonly (Pick<Run, 'status' | 'finishedAt'> & { counts?: Run['counts'] } | undefined)[], since: Date): boolean {
  return runs.some((run) => run?.finishedAt != null
    && run.finishedAt.getTime() > since.getTime()
    && (isStopStatus(run.status) || isHeldRun(run)))
}

export interface EndingCounts { endable: number; live: number; previousRefused?: number }
export interface EndingDecision { allowed: boolean; refused: number; limit: number }

export function endingLimit(live: number): number {
  return Math.max(ENDING_MIN_CAP, Math.floor(Math.max(0, live) * ENDING_MAX_SHARE))
}

function confirmsPreviousRefusal(endable: number, previousRefused: number | undefined, limit: number): boolean {
  if (previousRefused === undefined || !Number.isFinite(previousRefused) || previousRefused <= 0) return false
  return Math.abs(endable - previousRefused) <= limit
}

export function endingDecision({ endable, live, previousRefused }: EndingCounts): EndingDecision {
  const limit = endingLimit(Number.isFinite(live) ? live : 0)
  if (!Number.isFinite(live) || !Number.isFinite(endable)) return { allowed: false, refused: 0, limit }
  const allowed = endable <= limit || confirmsPreviousRefusal(endable, previousRefused, limit)
  return { allowed, refused: allowed ? 0 : endable, limit }
}

export function endingRefusedReason({ refused, limit }: Pick<EndingDecision, 'refused' | 'limit'>): string | undefined {
  return refused > 0 ? `Encerramento recusado: ${refused} cupons sumiram da lista (limite ${limit})` : undefined
}

export function joinReasons(...reasons: (string | undefined)[]): string | undefined {
  const present = reasons.filter((reason): reason is string => reason !== undefined && reason !== '')
  return present.length > 0 ? present.join('; ') : undefined
}

export function orphanCutoff(now: Date, processStartedAt: Date, chainIdle: boolean): Date {
  const deadline = now.getTime() - RUN_DEADLINE_MS
  return new Date(chainIdle ? Math.max(deadline, processStartedAt.getTime()) : deadline)
}
