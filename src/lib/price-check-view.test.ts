import { describe, expect, it } from 'vitest'
import { MINUTE_MS } from './constants'
import { NO_CHECK_YET_TEXT, priceCheckPanel, type PriceCheckSummaryView } from './price-check-view'

const NOW = new Date('2026-11-03T12:00:00Z')
const summary = (over: Partial<PriceCheckSummaryView> = {}): PriceCheckSummaryView => ({
  lastCheckedAt: new Date(NOW.getTime() - 12 * MINUTE_MS),
  counts: { matched: 40, no_match: 30, failed: 0, blocked: 0 },
  ...over,
})

describe('priceCheckPanel', () => {
  it('reports the last check, the 24 h counts and the inflated items', () => {
    expect(priceCheckPanel(summary(), 7, NOW)).toEqual({
      last: 'Última verificação há 12 min',
      counts: 'Nas últimas 24 h: 70 verificados, 40 com equivalente',
      inflated: 'Descontos inflados ativos: 7',
    })
  })

  it('says so before any check', () => {
    expect(priceCheckPanel(summary({ lastCheckedAt: null }), 0, NOW).last).toBe(NO_CHECK_YET_TEXT)
  })

  it('agrees in number and lists failures only when there are some', () => {
    const one = priceCheckPanel(summary({ counts: { matched: 1, no_match: 0, failed: 1, blocked: 0 } }), 0, NOW)
    expect(one.counts).toBe('Nas últimas 24 h: 1 verificado, 1 com equivalente, 1 falha')
    expect(priceCheckPanel(summary({ counts: { matched: 0, no_match: 2, failed: 3, blocked: 0 } }), 0, NOW).counts).toContain(', 3 falhas')
  })

  it('formats large counts with the pt-BR separator', () => {
    expect(priceCheckPanel(summary({ counts: { matched: 1200, no_match: 300, failed: 0, blocked: 0 } }), 2345, NOW)).toMatchObject({
      counts: 'Nas últimas 24 h: 1.500 verificados, 1.200 com equivalente',
      inflated: 'Descontos inflados ativos: 2.345',
    })
  })
})
