import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matchCandidates } from './match'
import type { MarketCard } from '../market/types'
import { FIXTURE_EXPECTATIONS } from './match-labels'

function cardsOf(fixture: string): MarketCard[] {
  return JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${fixture}.cards.json`), 'utf8'))
}

describe('matchCandidates on long ML titles', () => {
  describe.each(FIXTURE_EXPECTATIONS)('$fixture', ({ fixture, title, finalCents, cards, high, medium, rejected }) => {
    const parsed = cardsOf(fixture)
    const confidenceAt = (index: number) => matchCandidates(title, finalCents, [parsed[index]]).confidence

    it('has the captured cards', () => {
      expect(parsed).toHaveLength(cards)
    })
    it.each(high)('card %i is high', (index) => {
      expect(confidenceAt(index)).toBe('high')
    })
    it.each(medium)('card %i is medium', (index) => {
      expect(confidenceAt(index)).toBe('medium')
    })
    it.each(rejected)('card %i is rejected', (index) => {
      expect(confidenceAt(index)).toBeNull()
    })
  })

  it('the VAIO page matches two stores and keeps the Windows, 8 GB and Ultra cards out', () => {
    const match = matchCandidates(FIXTURE_EXPECTATIONS[0].title, 436_900, cardsOf('vaio-fe16'))
    expect(match).toMatchObject({ confidence: 'high', marketLowCents: 666_548, marketStore: 'Fast Shop', secondLowCents: 759_900, storeCount: 2 })
    expect(match.offers.map((offer) => offer.priceCents)).toEqual([759_900, 666_548])
  })

  it('the Kindle query found nothing', () => {
    expect(cardsOf('kindle-16gb')).toEqual([])
  })
})
