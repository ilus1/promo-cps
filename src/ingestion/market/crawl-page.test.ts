import { expect, test } from 'vitest'
import type { CrawlerStateRow } from '@/db/crawler-state'
import { MARKET_IDLE_RECHECK_MS, MINUTE_MS } from '@/lib/constants'
import { afterPage, failureText, nextPageAt, remainingMs, waitStep } from './crawl-page'

const NOW = new Date('2026-11-04T12:00:00Z')

function stateRow(over: Partial<CrawlerStateRow> = {}): CrawlerStateRow {
  return {
    site: 'kabum', cursor: {}, backoffLevel: 0, blockedUntil: null, dayKey: '2026-11-04', pagesToday: 9, lastPageAt: null,
    passStartedAt: null, bestsellersAt: null, lastError: 'HTTP 403', updatedAt: NOW, ...over,
  }
}

test('waits never go below zero nor past the idle recheck', () => {
  expect(waitStep(-5)).toEqual({ sleepMs: 0, waitingFor: null })
  expect(waitStep(MINUTE_MS, 'ml_busy')).toEqual({ sleepMs: MINUTE_MS, waitingFor: 'ml_busy' })
  expect(waitStep(MARKET_IDLE_RECHECK_MS * 10, 'next_pass')).toEqual({ sleepMs: MARKET_IDLE_RECHECK_MS, waitingFor: 'next_pass' })
})

test('remaining time and the next page time handle a missing date', () => {
  expect(remainingMs(null, NOW)).toBe(0)
  expect(remainingMs(new Date(NOW.getTime() - 1), NOW)).toBe(0)
  expect(remainingMs(new Date(NOW.getTime() + 5), NOW)).toBe(5)
  expect(nextPageAt(null, 10)).toBeNull()
  expect(nextPageAt(NOW, 10)).toEqual(new Date(NOW.getTime() + 10))
})

test('a network reason is kept after the page reason', () => {
  expect(failureText('sem resposta', { status: 0, html: '', reason: 'tempo esgotado' })).toBe('sem resposta: tempo esgotado')
  expect(failureText('HTTP 403', { status: 403, html: '' })).toBe('HTTP 403')
})

test('a neutral page counts the page and keeps the last error, a failure replaces it and results clear it', () => {
  const neutral = afterPage(stateRow(), 1, { kind: 'empty', reason: 'sem produtos' }, NOW)
  expect(neutral).toEqual({
    unknownStreak: 1,
    blockedUntil: null,
    patch: { backoffLevel: 0, blockedUntil: null, dayKey: '2026-11-04', pagesToday: 10, lastPageAt: NOW, lastError: 'HTTP 403' },
  })
  expect(afterPage(stateRow(), 0, { kind: 'unknown', reason: 'sem __NEXT_DATA__' }, NOW).patch.lastError).toBe('sem __NEXT_DATA__')
  expect(afterPage(stateRow(), 0, { kind: 'results', reason: null }, NOW).patch.lastError).toBeNull()
})

test('a wall blocks with the next backoff step', () => {
  const walled = afterPage(stateRow({ backoffLevel: 2 }), 0, { kind: 'wall', reason: 'captcha' }, NOW)
  expect(walled.blockedUntil).toEqual(new Date(NOW.getTime() + 4 * 60 * MINUTE_MS))
  expect(walled.patch).toMatchObject({ backoffLevel: 3, lastError: 'captcha' })
})
