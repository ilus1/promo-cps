import { describe, expect, test } from 'vitest'
import type { CrawlerStateRow } from '@/db/crawler-state'
import { AMAZON_DAILY_PAGES, AMAZON_PAGE_INTERVAL_MS, DAY_MS, KABUM_PAGE_INTERVAL_MS, KABUM_PASS_DAYS, MINUTE_MS } from '@/lib/constants'
import { amazonStatus, kabumStatus, type AmazonStatusInputs, type StatusInputs } from './crawler-status'

const NOW = new Date('2026-11-04T12:00:00Z')
const HOLD = { kind: 'vpn', text: 'VPN da empresa conectada: desconecte para rodar', reason: 'VPN conectada' } as const
const PASS_START = new Date(NOW.getTime() - DAY_MS)

function stateRow(over: Partial<CrawlerStateRow> = {}): CrawlerStateRow {
  return {
    site: 'kabum', cursor: {}, backoffLevel: 0, blockedUntil: null, dayKey: '2026-11-04', pagesToday: 12, lastPageAt: NOW,
    passStartedAt: null, bestsellersAt: null, lastError: null, updatedAt: NOW, ...over,
  }
}

const kabum = (over: Partial<StatusInputs> = {}) => kabumStatus({ row: stateRow(), running: true, hold: null, now: NOW, validOffers: 40, ...over })
const amazon = (over: Partial<AmazonStatusInputs> = {}) => amazonStatus({
  row: stateRow({ site: 'amazon' }), running: true, hold: null, now: NOW, validOffers: 7, chainIdle: true, lastWait: null,
  searchedKeys: 3, dueKeys: 9, ...over,
})

describe('crawler state', () => {
  test('stopped wins over everything, then held, then blocked, then waiting', () => {
    const blocked = stateRow({ blockedUntil: new Date(NOW.getTime() + 15 * MINUTE_MS) })
    expect(kabum({ running: false, hold: HOLD, row: blocked }).state).toBe('stopped')
    expect(kabum({ hold: HOLD, row: blocked })).toMatchObject({ state: 'held', holdText: 'VPN conectada', blockedUntil: blocked.blockedUntil })
    expect(kabum({ row: blocked })).toMatchObject({ state: 'blocked', holdText: null, blockedUntil: blocked.blockedUntil })
    expect(amazon({ chainIdle: false, row: blocked })).toMatchObject({ state: 'blocked', waitingFor: null })
  })

  test('a block in the past is no block', () => {
    expect(kabum({ row: stateRow({ blockedUntil: new Date(NOW.getTime() - 1), cursor: { departments: ['audio'] } }) }))
      .toMatchObject({ state: 'running', blockedUntil: null })
  })

  test('Kabum waits for the next pass between passes, and runs during one or when one is due', () => {
    expect(kabum({ row: stateRow({ passStartedAt: PASS_START }) })).toMatchObject({ state: 'waiting', waitingFor: 'next_pass' })
    expect(kabum({ row: stateRow({ passStartedAt: PASS_START, cursor: { departments: ['audio'] } }) }).state).toBe('running')
    expect(kabum({ row: stateRow({ passStartedAt: new Date(NOW.getTime() - KABUM_PASS_DAYS * DAY_MS) }) }).state).toBe('running')
  })

  test('Amazon waits for the daily budget, then for ML, then for an empty queue', () => {
    const spent = stateRow({ site: 'amazon', pagesToday: AMAZON_DAILY_PAGES })
    expect(amazon({ row: spent, chainIdle: false })).toMatchObject({ state: 'waiting', waitingFor: 'daily_budget' })
    expect(amazon({ chainIdle: false, lastWait: 'queue_empty' })).toMatchObject({ state: 'waiting', waitingFor: 'ml_busy' })
    expect(amazon({ lastWait: 'queue_empty' })).toMatchObject({ state: 'waiting', waitingFor: 'queue_empty' })
    expect(amazon({ lastWait: 'ml_busy' })).toMatchObject({ state: 'running', waitingFor: null })
    expect(amazon({ row: stateRow({ site: 'amazon', dayKey: '2026-11-03', pagesToday: AMAZON_DAILY_PAGES }) }).state).toBe('running')
  })
})

describe('crawler fields', () => {
  test('Kabum reports its pace, pages, offers and pass progress', () => {
    const row = stateRow({
      passStartedAt: PASS_START, lastError: 'HTTP 403', cursor: { departments: ['audio', 'tv', 'moda'], index: 1, page: 4, totalPages: 9 },
    })
    expect(kabum({ row })).toEqual({
      state: 'running', holdText: null, waitingFor: null, blockedUntil: null, lastError: 'HTTP 403', pagesToday: 12, dailyBudget: null,
      intervalMs: KABUM_PAGE_INTERVAL_MS, lastPageAt: NOW, validOffers: 40,
      progress: {
        site: 'kabum', department: 'tv', departmentIndex: 1, departmentCount: 3, page: 4, passStartedAt: PASS_START,
        nextPassAt: new Date(PASS_START.getTime() + KABUM_PASS_DAYS * DAY_MS),
      },
    })
  })

  test('Kabum between passes has no department and no page', () => {
    expect(kabum().progress).toEqual({
      site: 'kabum', department: null, departmentIndex: 0, departmentCount: 0, page: 0, passStartedAt: null, nextPassAt: null,
    })
  })

  test('Amazon reports its budget, pace, queue and best sellers', () => {
    const bestsellersAt = new Date(NOW.getTime() - 3 * MINUTE_MS)
    expect(amazon({ row: stateRow({ site: 'amazon', bestsellersAt, dayKey: '2026-11-03' }) })).toMatchObject({
      pagesToday: 0, dailyBudget: AMAZON_DAILY_PAGES, intervalMs: AMAZON_PAGE_INTERVAL_MS, validOffers: 7,
      progress: { site: 'amazon', searchedKeys: 3, dueKeys: 9, bestsellersAt },
    })
  })
})
