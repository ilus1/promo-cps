import { describe, expect, it } from 'vitest'
import { RunStop } from '../errors'
import { ListingResultsMissing, type ListingCards } from '../ml/cards'
import type { ObservedCard } from '../ml/observed-card'
import type { LoadedPage } from '../ml/page-state'
import { MAX_LISTING_FAILURES_IN_ROW, MAX_UNPARSED_PAGES_IN_ROW, type Loaded } from './breaker'
import {
  discoverListings, groupByListing, LISTING_REDIRECTED, LISTING_UNPARSED, LISTING_WITHOUT_CARDS,
  type DiscoverIo, type ListingTarget,
} from './discover-pages'

const PARSER_FAILURE = 'parser failure'
const STORE_PAGE = 'https://lista.mercadolivre.com.br/pagina/store'
const urlOf = (n: number) => `https://ml.test/listing-${n}`
const couponUrlOf = (id: string) => `https://ml.test/listing?coupon_campaign_id=${id}`
const target = (campaignId: string, n: number): ListingTarget => ({ campaignId, listingUrl: urlOf(n) })
const card = (id: string) => ({ id }) as ObservedCard

type Answer = Loaded<{ read?: ListingCards; finalUrl?: string; missing?: boolean }>
const good = (...ids: string[]): Answer => ({ ok: true, value: { read: { cards: ids.map(card), found: ids.length, dropped: 0 } } })
const withDropped = (dropped: number, ...ids: string[]): Answer => ({
  ok: true, value: { read: { cards: ids.map(card), found: ids.length + dropped, dropped } },
})
const noCards: Answer = { ok: true, value: { read: { cards: [], found: 0, dropped: 0 } } }
const unparsed: Answer = { ok: true, value: { read: { cards: [], found: 2, dropped: 2 } } }
const throwing: Answer = { ok: true, value: {} }
const missing: Answer = { ok: true, value: { missing: true } }
const broken: Answer = { ok: false, error: 'timeout' }
const landedAt = (finalUrl: string, ...ids: string[]): Answer => {
  const answer = good(...ids)
  return answer.ok ? { ok: true, value: { ...answer.value, finalUrl } } : answer
}

function fakeIo(answer: (url: string) => Answer) {
  const loads: string[] = []
  const recorded: { cards: string[]; coupons: string[] }[] = []
  const attempts: { ids: string[]; succeeded: boolean }[] = []
  const io: DiscoverIo<ListingTarget> = {
    load: async (url) => {
      loads.push(url)
      const result = answer(url)
      if (!result.ok) return result
      return { ok: true, value: { finalUrl: result.value.finalUrl ?? url, pageProps: { read: result.value.read, missing: result.value.missing } } as LoadedPage }
    },
    parse: (pageProps) => {
      if (pageProps.missing) throw new ListingResultsMissing()
      if (!pageProps.read) throw new Error(PARSER_FAILURE)
      return pageProps.read as ListingCards
    },
    record: async (cards, coupons) => {
      recorded.push({ cards: cards.map((c) => c.id), coupons: coupons.map((c) => c.campaignId) })
      return cards.map((c) => c.id)
    },
    linkCount: (cards, coupons) => cards.length * coupons.length,
    markAttempt: async (ids, succeeded) => {
      attempts.push({ ids, succeeded })
    },
  }
  return { io, loads, recorded, attempts }
}

const targetsOf = (count: number) => Array.from({ length: count }, (_, i) => target(`c${i}`, i))

describe('groupByListing', () => {
  it('groups coupons sharing a url, keeping first-seen order', () => {
    const groups = groupByListing([target('a', 1), target('b', 2), target('c', 1)])
    expect([...groups.keys()]).toEqual([urlOf(1), urlOf(2)])
    expect(groups.get(urlOf(1))?.map((c) => c.campaignId)).toEqual(['a', 'c'])
  })

  it('is empty for no targets', () => {
    expect(groupByListing([]).size).toBe(0)
  })
})

describe('discoverListings', () => {
  it('loads each distinct url once and links all its coupons', async () => {
    const { io, loads, recorded, attempts } = fakeIo(() => good('x', 'y'))
    const result = await discoverListings(io, [target('a', 1), target('b', 1), target('c', 2)], 10)
    expect(loads).toEqual([urlOf(1), urlOf(2)])
    expect(recorded[0]).toEqual({ cards: ['x', 'y'], coupons: ['a', 'b'] })
    expect(attempts).toEqual([{ ids: ['a', 'b'], succeeded: true }, { ids: ['c'], succeeded: true }])
    expect(result).toMatchObject({ pages: 2, items: 2, failed: 0, droppedCards: 0, lastError: null })
    expect(result.itemIds).toEqual(['x', 'y'])
  })

  it('sums the cards that did not parse', async () => {
    const { io } = fakeIo(() => withDropped(2, 'x'))
    const result = await discoverListings(io, targetsOf(2), 10)
    expect(result.droppedCards).toBe(4)
  })

  it('stops loading when the page budget is spent, counting failed pages', async () => {
    const { io, loads } = fakeIo((url) => (url === urlOf(1) ? broken : good('x')))
    const result = await discoverListings(io, [target('a', 1), target('b', 2), target('c', 3)], 2)
    expect(loads).toEqual([urlOf(1), urlOf(2)])
    expect(result).toMatchObject({ pages: 2, failed: 1, lastError: 'timeout' })
  })

  it('loads nothing with a zero budget', async () => {
    const { io, loads, attempts } = fakeIo(() => good('x'))
    const result = await discoverListings(io, [target('a', 1)], 0)
    expect(loads).toEqual([])
    expect(attempts).toEqual([])
    expect(result).toEqual({
      pages: 0, read: 0, items: 0, failed: 0, empty: 0, couponLinks: 0, cards: 0, basisOther: 0, droppedCards: 0, itemIds: [], lastError: null,
    })
  })

  it('does nothing for empty targets', async () => {
    const { io, loads } = fakeIo(() => good('x'))
    const result = await discoverListings(io, [], 5)
    expect(loads).toEqual([])
    expect(result.pages).toBe(0)
  })

  it('marks a failed load as attempted but not discovered', async () => {
    const { io, recorded, attempts } = fakeIo(() => broken)
    await discoverListings(io, [target('a', 1)], 5)
    expect(recorded).toEqual([])
    expect(attempts).toEqual([{ ids: ['a'], succeeded: false }])
  })

  it('counts a listing without results in the page state as empty, not failed, and still marks the attempt', async () => {
    const { io, recorded, attempts } = fakeIo((url) => (url === urlOf(1) ? missing : good('x')))
    const result = await discoverListings(io, [target('a', 1), target('b', 2)], 5)
    expect(recorded).toHaveLength(1)
    expect(attempts).toEqual([{ ids: ['a'], succeeded: false }, { ids: ['b'], succeeded: true }])
    expect(result).toMatchObject({ pages: 2, read: 1, empty: 1, failed: 0, lastError: null })
  })

  it('counts links and basis other over the pages read', async () => {
    const other = { id: 'o', basis: 'other' } as ObservedCard
    const { io } = fakeIo(() => ({ ok: true, value: { read: { cards: [other, card('p')], found: 2, dropped: 0 } } }))
    const result = await discoverListings(io, [target('a', 1), target('b', 2)], 5)
    expect(result).toMatchObject({ read: 2, couponLinks: 4, cards: 4, basisOther: 2 })
  })

  it('treats a listing with no cards as failed, never discovered', async () => {
    const { io, recorded, attempts } = fakeIo(() => noCards)
    const result = await discoverListings(io, [target('a', 1)], 5)
    expect(recorded).toEqual([])
    expect(attempts).toEqual([{ ids: ['a'], succeeded: false }])
    expect(result).toMatchObject({ failed: 1, lastError: `${LISTING_WITHOUT_CARDS}: ${urlOf(1)}` })
  })

  it('treats polycards that all failed to parse as a reader failure', async () => {
    const { io, recorded } = fakeIo(() => unparsed)
    const result = await discoverListings(io, [target('a', 1)], 5)
    expect(recorded).toEqual([])
    expect(result.droppedCards).toBe(2)
    expect(result.lastError).toBe(`${LISTING_UNPARSED}: ${urlOf(1)}`)
  })

  it('counts a parser exception as a failed page, not a thrown error', async () => {
    const { io, attempts } = fakeIo(() => throwing)
    const result = await discoverListings(io, [target('a', 1)], 5)
    expect(result).toMatchObject({ failed: 1, lastError: PARSER_FAILURE })
    expect(attempts).toEqual([{ ids: ['a'], succeeded: false }])
  })

  it('treats a listing redirected away from its coupon as failed', async () => {
    const { io, recorded, attempts } = fakeIo(() => landedAt(couponUrlOf('other'), 'x'))
    const result = await discoverListings(io, [{ campaignId: 'a', listingUrl: couponUrlOf('a') }], 5)
    expect(recorded).toEqual([])
    expect(attempts).toEqual([{ ids: ['a'], succeeded: false }])
    expect(result.lastError).toBe(`${LISTING_REDIRECTED}: ${couponUrlOf('a')}`)
  })

  it('records a store listing redirected to the store page', async () => {
    const storeListing = 'https://lista.mercadolivre.com.br/_CustId_5_X?coupon_campaign_id=a'
    const { io, recorded, attempts } = fakeIo(() => landedAt(STORE_PAGE, 'x'))
    await discoverListings(io, [{ campaignId: 'a', listingUrl: storeListing }], 5)
    expect(recorded).toEqual([{ cards: ['x'], coupons: ['a'] }])
    expect(attempts).toEqual([{ ids: ['a'], succeeded: true }])
  })

  it('ends the step after reader failures in a row', async () => {
    const { io, loads } = fakeIo(() => throwing)
    const result = await discoverListings(io, targetsOf(MAX_UNPARSED_PAGES_IN_ROW + 2), 100)
    expect(loads).toHaveLength(MAX_UNPARSED_PAGES_IN_ROW)
    expect(result.failed).toBe(MAX_UNPARSED_PAGES_IN_ROW)
  })

  it('resets the reader streak after a good page', async () => {
    const answers = [throwing, throwing, good('x'), throwing, throwing, good('y')]
    const { io, loads } = fakeIo((url) => answers[Number(url.split('-')[1])])
    const result = await discoverListings(io, targetsOf(answers.length), 100)
    expect(loads).toHaveLength(answers.length)
    expect(result).toMatchObject({ pages: 6, failed: 4, items: 2 })
  })

  it('ends the step after empty listings in a row', async () => {
    const { io, loads } = fakeIo(() => missing)
    const result = await discoverListings(io, targetsOf(MAX_UNPARSED_PAGES_IN_ROW + 2), 100)
    expect(loads).toHaveLength(MAX_UNPARSED_PAGES_IN_ROW)
    expect(result).toMatchObject({ empty: MAX_UNPARSED_PAGES_IN_ROW, failed: 0 })
  })

  it('tolerates listings with no cards up to the listing failure limit', async () => {
    const { io, loads } = fakeIo(() => noCards)
    await discoverListings(io, targetsOf(MAX_LISTING_FAILURES_IN_ROW + 5), 100)
    expect(loads).toHaveLength(MAX_LISTING_FAILURES_IN_ROW)
  })

  it('keeps the two streaks apart and resets both on a good page', async () => {
    const lastBeforeStop = MAX_LISTING_FAILURES_IN_ROW - 1
    const answers = [
      ...Array.from({ length: lastBeforeStop }, () => noCards),
      throwing, throwing,
      good('x'),
      ...Array.from({ length: lastBeforeStop }, () => noCards),
      good('y'),
    ]
    const { io, loads } = fakeIo((url) => answers[Number(url.split('-')[1])])
    const result = await discoverListings(io, targetsOf(answers.length), 100)
    expect(loads).toHaveLength(answers.length)
    expect(result.items).toBe(2)
  })

  it('marks the attempt failed and rethrows when recording throws', async () => {
    const { io, attempts } = fakeIo(() => good('x'))
    io.record = async () => {
      throw new Error('db down')
    }
    await expect(discoverListings(io, [target('a', 1)], 5)).rejects.toThrow('db down')
    expect(attempts).toEqual([{ ids: ['a'], succeeded: false }])
  })

  it('propagates a RunStop and does not mark the stopped page', async () => {
    const { io, attempts } = fakeIo((url) => {
      if (url === urlOf(2)) throw new RunStop('blocked', 'wall')
      return good('x')
    })
    await expect(discoverListings(io, [target('a', 1), target('b', 2)], 5)).rejects.toBeInstanceOf(RunStop)
    expect(attempts).toEqual([{ ids: ['a'], succeeded: true }])
  })
})
