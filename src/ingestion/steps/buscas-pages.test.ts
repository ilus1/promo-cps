import { describe, expect, it, vi } from 'vitest'
import { HOUR_MS } from '@/lib/constants'
import { holdStop, RunStop } from '../errors'
import type { ObservedCard } from '../ml/observed-card'
import type { LoadedPage } from '../ml/page-state'
import { SearchResultsMissing, type SearchPage } from '../ml/search-page'
import { MAX_CONSECUTIVE_LOAD_FAILURES, MAX_UNPARSED_PAGES_IN_ROW, type Loaded } from './breaker'
import { buscaSlackMs } from '../schedule'
import {
  BUSCA_STOP_LOG_TAG, dueBuscas, runBuscas, runDueBuscasWith, SEARCH_UNPARSED, type BuscaStatus, type BuscaTarget, type BuscasIo,
} from './buscas-pages'

const NOW = new Date('2026-11-02T12:00:00Z')
const BUDGET = 2
const READER_FAILURE = 'reader failure'
const searchUrl = (id: string, page = 1) => `https://lista.mercadolivre.com.br/${id}/${page}`
const card = (id: string) => ({ id }) as ObservedCard

const busca = (id: string, extra: Partial<BuscaTarget> = {}): BuscaTarget => ({
  id, kind: 'search', url: searchUrl(id), enabled: true, lastRunAt: null, runEveryHours: 3, ...extra,
})

type Answer = Loaded<SearchPage | ObservedCard | 'throws' | 'missing'>
const page = (nextUrl: string | null, ...ids: string[]): Answer => ({
  ok: true, value: { cards: ids.map(card), found: ids.length, dropped: 0, nextUrl },
})
const noCards: Answer = page(null)
const unparsed: Answer = { ok: true, value: { cards: [], found: 3, dropped: 3, nextUrl: null } }
const throwing: Answer = { ok: true, value: 'throws' }
const missing: Answer = { ok: true, value: 'missing' }
const broken: Answer = { ok: false, error: 'timeout' }
const product = (id: string): Answer => ({ ok: true, value: card(id) })

function fakeIo(answer: (url: string) => Answer) {
  const loads: string[] = []
  const recorded: { search: string; cards: string[] }[] = []
  const runs: { id: string; status: BuscaStatus; error: string | null }[] = []
  const itemCounts: number[] = []
  const readFor: string[] = []
  const stops: { id: string; status: string; error: string }[] = []
  const io: BuscasIo = {
    load: async (url) => {
      loads.push(url)
      const result = answer(url)
      if (!result.ok) return result
      return { ok: true, value: { finalUrl: url, pageProps: { answer: result.value } } as unknown as LoadedPage }
    },
    readSearch: (pageProps, searchUrl) => {
      readFor.push(searchUrl)
      const value = pageProps.answer
      if (value === 'throws') throw new Error(READER_FAILURE)
      if (value === 'missing') throw new SearchResultsMissing()
      return value as SearchPage
    },
    readProduct: (pageProps) => {
      const value = pageProps.answer
      if (value === 'throws') throw new Error(READER_FAILURE)
      return value as ObservedCard
    },
    record: async (cards, search) => {
      recorded.push({ search: search.id, cards: cards.map((c) => c.id) })
      return cards.map((c) => c.id)
    },
    recordRun: async (search, status, error, items) => {
      runs.push({ id: search.id, status, error })
      itemCounts.push(items)
    },
    recordStop: async (search, status, error) => {
      stops.push({ id: search.id, status, error })
    },
  }
  return { io, loads, recorded, runs, stops, readFor, itemCounts }
}

describe('dueBuscas', () => {
  it('keeps enabled Buscas that never ran or whose interval passed, most overdue first', () => {
    const overdue = busca('overdue', { lastRunAt: new Date(NOW.getTime() - 5 * HOUR_MS) })
    const never = busca('never')
    const exactly = busca('exactly', { lastRunAt: new Date(NOW.getTime() - 3 * HOUR_MS) })
    expect(dueBuscas([exactly, overdue, never], NOW).map((s) => s.id)).toEqual(['never', 'overdue', 'exactly'])
  })

  it('drops a disabled Busca, even one that never ran', () => {
    expect(dueBuscas([busca('off', { enabled: false })], NOW)).toEqual([])
  })

  it('drops a Busca that is not due yet', () => {
    expect(dueBuscas([busca('fresh', { lastRunAt: new Date(NOW.getTime() - HOUR_MS) })], NOW)).toEqual([])
  })

  it('is empty for no Buscas', () => expect(dueBuscas([], NOW)).toEqual([]))
})

describe('runBuscas search kind', () => {
  it('reads the budget of pages following the page own link and records every page', async () => {
    const f = fakeIo((url) => {
      if (url === searchUrl('a')) return page(searchUrl('a', 2), 'MLB1', 'MLB2')
      if (url === searchUrl('a', 2)) return page(searchUrl('a', 3), 'MLB3')
      return noCards
    })
    const result = await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.loads).toEqual([searchUrl('a'), searchUrl('a', 2)])
    expect(f.recorded).toEqual([{ search: 'a', cards: ['MLB1', 'MLB2'] }, { search: 'a', cards: ['MLB3'] }])
    expect(f.runs).toEqual([{ id: 'a', status: 'ok', error: null }])
    expect(result).toMatchObject({ read: 1, pages: 2, items: 3, failed: 0 })
  })

  it('hands the reader the Busca own url for every page', async () => {
    const f = fakeIo((url) => (url === searchUrl('a') ? page(searchUrl('a', 2), 'MLB1') : noCards))
    await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.readFor).toEqual([searchUrl('a'), searchUrl('a')])
  })

  it('stops at one page when the page has no next link', async () => {
    const f = fakeIo(() => page(null, 'MLB1'))
    const result = await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.loads).toHaveLength(1)
    expect(result.pages).toBe(1)
  })

  it('stops when the next link points back to the same page', async () => {
    const f = fakeIo((url) => page(url, 'MLB1'))
    await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.loads).toHaveLength(1)
  })

  it('reads one page for a budget of 1 and records nothing for a budget of 0', async () => {
    const one = fakeIo(() => page(searchUrl('a', 2), 'MLB1'))
    await runBuscas(one.io, [busca('a')], 1)
    expect(one.loads).toHaveLength(1)
    const none = fakeIo(() => page(null, 'MLB1'))
    const result = await runBuscas(none.io, [busca('a')], 0)
    expect(none.loads).toEqual([])
    expect(none.runs).toEqual([])
    expect(result).toMatchObject({ read: 0, outcomes: [] })
  })

  it('an empty result list is ok with no items', async () => {
    const f = fakeIo(() => noCards)
    const result = await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.runs).toEqual([{ id: 'a', status: 'ok', error: null }])
    expect(result).toMatchObject({ read: 1, items: 0, failed: 0, lastError: null })
  })

  it('a failed first load fails the Busca without reading page 2', async () => {
    const f = fakeIo(() => broken)
    const result = await runBuscas(f.io, [busca('a'), busca('b')], BUDGET)
    expect(f.loads).toEqual([searchUrl('a'), searchUrl('b')])
    expect(f.runs).toEqual([
      { id: 'a', status: 'failed', error: 'timeout' }, { id: 'b', status: 'failed', error: 'timeout' },
    ])
    expect(result).toMatchObject({ read: 2, failed: 2, lastError: 'timeout' })
  })

  it('a failed second load keeps page 1 and makes the Busca partial', async () => {
    const f = fakeIo((url) => (url === searchUrl('a') ? page(searchUrl('a', 2), 'MLB1') : broken))
    const result = await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.recorded).toEqual([{ search: 'a', cards: ['MLB1'] }])
    expect(f.runs).toEqual([{ id: 'a', status: 'partial', error: 'timeout' }])
    expect(result).toMatchObject({ items: 1, failed: 1 })
  })

  it('a failed second load after an empty first page is still partial', async () => {
    const f = fakeIo((url) => (url === searchUrl('a') ? page(searchUrl('a', 2)) : broken))
    await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.runs[0].status).toBe('partial')
  })

  it('a reader that throws fails the Busca and records nothing', async () => {
    const f = fakeIo(() => throwing)
    await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.recorded).toEqual([])
    expect(f.runs).toEqual([{ id: 'a', status: 'failed', error: READER_FAILURE }])
  })

  it('cards found but none readable is a reader failure and counts the dropped ones', async () => {
    const f = fakeIo(() => unparsed)
    const result = await runBuscas(f.io, [busca('a')], BUDGET)
    expect(f.runs).toEqual([{ id: 'a', status: 'failed', error: SEARCH_UNPARSED }])
    expect(result.droppedCards).toBe(3)
  })

  it('counts each item once across Buscas', async () => {
    const f = fakeIo(() => page(null, 'MLB1', 'MLB2'))
    const result = await runBuscas(f.io, [busca('a'), busca('b')], BUDGET)
    expect(result.items).toBe(2)
  })
})

describe('runBuscas product kind', () => {
  const productBusca = (id: string) => busca(id, { kind: 'product', url: `https://www.mercadolivre.com.br/${id}/p/MLB1` })

  it('reads one page and records one card whatever the budget', async () => {
    const f = fakeIo(() => product('MLB9'))
    const result = await runBuscas(f.io, [productBusca('p')], BUDGET)
    expect(f.loads).toEqual([productBusca('p').url])
    expect(f.recorded).toEqual([{ search: 'p', cards: ['MLB9'] }])
    expect(result).toMatchObject({ read: 1, pages: 1, items: 1, failed: 0 })
  })

  it('reads the product even with a budget of 0', async () => {
    const f = fakeIo(() => product('MLB9'))
    await runBuscas(f.io, [productBusca('p')], 0)
    expect(f.loads).toHaveLength(1)
  })

  it('a failed load or reader fails the Busca', async () => {
    const f = fakeIo((url) => (url.includes('/x/') ? broken : throwing))
    await runBuscas(f.io, [productBusca('x'), productBusca('y')], BUDGET)
    expect(f.runs).toEqual([
      { id: 'x', status: 'failed', error: 'timeout' }, { id: 'y', status: 'failed', error: READER_FAILURE },
    ])
  })
})

describe('runBuscas breakers', () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => busca(`b${i}`))

  it('stops reading after consecutive reader failures and leaves the rest untouched', async () => {
    const f = fakeIo(() => throwing)
    const result = await runBuscas(f.io, many(MAX_UNPARSED_PAGES_IN_ROW + 2), BUDGET)
    expect(f.loads).toHaveLength(MAX_UNPARSED_PAGES_IN_ROW)
    expect(f.runs).toHaveLength(MAX_UNPARSED_PAGES_IN_ROW)
    expect(result.read).toBe(MAX_UNPARSED_PAGES_IN_ROW)
  })

  it('a good Busca resets the reader failure streak', async () => {
    const f = fakeIo((url) => (url.includes('/good') ? noCards : throwing))
    const searches = [busca('b1'), busca('b2'), busca('good'), busca('b3'), busca('b4'), busca('b5'), busca('b6')]
    const result = await runBuscas(f.io, searches, BUDGET)
    expect(result.read).toBe(searches.length - 1)
  })

  it('failed loads do not trip the reader streak', async () => {
    const f = fakeIo(() => broken)
    const result = await runBuscas(f.io, many(MAX_CONSECUTIVE_LOAD_FAILURES + 2), BUDGET)
    expect(result.read).toBe(MAX_CONSECUTIVE_LOAD_FAILURES + 2)
  })

  it('a RunStop from a load propagates, keeping earlier Buscas and skipping the rest', async () => {
    const f = fakeIo(() => noCards)
    const stopping: BuscasIo = {
      ...f.io,
      load: async (url) => {
        if (url === searchUrl('b')) throw new RunStop('blocked', 'wall')
        return f.io.load(url)
      },
    }
    await expect(runBuscas(stopping, [busca('a'), busca('b'), busca('c')], BUDGET)).rejects.toMatchObject({ status: 'blocked' })
    expect(f.runs.map((r) => r.id)).toEqual(['a'])
    expect(f.loads).toEqual([searchUrl('a')])
    expect(f.stops).toEqual([{ id: 'b', status: 'blocked', error: 'wall' }])
  })

  it('a RunStop on page 2 keeps page 1 recorded and writes a stop, not a run, for the Busca', async () => {
    const f = fakeIo(() => page(searchUrl('a', 2), 'MLB1'))
    const stopping: BuscasIo = {
      ...f.io,
      load: async (url) => {
        if (url === searchUrl('a', 2)) throw new RunStop('session_expired', 'out')
        return f.io.load(url)
      },
    }
    await expect(runBuscas(stopping, [busca('a')], BUDGET)).rejects.toMatchObject({ status: 'session_expired' })
    expect(f.recorded).toEqual([{ search: 'a', cards: ['MLB1'] }])
    expect(f.runs).toEqual([])
    expect(f.stops).toEqual([{ id: 'a', status: 'session_expired', error: 'out' }])
  })

  it('a hold stop is not written as a Busca stop', async () => {
    const f = fakeIo(() => noCards)
    const held: BuscasIo = { ...f.io, load: async () => { throw holdStop({ kind: 'vpn', text: 't', reason: 'VPN conectada' }) } }
    await expect(runBuscas(held, [busca('a')], BUDGET)).rejects.toMatchObject({ status: 'partial', counts: { held: 1 } })
    expect(f.stops).toEqual([])
  })

  it('a recordStop that fails is logged redacted and the original RunStop still wins', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const f = fakeIo(() => noCards)
    const broken: BuscasIo = {
      ...f.io,
      load: async () => { throw new RunStop('session_expired', 'out') },
      recordStop: async () => { throw new Error('db down https://a.com/x?code=SECRET') },
    }
    await expect(runBuscas(broken, [busca('a')], BUDGET)).rejects.toMatchObject({ name: 'RunStop', status: 'session_expired' })
    expect(spy).toHaveBeenCalledWith(BUSCA_STOP_LOG_TAG, 'db down https://a.com/x')
    spy.mockRestore()
  })

  it('does nothing for no Buscas', async () => {
    const f = fakeIo(() => noCards)
    expect(await runBuscas(f.io, [], BUDGET)).toMatchObject({ read: 0, pages: 0, items: 0, failed: 0, outcomes: [] })
  })
})

describe('runBuscas disabled Busca', () => {
  it('reads a Busca it is handed even when disabled, since the caller chose it', async () => {
    const f = fakeIo(() => noCards)
    const result = await runBuscas(f.io, [busca('off', { enabled: false })], BUDGET)
    expect(f.loads).toEqual([searchUrl('off')])
    expect(result.read).toBe(1)
  })
})

describe('runDueBuscasWith', () => {
  it('reads only the Buscas that are enabled and due', async () => {
    const f = fakeIo(() => noCards)
    const searches = [
      busca('due'),
      busca('off', { enabled: false }),
      busca('fresh', { lastRunAt: new Date(NOW.getTime() - HOUR_MS) }),
    ]
    const result = await runDueBuscasWith(f.io, searches, NOW, BUDGET, 3)
    expect(f.loads).toEqual([searchUrl('due')])
    expect(result.outcomes).toEqual([{ id: 'due', status: 'ok', error: null }])
  })
})

describe('a Busca without results in the page state', () => {
  it('on page 1 is an empty read: ok, no failure, no reader streak', async () => {
    const { io, runs, loads } = fakeIo(() => missing)
    const many = Array.from({ length: MAX_UNPARSED_PAGES_IN_ROW + 2 }, (_, i) => busca(`b${i}`))
    const result = await runBuscas(io, many, BUDGET)
    expect(loads).toHaveLength(many.length)
    expect(runs.every((run) => run.status === 'ok' && run.error === null)).toBe(true)
    expect(result).toMatchObject({ read: many.length, empty: many.length, failed: 0, items: 0, lastError: null })
  })

  it('on page 2 means the results ended: ok, keeps page 1 items, not empty', async () => {
    const { io, runs } = fakeIo((url) => (url === searchUrl('a') ? page(searchUrl('a', 2), 'x') : missing))
    const result = await runBuscas(io, [busca('a')], BUDGET)
    expect(runs).toEqual([{ id: 'a', status: 'ok', error: null }])
    expect(result).toMatchObject({ items: 1, empty: 0, failed: 0, pages: 2 })
  })

  it('a results array with no parsable cards is still a failure', async () => {
    const { io, runs } = fakeIo(() => unparsed)
    const result = await runBuscas(io, [busca('a')], BUDGET)
    expect(runs[0]).toMatchObject({ status: 'failed', error: SEARCH_UNPARSED })
    expect(result).toMatchObject({ failed: 1, empty: 0 })
  })
})

describe('an empty results array on page 1', () => {
  it('is an empty read too, and the item count is recorded', async () => {
    const { io, itemCounts } = fakeIo(() => noCards)
    const result = await runBuscas(io, [busca('a')], BUDGET)
    expect(result).toMatchObject({ empty: 1, failed: 0 })
    expect(itemCounts).toEqual([0])
  })

  it('a page 2 with an empty results array is not counted empty', async () => {
    const { io, itemCounts } = fakeIo((url) => (url === searchUrl('a') ? page(searchUrl('a', 2), 'x') : noCards))
    const result = await runBuscas(io, [busca('a')], BUDGET)
    expect(result).toMatchObject({ empty: 0, items: 1 })
    expect(itemCounts).toEqual([1])
  })
})

describe('dueBuscas with slack', () => {
  const CYCLE_HOURS = 3
  const slack = (hours: number) => buscaSlackMs(CYCLE_HOURS, hours)
  const comesDueIn = (afterNowMs: number, hours = 3) => new Date(NOW.getTime() + afterNowMs - hours * HOUR_MS)

  it('takes a Busca that comes due within its slack, not one past it', () => {
    const inside = busca('inside', { lastRunAt: comesDueIn(slack(3)) })
    const outside = busca('outside', { lastRunAt: comesDueIn(slack(3) + 1) })
    expect(dueBuscas([inside, outside], NOW, CYCLE_HOURS).map((s) => s.id)).toEqual(['inside'])
    expect(dueBuscas([inside, outside], NOW)).toEqual([])
  })

  it('a 1 h Busca has a short slack, a 24 h one the long one', () => {
    const hourly = busca('hourly', { runEveryHours: 1, lastRunAt: comesDueIn(slack(1) + 1, 1) })
    const daily = busca('daily', { runEveryHours: 24, lastRunAt: comesDueIn(slack(24), 24) })
    expect(dueBuscas([hourly, daily], NOW, CYCLE_HOURS).map((s) => s.id)).toEqual(['daily'])
  })

  it('the cycle step uses the slack', async () => {
    const { io, loads } = fakeIo(() => page(null, 'x'))
    await runDueBuscasWith(io, [busca('soon', { lastRunAt: comesDueIn(slack(3)) })], NOW, BUDGET, CYCLE_HOURS)
    expect(loads).toHaveLength(1)
  })
})
