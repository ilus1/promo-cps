import { describe, expect, it } from 'vitest'
import { isHeldRun, isRunStatus, RUN_STATUSES } from './domain'

describe('isRunStatus', () => {
  it.each(RUN_STATUSES)('accepts the run status %s', (status) => expect(isRunStatus(status)).toBe(true))
  it.each(['logged_in', 'unconfirmed', 'refused', 'timed_out'])('rejects the login state %s', (status) => {
    expect(isRunStatus(status)).toBe(false)
  })
  it('rejects an unfinished run', () => expect(isRunStatus(null)).toBe(false))
})

describe('isHeldRun', () => {
  it.each([
    [{ status: 'blocked' }, true],
    [{ status: 'blocked', counts: {} }, true],
    [{ status: 'failed', counts: { loadBreaker: 1 } }, true],
    [{ status: 'failed', counts: { loadBreaker: 0 } }, false],
    [{ status: 'failed', counts: {} }, false],
    [{ status: 'failed' }, false],
    [{ status: 'ok', counts: { loadBreaker: 1 } }, false],
    [{ status: null, counts: { loadBreaker: 1 } }, false],
  ])('%j is %s', (run, held) => {
    expect(isHeldRun(run)).toBe(held)
  })
})
