import { describe, expect, it } from 'vitest'
import type { MarketCard } from '@/lib/market/types'
import { matchCandidates } from './match'
import {
  HIGH_PAIRS, MARKET_DIFFERENT_PAIRS, MARKET_OPEN_FALSE_PAIRS, MARKET_SAME_PAIRS, MARKET_SYNTHETIC_SAME_PAIRS, MEDIUM_PAIRS, REJECTED_PAIRS,
} from './match-labels'

const card = (name: string, priceCents: number, store: string): MarketCard =>
  ({ name, priceCents, store, storeCount: null, url: 'https://www.kabum.com.br/x' })

const confidenceOf = (ml: string, final: number, name: string, price: number) =>
  matchCandidates(ml, final, [card(name, price, 'Loja A'), card(name, price + 1, 'Loja B')]).confidence

describe('matchCandidates on reviewed title pairs', () => {
  it.each(REJECTED_PAIRS)('rejects %s vs %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBeNull()
  })
  it.each(MEDIUM_PAIRS)('caps at medium: %s vs %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBe('medium')
  })
  it.each(HIGH_PAIRS)('keeps the same product high: %s vs %s', (ml, final, name, price) => {
    expect(confidenceOf(ml, final, name, price)).toBe('high')
  })
})

const marketConfidenceOf = (ml: string, final: number, name: string, price: number, brand: string | null) =>
  matchCandidates(ml, final, [{ name, priceCents: price, store: brand === null ? 'Amazon' : 'Kabum', storeCount: 1, url: 'https://www.kabum.com.br/x', brand }]).confidence

describe('matchCandidates on live Kabum and Amazon pairs (2026-11-04)', () => {
  it.each([...MARKET_SAME_PAIRS, ...MARKET_SYNTHETIC_SAME_PAIRS])('keeps the same product high: %s vs %s', (ml, final, name, price, brand) => {
    expect(marketConfidenceOf(ml, final, name, price, brand)).toBe('high')
  })
  it.each(MARKET_DIFFERENT_PAIRS)('never calls a different product high: %s vs %s', (ml, final, name, price, brand) => {
    expect(marketConfidenceOf(ml, final, name, price, brand)).not.toBe('high')
  })
  it.fails.each(MARKET_OPEN_FALSE_PAIRS)('known false high, still open: %s vs %s', (ml, final, name, price, brand) => {
    expect(marketConfidenceOf(ml, final, name, price, brand)).not.toBe('high')
  })
})
