import { describe, expect, test, vi } from 'vitest'
import type { CandidateOffer } from '@/db/market-offers'
import type { PriceCheckRow } from '@/db/price-checks'
import { retrievalTerms } from '@/lib/market/tokens'
import { compareQuery } from '@/lib/price-compare/clean-title'
import type { CheckItem } from '@/lib/price-check-rules'
import { matchItemLocally, offerCard, storeName, type LocalMatchDeps } from './match-local'

vi.mock('@/db/client', () => ({ db: {} }))

const NOW = new Date('2026-11-04T12:00:00Z')
const TITLE = 'Samsung Galaxy A55 5G 256gb'
const item: CheckItem = { id: 'MLB10', productId: 'MLB99', title: TITLE, finalCents: 200000, showsSaving: true }

const offer = (over: Partial<CandidateOffer>): CandidateOffer => ({
  retailer: 'kabum', title: 'Samsung Galaxy A55 5G 256GB 8GB RAM', brand: 'Samsung', seller: 'KaBuM!', priceCents: 180000, url: 'https://www.kabum.com.br/produto/1/a55',
  ...over,
})

function harness(offers: CandidateOffer[]) {
  const saved: PriceCheckRow[] = []
  const deps: LocalMatchDeps = {
    candidates: vi.fn(async () => offers),
    save: vi.fn(async (row: PriceCheckRow) => {
      saved.push(row)
    }),
  }
  return { deps, saved }
}

describe('storeName', () => {
  test('a Kabum offer names a marketplace seller, but not Kabum itself', () => {
    expect(storeName({ retailer: 'kabum', seller: 'KaBuM!' })).toBe('Kabum')
    expect(storeName({ retailer: 'kabum', seller: ' kabum! ' })).toBe('Kabum')
    expect(storeName({ retailer: 'kabum', seller: 'Magalu' })).toBe('Kabum (Magalu)')
    expect(storeName({ retailer: 'kabum', seller: null })).toBe('Kabum')
    expect(storeName({ retailer: 'kabum', seller: '  ' })).toBe('Kabum')
  })

  test('an Amazon offer is just Amazon', () => {
    expect(storeName({ retailer: 'amazon', seller: 'Loja X' })).toBe('Amazon')
    expect(storeName({ retailer: 'amazon', seller: null })).toBe('Amazon')
  })
})

test('a card is one store, with the offer title, brand, price and link', () => {
  expect(offerCard(offer({ seller: 'Magalu' }))).toEqual({
    name: 'Samsung Galaxy A55 5G 256GB 8GB RAM', brand: 'Samsung', priceCents: 180000, store: 'Kabum (Magalu)', storeCount: 1, url: 'https://www.kabum.com.br/produto/1/a55',
  })
})

test('an Amazon card carries no brand', () => {
  expect(offerCard(offer({ retailer: 'amazon', brand: null, seller: null })).brand).toBeNull()
})

test('a match saves the cheapest equivalent with its link, the second store and the compare query', async () => {
  const { deps, saved } = harness([
    offer({ title: 'Capa Samsung Galaxy A55', priceCents: 3000, url: 'https://capa' }),
    offer({ seller: 'Magalu', url: 'https://www.kabum.com.br/produto/2/a55' }),
    offer({ retailer: 'amazon', seller: null, priceCents: 185000, url: 'https://www.amazon.com.br/dp/B0A55' }),
  ])
  expect(await matchItemLocally(item, NOW, deps)).toBe('matched')
  expect(deps.candidates).toHaveBeenCalledWith(retrievalTerms(TITLE), item.finalCents, NOW)
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({
    key: 'MLB99',
    itemId: 'MLB10',
    checkedAt: NOW,
    status: 'matched',
    confidence: 'high',
    query: compareQuery(TITLE),
    mlPriceCents: 200000,
    marketLowCents: 180000,
    marketStore: 'Kabum (Magalu)',
    secondLowCents: 185000,
    storeCount: 2,
    sourceUrl: 'https://www.kabum.com.br/produto/2/a55',
    reason: null,
  })
  expect(saved[0].offers).toEqual([
    { store: 'Kabum (Magalu)', priceCents: 180000, name: 'Samsung Galaxy A55 5G 256GB 8GB RAM' },
    { store: 'Amazon', priceCents: 185000, name: 'Samsung Galaxy A55 5G 256GB 8GB RAM' },
  ])
})

test('without an equivalent the row is no_match with no link and no offers', async () => {
  const { deps, saved } = harness([offer({ title: 'Capa Samsung Galaxy A55', priceCents: 3000 })])
  expect(await matchItemLocally(item, NOW, deps)).toBe('no_match')
  expect(saved[0]).toMatchObject({
    key: 'MLB99', status: 'no_match', confidence: null, marketLowCents: null, secondLowCents: null, marketStore: null, storeCount: null, offers: [], sourceUrl: '', query: compareQuery(TITLE),
  })
})

test('a title with no retrieval terms saves no_match without reading candidates', async () => {
  const empty: CheckItem = { ...item, productId: null, title: '' }
  expect(retrievalTerms(empty.title)).toEqual({ all: [], any: [] })
  const { deps, saved } = harness([offer({})])
  expect(await matchItemLocally(empty, NOW, deps)).toBe('no_match')
  expect(deps.candidates).not.toHaveBeenCalled()
  expect(saved[0]).toMatchObject({ key: 'item:MLB10', status: 'no_match', sourceUrl: '' })
})
