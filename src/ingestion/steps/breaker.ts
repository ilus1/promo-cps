import { CYCLE_COUNT } from '@/lib/cycle-counts'
import { LOAD_FAILURE_TEXT } from '@/lib/domain'
import type { RequestHold } from '@/lib/request-hold'
import { errorText, holdStop, isRunStop, RunStop } from '../errors'
import type { ClickResponse } from '../ml/activate-click'

export const MAX_CONSECUTIVE_LOAD_FAILURES = 3
export const MAX_UNANSWERED_CLICKS = 2
export const MAX_UNPARSED_PAGES_IN_ROW = 3
export const UNANSWERED_CLICKS_STOP = `O Mercado Livre não respondeu a ${MAX_UNANSWERED_CLICKS} ativações seguidas`

export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string }

export interface FailureTally {
  failed: number
  lastError: string | null
  fail(error: string): void
}

export function failureTally(): FailureTally {
  const tally: FailureTally = {
    failed: 0,
    lastError: null,
    fail(error) {
      tally.failed += 1
      tally.lastError = error
    },
  }
  return tally
}

export interface LoadBreaker {
  load<T>(work: () => Promise<T>): Promise<Loaded<T>>
  loadUncounted<T>(work: () => Promise<T>): Promise<Loaded<T>>
  checkHold(): Promise<void>
}

export interface ClickBreaker {
  saw(click: ClickResponse): void
}

export function loadBreaker(holdCheck?: () => Promise<RequestHold | null>): LoadBreaker {
  let consecutive = 0
  const checkHold = async () => {
    const hold = await holdCheck?.()
    if (hold) throw holdStop(hold)
  }
  return {
    checkHold,
    async load(work) {
      await checkHold()
      try {
        const value = await work()
        consecutive = 0
        return { ok: true, value }
      } catch (e) {
        if (isRunStop(e)) throw e
        consecutive += 1
        if (consecutive >= MAX_CONSECUTIVE_LOAD_FAILURES) {
          throw new RunStop('failed', `${LOAD_FAILURE_TEXT}: ${errorText(e)}`, { cause: e, counts: { [CYCLE_COUNT.loadBreaker]: 1 } })
        }
        return { ok: false, error: errorText(e) }
      }
    },
    async loadUncounted(work) {
      await checkHold()
      try {
        return { ok: true, value: await work() }
      } catch (e) {
        if (isRunStop(e)) throw e
        return { ok: false, error: errorText(e) }
      }
    },
  }
}

export function clickBreaker(): ClickBreaker {
  let unanswered = 0
  return {
    saw(click) {
      if (click === 'answered') unanswered = 0
      if (click === 'unanswered') unanswered += 1
      if (unanswered >= MAX_UNANSWERED_CLICKS) throw new RunStop('blocked', UNANSWERED_CLICKS_STOP)
    },
  }
}
