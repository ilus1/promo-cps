import type { Run } from '@/db/schema'
import { describe, expect, it } from 'vitest'
import { ENDING_MIN_CAP, RUN_DEADLINE_MS } from '@/lib/constants'
import {
  activationLimit, cycleStatus, endingCutoff, endingDecision, endingLimit, endingRefusedReason,
  isMainFrameNavigation, joinReasons, orphanCutoff, partialReason, stoppedSince,
} from './cycle-rules'

const MAIN = { id: 'main' }
const IFRAME = { id: 'iframe' }
const page = { mainFrame: () => MAIN } as never
const request = (navigation: boolean, frame: () => unknown) => ({
  isNavigationRequest: () => navigation,
  frame,
}) as never

describe('isMainFrameNavigation', () => {
  it('counts a navigation of the main frame', () => {
    expect(isMainFrameNavigation(request(true, () => MAIN), page)).toBe(true)
  })

  it('ignores subresources and other frames', () => {
    expect(isMainFrameNavigation(request(false, () => MAIN), page)).toBe(false)
    expect(isMainFrameNavigation(request(true, () => IFRAME), page)).toBe(false)
  })

  it('is false when frame() throws', () => {
    const throwing = () => { throw new Error('Frame for this navigation request is not available') }
    expect(isMainFrameNavigation(request(true, throwing), page)).toBe(false)
  })

  it('does not ask for the frame of a non-navigation request', () => {
    const throwing = () => { throw new Error('unreachable') }
    expect(isMainFrameNavigation(request(false, throwing), page)).toBe(false)
  })
})

describe('endingCutoff', () => {
  const startedAt = new Date('2026-11-02T10:00:00Z')
  const fullPrevious = { startedAt, counts: { fullHarvest: 1, seen: 1931 } }

  it('is the previous full cycle start when both harvests are full', () => {
    expect(endingCutoff(true, fullPrevious)).toBe(startedAt)
  })

  it('is null when this harvest is not full', () => {
    expect(endingCutoff(false, fullPrevious)).toBeNull()
  })

  it('is null without a previous cycle', () => {
    expect(endingCutoff(true, null)).toBeNull()
    expect(endingCutoff(true, undefined)).toBeNull()
  })

  it.each([
    ['not full', { fullHarvest: 0 }],
    ['unfinished (no counts)', {}],
    ['recorded before the rule existed', { seen: 1931 }],
  ])('is null when the previous harvest was %s', (_name, counts) => {
    expect(endingCutoff(true, { startedAt, counts })).toBeNull()
  })
})

describe('cycleStatus', () => {
  it('is ok only for a full harvest and no failed step', () => {
    expect(cycleStatus(true, 0)).toBe('ok')
    expect(cycleStatus(false, 0)).toBe('partial')
    expect(cycleStatus(true, 1)).toBe('partial')
    expect(cycleStatus(false, 3)).toBe('partial')
  })
})

describe('partialReason', () => {
  const harvest = { allPagesLoaded: true, seen: 1931, skipped: 0, failedPages: 0, totalCoupons: 1933, lastError: null }

  it('prefers the harvest error, then the incomplete-read reason, then the discovery error', () => {
    expect(partialReason({ ...harvest, allPagesLoaded: false, lastError: 'pagina 3' }, 'x')).toBe('pagina 3')
    expect(partialReason({ ...harvest, allPagesLoaded: false }, 'x')).toBe('Leitura de cupons incompleta: 1931 de 1933')
    expect(partialReason(harvest, 'listagem falhou')).toBe('listagem falhou')
  })

  it('names skipped entries when they are the only reason the read is not full', () => {
    const skippedOnly = { ...harvest, allPagesLoaded: false, seen: 1932, skipped: 1 }
    expect(partialReason(skippedOnly, null)).toBe('Leitura de cupons incompleta: 1 entrada ignorada')
    expect(partialReason({ ...skippedOnly, skipped: 2, seen: skippedOnly.totalCoupons - 2 }, null))
      .toBe('Leitura de cupons incompleta: 2 entradas ignoradas')
    expect(partialReason({ ...skippedOnly, failedPages: 1 }, null)).toBe('Leitura de cupons incompleta: 1932 de 1933')
    expect(partialReason({ ...skippedOnly, seen: 1000 }, null)).toBe('Leitura de cupons incompleta: 1000 de 1933')
  })

  it('is undefined when there is nothing to say', () => {
    expect(partialReason(harvest, null)).toBeUndefined()
  })
})

describe('stoppedSince', () => {
  const since = new Date('2026-11-02T12:00:00Z')
  const finished = (status: string, minutes: number) => ({
    status, finishedAt: new Date(since.getTime() + minutes * 60_000),
  }) as Pick<Run, 'status' | 'finishedAt'>

  it.each(['blocked', 'session_expired'])('is true for a %s run finished after the request', (status) => {
    expect(stoppedSince([finished(status, 1)], since)).toBe(true)
  })
  it.each(['ok', 'partial', 'failed'])('is false for a %s run', (status) => {
    expect(stoppedSince([finished(status, 1)], since)).toBe(false)
  })
  it('is false for a stop that finished before or exactly at the request', () => {
    expect(stoppedSince([finished('blocked', -1), finished('blocked', 0)], since)).toBe(false)
  })
  it('is true for a breaker-failed run and false for a plain failed one', () => {
    expect(stoppedSince([{ status: 'failed', counts: { loadBreaker: 1 }, finishedAt: new Date(since.getTime() + 1) }], since)).toBe(true)
    expect(stoppedSince([{ status: 'failed', counts: {}, finishedAt: new Date(since.getTime() + 1) }], since)).toBe(false)
  })
  it('is false for no runs, an undefined run, and a run without a finish time', () => {
    expect(stoppedSince([], since)).toBe(false)
    expect(stoppedSince([undefined, undefined], since)).toBe(false)
    expect(stoppedSince([{ status: 'blocked', finishedAt: null }], since)).toBe(false)
  })
  it('is true when any of the runs qualifies', () => {
    expect(stoppedSince([finished('ok', 1), undefined, finished('blocked', 2)], since)).toBe(true)
  })
})

describe('activationLimit', () => {
  it('keeps the limit when the harvest saw coupons', () => {
    expect(activationLimit(1, 20)).toBe(20)
    expect(activationLimit(300, 0)).toBe(0)
  })

  it('is zero when the harvest saw none, and for an invalid count', () => {
    expect(activationLimit(0, 20)).toBe(0)
    expect(activationLimit(-1, 20)).toBe(0)
    expect(activationLimit(Number.NaN, 20)).toBe(0)
  })
})

describe('endingLimit', () => {
  it('is the floor for small and invalid live counts', () => {
    expect(endingLimit(0)).toBe(ENDING_MIN_CAP)
    expect(endingLimit(-5)).toBe(ENDING_MIN_CAP)
    expect(endingLimit(600)).toBe(ENDING_MIN_CAP)
    expect(endingLimit(599)).toBe(ENDING_MIN_CAP)
  })
  it('is 5% of the live coupons once that passes the floor', () => {
    expect(endingLimit(2000)).toBe(100)
    expect(endingLimit(659)).toBe(32)
    expect(endingLimit(1000)).toBe(50)
  })
})

describe('endingDecision', () => {
  it('allows nothing to end and a normal ending', () => {
    expect(endingDecision({ endable: 0, live: 2000 })).toEqual({ allowed: true, refused: 0, limit: 100 })
    expect(endingDecision({ endable: 20, live: 2000 })).toEqual({ allowed: true, refused: 0, limit: 100 })
  })
  it('allows exactly the limit and refuses one more', () => {
    expect(endingDecision({ endable: 100, live: 2000 }).allowed).toBe(true)
    expect(endingDecision({ endable: 101, live: 2000 })).toEqual({ allowed: false, refused: 101, limit: 100 })
  })
  it('refuses a mass ending of every live coupon, and uses the floor on an empty base', () => {
    expect(endingDecision({ endable: 2000, live: 2000 })).toMatchObject({ allowed: false, refused: 2000 })
    expect(endingDecision({ endable: 31, live: 0 })).toMatchObject({ allowed: false, refused: 31, limit: ENDING_MIN_CAP })
    expect(endingDecision({ endable: 30, live: 0 }).allowed).toBe(true)
  })
})

describe('endingDecision confirmation by repetition', () => {
  const live = 2000
  it('has no confirmation without a previous refusal', () => {
    expect(endingDecision({ endable: 500, live }).allowed).toBe(false)
    expect(endingDecision({ endable: 500, live, previousRefused: 0 }).allowed).toBe(false)
    expect(endingDecision({ endable: 500, live, previousRefused: undefined }).allowed).toBe(false)
  })
  it('allows a count exactly one limit away from the previous refusal and refuses one more', () => {
    expect(endingDecision({ endable: 600, live, previousRefused: 500 }).allowed).toBe(true)
    expect(endingDecision({ endable: 400, live, previousRefused: 500 }).allowed).toBe(true)
    expect(endingDecision({ endable: 601, live, previousRefused: 500 })).toMatchObject({ allowed: false, refused: 601 })
    expect(endingDecision({ endable: 399, live, previousRefused: 500 }).allowed).toBe(false)
  })
  it('refuses non-finite counts and ignores a non-finite previous refusal', () => {
    expect(endingDecision({ endable: Number.NaN, live }).allowed).toBe(false)
    expect(endingDecision({ endable: Number.POSITIVE_INFINITY, live }).allowed).toBe(false)
    expect(endingDecision({ endable: 10, live: Number.NaN }).allowed).toBe(false)
    expect(endingDecision({ endable: 500, live, previousRefused: Number.NaN }).allowed).toBe(false)
  })
})

describe('endingRefusedReason and joinReasons', () => {
  it('words the refusal only when something was refused', () => {
    expect(endingRefusedReason({ refused: 0, limit: 30 })).toBeUndefined()
    expect(endingRefusedReason({ refused: 400, limit: 100 })).toBe('Encerramento recusado: 400 cupons sumiram da lista (limite 100)')
  })
  it('joins the present reasons and drops the empty ones', () => {
    expect(joinReasons(undefined, '')).toBeUndefined()
    expect(joinReasons('a', undefined)).toBe('a')
    expect(joinReasons('a', 'b')).toBe('a; b')
  })
})

describe('orphanCutoff', () => {
  const now = new Date('2026-11-03T12:00:00Z')
  const deadline = now.getTime() - RUN_DEADLINE_MS
  it('is the deadline when a run may be live in this process', () => {
    expect(orphanCutoff(now, new Date('2026-11-03T11:59:00Z'), false).getTime()).toBe(deadline)
  })
  it('is the process start when idle and the process started inside the deadline', () => {
    const started = new Date('2026-11-03T11:59:00Z')
    expect(orphanCutoff(now, started, true)).toEqual(started)
  })
  it('stays at the deadline when idle and the process is older than the deadline', () => {
    expect(orphanCutoff(now, new Date('2026-11-03T01:00:00Z'), true).getTime()).toBe(deadline)
  })
})
