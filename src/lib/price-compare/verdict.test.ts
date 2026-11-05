import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOUR_MS, MARKET_CHECK_VALID_HOURS, PERCENT_BASE, SIBLING_CHEAPER_PERCENT } from '../constants'
import { STATUS_NOT_SEEN, STATUS_SAVED, STATUS_SEEN } from '../domain'
import type { MarketCard } from '../market/types'
import { matchCandidates } from './match'
import { cheaperSiblingOf, priceVerdict, type VerdictCheck, type VerdictInput, type VerdictItem } from './verdict'

const now = new Date('2026-11-03T12:00:00Z')
const MARKET_LOW = 1266

const check = (over: Partial<VerdictCheck> = {}): VerdictCheck => ({
  status: 'matched',
  confidence: 'high',
  checkedAt: now,
  marketLowCents: MARKET_LOW,
  ...over,
})
const item = (over: Partial<VerdictItem> = {}): VerdictItem => ({
  priceCents: 1201,
  finalCents: 1201,
  showsSaving: true,
  status: STATUS_NOT_SEEN,
  ...over,
})
const verdict = (over: Partial<VerdictInput> = {}) =>
  priceVerdict({ check: check(), item: item(), siblingPriceCents: null, now, ...over })

describe('priceVerdict inflated', () => {
  it('final equal to the market low is inflated', () => {
    expect(verdict({ item: item({ finalCents: MARKET_LOW }) })).toMatchObject({ inflated: true, hidden: true, realSavingCents: 0 })
  })
  it('1 centavo below the market low is not inflated', () => {
    expect(verdict({ item: item({ finalCents: MARKET_LOW - 1 }) })).toMatchObject({
      inflated: false, hidden: false, realSavingCents: 1,
    })
  })
  it('final above the market low is inflated with a negative saving', () => {
    expect(verdict({ item: item({ finalCents: MARKET_LOW + 100 }) })).toMatchObject({ inflated: true, realSavingCents: -100 })
  })
  it('needs a saving shown on the card', () => {
    expect(verdict({ item: item({ finalCents: MARKET_LOW, showsSaving: false }) }).inflated).toBe(false)
  })
  it('medium confidence never flags and gives no real saving', () => {
    expect(verdict({ item: item({ finalCents: MARKET_LOW + 500 }), check: check({ confidence: 'medium' }) })).toEqual({
      inflated: false, cheaperSibling: false, realSavingCents: null, realSavingRatio: null, hidden: false,
    })
  })
  it.each(['no_match', 'failed', 'blocked'] as const)('a %s check never flags', (status) => {
    expect(verdict({ item: item({ finalCents: MARKET_LOW }), check: check({ status }) }).inflated).toBe(false)
  })
  it('no check, no market low', () => {
    expect(verdict({ check: null })).toMatchObject({ inflated: false, realSavingCents: null })
    expect(verdict({ check: check({ marketLowCents: null }) }).realSavingCents).toBeNull()
  })
})

describe('priceVerdict one offer', () => {
  it('one high offer at or below the final price is enough to flag', () => {
    expect(verdict({ item: item({ finalCents: MARKET_LOW + 100 }) })).toMatchObject({ inflated: true, hidden: true })
  })
})

describe('priceVerdict validity edge', () => {
  const edge = now.getTime() - MARKET_CHECK_VALID_HOURS * HOUR_MS
  const stale = item({ finalCents: MARKET_LOW })
  it('exactly at the edge is still valid', () => {
    expect(verdict({ item: stale, check: check({ checkedAt: new Date(edge) }) }).inflated).toBe(true)
  })
  it('1 ms older is ignored', () => {
    expect(verdict({ item: stale, check: check({ checkedAt: new Date(edge - 1) }) })).toMatchObject({
      inflated: false, realSavingCents: null,
    })
  })
})

describe('priceVerdict real saving', () => {
  it('is the market low minus the final price, with its ratio', () => {
    expect(verdict({ item: item({ finalCents: 1000 }) })).toMatchObject({
      realSavingCents: 266, realSavingRatio: 266 / MARKET_LOW,
    })
  })
})

describe('priceVerdict cheaper sibling and hiding', () => {
  it('a cheaper sibling hides without any check', () => {
    expect(verdict({ check: null, item: item({ priceCents: 10_000 }), siblingPriceCents: 9000 })).toMatchObject({
      cheaperSibling: true, hidden: true,
    })
  })
  it('a sibling just above the threshold does not', () => {
    expect(verdict({ item: item({ priceCents: 10_000 }), siblingPriceCents: 9001 }).cheaperSibling).toBe(false)
  })
  it('Salvos are never hidden', () => {
    const saved = item({ finalCents: MARKET_LOW, priceCents: 10_000, status: STATUS_SAVED })
    expect(verdict({ item: saved, siblingPriceCents: 1 })).toMatchObject({ inflated: true, cheaperSibling: true, hidden: false })
  })
  it('Vistos are hidden like Novos', () => {
    expect(verdict({ item: item({ finalCents: MARKET_LOW, status: STATUS_SEEN }) }).hidden).toBe(true)
  })
})

describe('cheaperSiblingOf', () => {
  it('is true at exactly the threshold and false one centavo above', () => {
    const price = 10_000
    const edge = (price * SIBLING_CHEAPER_PERCENT) / PERCENT_BASE
    expect(cheaperSiblingOf(price, edge)).toBe(true)
    expect(cheaperSiblingOf(price, edge + 1)).toBe(false)
  })
  it('uses integer maths on odd prices', () => {
    expect(cheaperSiblingOf(1111, 999)).toBe(true)
    expect(cheaperSiblingOf(1111, 1000)).toBe(false)
  })
})

describe('priceVerdict on fixtures', () => {
  const inflatedOn = (fixture: string, title: string, finalCents: number) => {
    const cards: MarketCard[] = JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${fixture}.cards.json`), 'utf8'))
    const match = matchCandidates(title, finalCents, cards)
    const verdictCheck = check({ confidence: match.confidence, marketLowCents: match.marketLowCents })
    return priceVerdict({ check: verdictCheck, item: item({ finalCents }), siblingPriceCents: null, now }).inflated
  }

  it('the cable flags at R$ 20, with an offer at R$ 17,90', () => {
    expect(inflatedOn('cabo-tipo-c', 'Cabo Tipo-c Carregamento Turbo 1 Metro 60w Trançado', 2000)).toBe(true)
  })
  it('Veja and JBL do not flag at a price under the market', () => {
    expect(inflatedOn('veja-x14', 'Veja X14 Spray Tira Limo Cloro Ativo 500ml', 1201)).toBe(false)
    expect(inflatedOn('jbl-520bt', 'Fone JBL Tune 520BT', 20_000)).toBe(false)
  })
})
