import { countEndingCandidates, endCouponsNotSeenSince } from '@/db/coupons'
import type { Run } from '@/db/schema'
import { pruneOld } from '@/db/prune'
import { lastHealthNotifiedAt, lastRun, lastWorkedCycleRun } from '@/db/runs'
import { env } from '@/env'
import { CYCLE_COUNT } from '@/lib/cycle-counts'
import { cycleHealth, healthMask, shouldNotifyHealth } from '@/lib/cycle-health'
import type { CycleActivity } from '@/lib/domain'
import { pruneLine } from '@/lib/prune-rules'
import {
  activationLimit, cycleStatus, discoveryBudget, endingCutoff, endingDecision, endingRefusedReason, joinReasons, partialReason,
  type EndingDecision,
} from './cycle-rules'
import { afterRun } from './after-run'
import { replanAutoRun } from './auto-run'
import { errorText } from './errors'
import { mlHoldCheck } from './request-hold'
import { phaseOf, recordedRun, requestJob, stoppedSinceRequest, type JobBook } from './recorded-run'
import { activate } from './steps/activate'
import { loadBreaker } from './steps/breaker'
import { discover } from './steps/discover'
import { runDueBuscas } from './steps/buscas'
import { harvest } from './steps/harvest'

declare global {
  var __promoCycle: JobBook<Run> | undefined
}

const CYCLE_KEY = 'cycle'
const PRUNE_LOG_TAG = '[prune]'
const HEALTH_LOG_TAG = '[health]'

function book(): JobBook<Run> {
  globalThis.__promoCycle ??= new Map()
  return globalThis.__promoCycle
}

export function cycleActivity(): CycleActivity {
  return { phase: phaseOf(globalThis.__promoCycle, CYCLE_KEY) }
}

const NO_REFUSAL: Pick<EndingDecision, 'refused' | 'limit'> = { refused: 0, limit: 0 }

async function endVanished(
  cutoff: Date | null, previousRefused: number | undefined, counts: Record<string, number>,
): Promise<Pick<EndingDecision, 'refused' | 'limit'>> {
  counts[CYCLE_COUNT.ended] = 0
  if (!cutoff) return NO_REFUSAL
  const decision = endingDecision({ ...await countEndingCandidates(cutoff, new Date()), previousRefused })
  if (!decision.allowed) {
    counts[CYCLE_COUNT.endingRefused] = decision.refused
    return decision
  }
  counts[CYCLE_COUNT.ended] = await endCouponsNotSeenSince(cutoff, new Date())
  return NO_REFUSAL
}

async function pruneAfter(): Promise<void> {
  try {
    const pruned = await pruneOld(new Date())
    console.log(PRUNE_LOG_TAG, pruneLine(pruned))
  } catch (e) {
    console.error(PRUNE_LOG_TAG, 'failed', errorText(e))
  }
}

async function lastNotified(): Promise<Date | null> {
  try {
    return await lastHealthNotifiedAt()
  } catch (e) {
    console.error(HEALTH_LOG_TAG, 'last notification lookup failed', errorText(e))
    return null
  }
}

async function healthCounts(counts: Record<string, number>, previousWorked: Run | undefined, startedAt: Date): Promise<void> {
  const mask = healthMask(cycleHealth(counts))
  counts[CYCLE_COUNT.health] = mask
  counts[CYCLE_COUNT.healthNotify] = shouldNotifyHealth({
    mask,
    previousMask: previousWorked?.counts[CYCLE_COUNT.health] ?? 0,
    lastNotifiedAt: mask === 0 ? null : await lastNotified(),
    startedAt,
    cycleEveryHours: env().RUN_EVERY_HOURS,
  }) ? 1 : 0
}

async function runCycle(): Promise<Run> {
  const previous = await lastRun('cycle')
  const previousWorked = await lastWorkedCycleRun()
  const startedAt = new Date()
  const finished = await recordedRun('cycle', async (page, report) => {
    const { counts } = report
    const breaker = loadBreaker(mlHoldCheck)
    const h = await harvest(page, breaker)
    Object.assign(counts, {
      [CYCLE_COUNT.seen]: h.seen,
      [CYCLE_COUNT.inserted]: h.inserted,
      [CYCLE_COUNT.skipped]: h.skipped,
      [CYCLE_COUNT.unparsed]: h.unparsed,
      [CYCLE_COUNT.totalCoupons]: h.totalCoupons,
      [CYCLE_COUNT.failedPages]: h.failedPages,
      [CYCLE_COUNT.fullHarvest]: h.allPagesLoaded ? 1 : 0,
    })
    const cutoff = endingCutoff(h.allPagesLoaded, previous)
    const refusal = await endVanished(cutoff, previous?.counts[CYCLE_COUNT.endingRefused], counts)
    const a = await activate(page, activationLimit(h.seen, env().ACTIVATE_PER_RUN), new Date(), h.couponPages, breaker)
    Object.assign(counts, {
      [CYCLE_COUNT.activated]: a.activated,
      [CYCLE_COUNT.activationFailed]: a.failed,
      [CYCLE_COUNT.activationSkipped]: a.skipped,
    })
    const s = await runDueBuscas(page, new Date(), breaker, env().RUN_EVERY_HOURS)
    Object.assign(counts, s.counts)
    const d = await discover(page, discoveryBudget(env().DISCOVERY_PAGES_PER_RUN, counts[CYCLE_COUNT.buscaPages]), new Date(), breaker)
    Object.assign(counts, {
      [CYCLE_COUNT.discoveryPages]: d.pages,
      [CYCLE_COUNT.discoveredItems]: d.items,
      [CYCLE_COUNT.discoveryFailed]: d.failed,
      [CYCLE_COUNT.discoveryRead]: d.read,
      [CYCLE_COUNT.discoveryEmpty]: d.empty,
      [CYCLE_COUNT.discoveryLinks]: d.couponLinks,
      [CYCLE_COUNT.discoveryCards]: d.cards,
      [CYCLE_COUNT.discoveryBasisOther]: d.basisOther,
      [CYCLE_COUNT.droppedCards]: d.droppedCards,
    })
    await healthCounts(counts, previousWorked, startedAt)
    report.status = cycleStatus(h.allPagesLoaded, s.failed + d.failed)
    report.error = joinReasons(
      report.status === 'partial' ? partialReason(h, d.lastError ?? s.lastError) : undefined,
      endingRefusedReason(refusal),
    )
  })
  await pruneAfter()
  afterRun(finished)
  return finished
}

async function runRequestedCycle(requestedAt: Date): Promise<Run | null> {
  if (await stoppedSinceRequest(requestedAt)) return null
  return runCycle()
}

export function requestCycle(): Promise<Run | null> {
  const requestedAt = new Date()
  return requestJob(book(), CYCLE_KEY, () => runRequestedCycle(requestedAt).finally(replanAutoRun))
}
