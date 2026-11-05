import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS, KABUM_PAGE_INTERVAL_MS, KABUM_PAGE_JITTER_MS, KABUM_PASS_DAYS, MINUTE_MS } from '../constants'
import {
  BACKOFF_STEPS_MS, dayKey, healthAfterPage, kabumNextPassAt, kabumPassDue, nextBackoff, pageDelayMs, pageOutcome, pagesToday,
  unknownStreakBlocks, withinBudget,
} from './crawl-rules'
import { PAGE_KINDS } from './types'

const NOW = new Date('2026-11-04T12:00:00Z')
const at = (ms: number) => NOW.getTime() + ms

describe('nextBackoff', () => {
  it('steps through 15 min, 1 h, 4 h and 24 h, then stays at 24 h', () => {
    expect(BACKOFF_STEPS_MS).toEqual([15 * MINUTE_MS, HOUR_MS, 4 * HOUR_MS, DAY_MS])
    expect(nextBackoff(0, NOW)).toEqual({ level: 1, untilMs: at(15 * MINUTE_MS) })
    expect(nextBackoff(1, NOW)).toEqual({ level: 2, untilMs: at(HOUR_MS) })
    expect(nextBackoff(2, NOW)).toEqual({ level: 3, untilMs: at(4 * HOUR_MS) })
    expect(nextBackoff(3, NOW)).toEqual({ level: 4, untilMs: at(DAY_MS) })
    expect(nextBackoff(4, NOW)).toEqual({ level: 4, untilMs: at(DAY_MS) })
    expect(nextBackoff(9, NOW)).toEqual({ level: 4, untilMs: at(DAY_MS) })
  })
  it('treats a negative level as none', () => {
    expect(nextBackoff(-2, NOW)).toEqual({ level: 1, untilMs: at(15 * MINUTE_MS) })
  })
})

describe('dayKey and pagesToday', () => {
  it('uses the America/Sao_Paulo calendar day', () => {
    expect(dayKey(new Date('2026-11-04T02:59:59Z'))).toBe('2026-11-03')
    expect(dayKey(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-04')
    expect(dayKey(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31')
  })
  it('follows the old daylight saving time, when Sao Paulo was UTC-2', () => {
    expect(dayKey(new Date('2018-12-01T01:59:59Z'))).toBe('2018-11-30')
    expect(dayKey(new Date('2018-12-01T02:00:00Z'))).toBe('2018-12-01')
  })
  it('keeps the saved count only on the same day', () => {
    expect(pagesToday('2026-11-04', 37, NOW)).toBe(37)
    expect(pagesToday('2026-11-03', 37, NOW)).toBe(0)
    expect(pagesToday(null, 37, NOW)).toBe(0)
  })
})

describe('withinBudget', () => {
  it('allows pages below the budget only', () => {
    expect(withinBudget(999, 1000)).toBe(true)
    expect(withinBudget(1000, 1000)).toBe(false)
    expect(withinBudget(1001, 1000)).toBe(false)
  })
})

describe('pageDelayMs', () => {
  it('adds up to the jitter to the interval', () => {
    expect(pageDelayMs(KABUM_PAGE_INTERVAL_MS, KABUM_PAGE_JITTER_MS, 0)).toBe(KABUM_PAGE_INTERVAL_MS)
    expect(pageDelayMs(KABUM_PAGE_INTERVAL_MS, KABUM_PAGE_JITTER_MS, 0.5)).toBe(KABUM_PAGE_INTERVAL_MS + KABUM_PAGE_JITTER_MS / 2)
    expect(pageDelayMs(KABUM_PAGE_INTERVAL_MS, KABUM_PAGE_JITTER_MS, 0.99999)).toBe(KABUM_PAGE_INTERVAL_MS + KABUM_PAGE_JITTER_MS - 1)
  })
})

describe('kabumPassDue', () => {
  const started = new Date(NOW.getTime() - KABUM_PASS_DAYS * DAY_MS)
  it('is due with no pass yet', () => {
    expect(kabumPassDue(null, NOW)).toBe(true)
    expect(kabumNextPassAt(null)).toBeNull()
  })
  it('is due 3 days after the last pass started, not 1 ms before', () => {
    expect(kabumNextPassAt(started)).toEqual(NOW)
    expect(kabumPassDue(started, NOW)).toBe(true)
    expect(kabumPassDue(new Date(started.getTime() + 1), NOW)).toBe(false)
  })
})

describe('unknownStreakBlocks', () => {
  it('blocks at 3 unknown pages in a row', () => {
    expect(unknownStreakBlocks(2)).toBe(false)
    expect(unknownStreakBlocks(3)).toBe(true)
  })
})

describe('pageOutcome', () => {
  it('maps every page kind', () => {
    expect(Object.fromEntries(PAGE_KINDS.map((kind) => [kind, pageOutcome(kind)]))).toEqual({
      results: 'reset', empty: 'neutral', wall: 'block', unknown: 'streak', missing: 'neutral',
    })
  })
})

describe('healthAfterPage', () => {
  const healthy = { backoffLevel: 0, unknownStreak: 0 }
  it('resets the level and the streak on results', () => {
    expect(healthAfterPage({ backoffLevel: 3, unknownStreak: 2 }, 'results', NOW)).toEqual({ backoffLevel: 0, unknownStreak: 0, blockedUntilMs: null })
  })
  it('moves one step up on a wall', () => {
    expect(healthAfterPage(healthy, 'wall', NOW)).toEqual({ backoffLevel: 1, unknownStreak: 0, blockedUntilMs: at(15 * MINUTE_MS) })
    expect(healthAfterPage({ backoffLevel: 1, unknownStreak: 1 }, 'wall', NOW)).toEqual({ backoffLevel: 2, unknownStreak: 0, blockedUntilMs: at(HOUR_MS) })
  })
  it('blocks on the third unknown page in a row', () => {
    const first = healthAfterPage(healthy, 'unknown', NOW)
    const second = healthAfterPage(first, 'unknown', NOW)
    expect([first, second]).toEqual([
      { backoffLevel: 0, unknownStreak: 1, blockedUntilMs: null },
      { backoffLevel: 0, unknownStreak: 2, blockedUntilMs: null },
    ])
    expect(healthAfterPage(second, 'unknown', NOW)).toEqual({ backoffLevel: 1, unknownStreak: 0, blockedUntilMs: at(15 * MINUTE_MS) })
  })
  it.each(['missing', 'empty'] as const)('leaves the level and the streak alone on %s', (kind) => {
    expect(healthAfterPage({ backoffLevel: 2, unknownStreak: 1 }, kind, NOW)).toEqual({ backoffLevel: 2, unknownStreak: 1, blockedUntilMs: null })
  })
})
