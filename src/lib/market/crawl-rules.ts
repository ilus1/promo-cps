import { DAY_MS, HOUR_MS, MARKET_UNKNOWN_STREAK_STOP, MINUTE_MS } from '../constants'
import { TIME_ZONE } from '../format'
import type { PageKind } from './types'

export const BACKOFF_STEPS_MS: readonly number[] = [15 * MINUTE_MS, HOUR_MS, 4 * HOUR_MS, DAY_MS]

export type PageOutcome = 'reset' | 'block' | 'streak' | 'neutral'

export interface Backoff { level: number; untilMs: number }

export interface CrawlHealth { backoffLevel: number; unknownStreak: number }

export interface CrawlHealthAfterPage extends CrawlHealth { blockedUntilMs: number | null }

const NO_BACKOFF = 0
const NO_PAGES = 0
const NO_STREAK = 0
const DAY_KEY_LOCALE = 'en-US'
const DAY_PARTS = new Intl.DateTimeFormat(DAY_KEY_LOCALE, { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const OUTCOME_OF_KIND: Record<PageKind, PageOutcome> = {
  results: 'reset',
  wall: 'block',
  unknown: 'streak',
  missing: 'neutral',
  empty: 'neutral',
}

export function nextBackoff(level: number, now: Date): Backoff {
  const next = Math.min(Math.max(level, NO_BACKOFF) + 1, BACKOFF_STEPS_MS.length)
  return { level: next, untilMs: now.getTime() + BACKOFF_STEPS_MS[next - 1] }
}

export function dayKey(now: Date): string {
  const parts = Object.fromEntries(DAY_PARTS.formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function pagesToday(savedDayKey: string | null, savedPages: number, now: Date): number {
  return savedDayKey === dayKey(now) ? savedPages : NO_PAGES
}

export function pageDelayMs(intervalMs: number, jitterMs: number, random: number): number {
  return intervalMs + Math.floor(random * jitterMs)
}

export function unknownStreakBlocks(streak: number): boolean {
  return streak >= MARKET_UNKNOWN_STREAK_STOP
}

export function pageOutcome(kind: PageKind): PageOutcome {
  return OUTCOME_OF_KIND[kind]
}

export function healthAfterPage(health: CrawlHealth, kind: PageKind, now: Date): CrawlHealthAfterPage {
  const outcome = pageOutcome(kind)
  if (outcome === 'reset') return { backoffLevel: NO_BACKOFF, unknownStreak: NO_STREAK, blockedUntilMs: null }
  if (outcome === 'neutral') return { ...health, blockedUntilMs: null }
  const unknownStreak = outcome === 'streak' ? health.unknownStreak + 1 : health.unknownStreak
  if (outcome === 'streak' && !unknownStreakBlocks(unknownStreak)) return { ...health, unknownStreak, blockedUntilMs: null }
  const backoff = nextBackoff(health.backoffLevel, now)
  return { backoffLevel: backoff.level, unknownStreak: NO_STREAK, blockedUntilMs: backoff.untilMs }
}
