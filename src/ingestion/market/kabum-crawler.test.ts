import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { CrawlerStateRow } from '@/db/crawler-state'
import {
  DAY_MS, HOLD_RECHECK_MS, KABUM_DEPARTMENTS, KABUM_MAX_PAGES, KABUM_PAGE_INTERVAL_MS, KABUM_PAGE_JITTER_MS, KABUM_PASS_DAYS,
  MARKET_IDLE_RECHECK_MS, MINUTE_MS, SECOND_MS,
} from '@/lib/constants'
import { kabumListingUrl, kabumSitemapIndexUrl } from '@/lib/market/parse-kabum'
import type { FetchedPage } from './crawl-page'
import { IDLE_KABUM_CURSOR, kabumCursorOf, kabumStep, type KabumCursor, type KabumDeps } from './kabum-crawler'

const NOW = new Date('2026-11-04T12:00:00Z')
const PAGE_PAUSE_MS = KABUM_PAGE_INTERVAL_MS + Math.floor(0.5 * KABUM_PAGE_JITTER_MS)
const SITEMAP = readFileSync(join(__dirname, '..', '..', 'lib', 'market', '__fixtures__', 'kabum-sitemap-index.xml'), 'utf8')
const HOLD = { kind: 'vpn', text: 'VPN da empresa conectada: desconecte para rodar', reason: 'VPN conectada' } as const
const NOT_FOUND: FetchedPage = { status: 404, html: '' }

function product(code: number) {
  return { code, name: `Fone JBL Tune ${code}`, friendlyName: `fone-${code}`, price: 299.9, priceWithDiscount: 269.91, available: true }
}

function listing(page: number, totalPages: number, products: unknown[] = [product(page)]): FetchedPage {
  const data = JSON.stringify({ catalogServer: { meta: { totalItemsCount: totalPages * 60, totalPagesCount: totalPages, page: { number: page } }, data: products } })
  return { status: 200, html: `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data } } })}</script>` }
}

const UNKNOWN_PAGE: FetchedPage = { status: 200, html: '<html><body>manutenção</body></html>' }

function stateRow(over: Partial<CrawlerStateRow> = {}): CrawlerStateRow {
  return {
    site: 'kabum', cursor: {}, backoffLevel: 0, blockedUntil: null, dayKey: null, pagesToday: 0, lastPageAt: null,
    passStartedAt: null, bestsellersAt: null, lastError: null, updatedAt: NOW, ...over,
  }
}

function inPass(departments: string[], over: Partial<KabumCursor> = {}): Record<string, unknown> {
  return { departments, index: 0, page: 1, totalPages: 0, unknownStreak: 0, ...over }
}

function harness(row: CrawlerStateRow, pages: Record<string, FetchedPage> = {}) {
  let current = row
  let clock = NOW.getTime()
  const deps: KabumDeps = {
    now: () => new Date(clock),
    hold: vi.fn(async () => null),
    load: vi.fn(async () => current),
    save: vi.fn(async (patch) => {
      current = { ...current, ...patch } as CrawlerStateRow
    }),
    fetch: vi.fn(async (url: string) => pages[url] ?? NOT_FOUND),
    upsert: vi.fn(async (offers) => offers.length),
    rematch: vi.fn(),
    random: () => 0.5,
    log: vi.fn(),
  }
  const step = async () => {
    const next = await kabumStep(deps)
    clock += next.sleepMs
    return next
  }
  return { deps, step, state: () => current, cursor: () => kabumCursorOf(current.cursor) }
}

describe('kabumStep waits', () => {
  test('a hold of any kind waits a minute without reading the state or fetching', async () => {
    for (const kind of ['vpn', 'manual', 'price_manual'] as const) {
      const { deps } = harness(stateRow({ cursor: inPass(['audio']) }))
      vi.mocked(deps.hold).mockResolvedValue({ ...HOLD, kind })
      expect(await kabumStep(deps)).toEqual({ sleepMs: HOLD_RECHECK_MS, waitingFor: null })
      expect(deps.load).not.toHaveBeenCalled()
      expect(deps.fetch).not.toHaveBeenCalled()
      expect(deps.save).not.toHaveBeenCalled()
    }
  })

  test('a block waits until it ends, rechecking at least every ten minutes, and fetches nothing', async () => {
    const soon = harness(stateRow({ blockedUntil: new Date(NOW.getTime() + 5 * MINUTE_MS), cursor: inPass(['audio']) }))
    expect(await kabumStep(soon.deps)).toEqual({ sleepMs: 5 * MINUTE_MS, waitingFor: null })
    const later = harness(stateRow({ blockedUntil: new Date(NOW.getTime() + DAY_MS), cursor: inPass(['audio']) }))
    expect(await kabumStep(later.deps)).toEqual({ sleepMs: MARKET_IDLE_RECHECK_MS, waitingFor: null })
    expect(soon.deps.fetch).not.toHaveBeenCalled()
    expect(later.deps.fetch).not.toHaveBeenCalled()
  })

  test('a page is never fetched sooner than the interval after the last one', async () => {
    const { deps } = harness(stateRow({ lastPageAt: new Date(NOW.getTime() - 3 * SECOND_MS), cursor: inPass(['audio']) }))
    expect(await kabumStep(deps)).toEqual({ sleepMs: KABUM_PAGE_INTERVAL_MS - 3 * SECOND_MS, waitingFor: null })
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  test('between passes it waits for the next pass, three days after the last one started', async () => {
    const { deps } = harness(stateRow({ passStartedAt: new Date(NOW.getTime() - DAY_MS) }))
    expect(await kabumStep(deps)).toEqual({ sleepMs: MARKET_IDLE_RECHECK_MS, waitingFor: 'next_pass' })
    expect(deps.fetch).not.toHaveBeenCalled()
  })
})

describe('kabumStep pass start', () => {
  test('a due pass reads the sitemap index once and stores its departments in the cursor', async () => {
    const { deps, state, cursor } = harness(stateRow({ passStartedAt: new Date(NOW.getTime() - KABUM_PASS_DAYS * DAY_MS) }), {
      [kabumSitemapIndexUrl()]: { status: 200, html: SITEMAP },
    })
    expect(await kabumStep(deps)).toEqual({ sleepMs: PAGE_PAUSE_MS, waitingFor: null })
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(deps.fetch).toHaveBeenCalledWith(kabumSitemapIndexUrl())
    expect(cursor()).toEqual({ departments: [...KABUM_DEPARTMENTS], index: 0, page: 1, totalPages: 0, unknownStreak: 0 })
    expect(state()).toMatchObject({ passStartedAt: NOW, lastPageAt: NOW, pagesToday: 1, dayKey: '2026-11-04', backoffLevel: 0 })
    expect(deps.log).toHaveBeenCalledWith(`[market] kabum: pass started with ${KABUM_DEPARTMENTS.length} departments (sitemap)`)
  })

  test('an unreadable index falls back to the fixed list and still starts the pass', async () => {
    for (const fetched of [NOT_FOUND, { status: 500, html: '' }, { status: 200, html: '<sitemapindex></sitemapindex>' }]) {
      const { deps, cursor, state } = harness(stateRow(), { [kabumSitemapIndexUrl()]: fetched })
      await kabumStep(deps)
      expect(cursor().departments).toEqual([...KABUM_DEPARTMENTS])
      expect(state().passStartedAt).toEqual(NOW)
      expect(vi.mocked(deps.log).mock.calls[0][0]).toMatch(/\(fallback list, /)
    }
  })

  test('a wall on the index starts no pass and backs off', async () => {
    const { deps, cursor, state } = harness(stateRow(), { [kabumSitemapIndexUrl()]: { status: 403, html: '' } })
    await kabumStep(deps)
    expect(cursor()).toEqual(IDLE_KABUM_CURSOR)
    expect(state()).toMatchObject({ passStartedAt: null, backoffLevel: 1, blockedUntil: new Date(NOW.getTime() + 15 * MINUTE_MS), lastError: 'HTTP 403' })
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: blocked until 2026-11-04T12:15:00.000Z (HTTP 403)')
  })
})

describe('kabumStep department pages', () => {
  test('results are upserted and the cursor advances a page, then to the next department, asking for a rematch', async () => {
    const { deps, step, cursor } = harness(stateRow({ cursor: inPass(['audio', 'tv']) }), {
      [kabumListingUrl('audio', 1)]: listing(1, 2),
      [kabumListingUrl('audio', 2)]: listing(2, 2),
    })
    await step()
    expect(deps.fetch).toHaveBeenLastCalledWith(kabumListingUrl('audio', 1))
    expect(vi.mocked(deps.upsert).mock.calls[0][0]).toHaveLength(1)
    expect(cursor()).toMatchObject({ index: 0, page: 2, totalPages: 2 })
    expect(deps.rematch).not.toHaveBeenCalled()
    await step()
    expect(cursor()).toMatchObject({ index: 1, page: 1, totalPages: 0 })
    expect(deps.rematch).toHaveBeenCalledTimes(1)
  })

  test('offers that always fail to save make the page unknown, so the crawl moves on with the reason in the last error', async () => {
    const pages = Object.fromEntries([2, 3].map((page) => [kabumListingUrl('audio', page), listing(page, 4)]))
    const { deps, step, state, cursor } = harness(stateRow({ dayKey: '2026-11-04', pagesToday: 7, cursor: inPass(['audio'], { page: 2, totalPages: 4 }) }), pages)
    const failure = new Error('Failed query: insert into "market_offers"', { cause: Object.assign(new Error('integer out of range'), { code: '22003' }) })
    vi.mocked(deps.upsert).mockRejectedValue(failure)
    await step()
    expect(cursor()).toMatchObject({ page: 3, unknownStreak: 1 })
    expect(state()).toMatchObject({ pagesToday: 8, lastPageAt: NOW, lastError: 'falha ao gravar: integer out of range (22003)' })
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: skipped audio page 2 (falha ao gravar: integer out of range (22003))')
    await step()
    expect(vi.mocked(deps.fetch).mock.calls.map(([url]) => url)).toEqual([kabumListingUrl('audio', 2), kabumListingUrl('audio', 3)])
    expect(cursor()).toMatchObject({ page: 4, unknownStreak: 2 })
  })

  test('a first page whose offers fail to save keeps its department, using the page count it read', async () => {
    const { deps, cursor } = harness(stateRow({ cursor: inPass(['audio', 'tv']) }), { [kabumListingUrl('audio', 1)]: listing(1, 6) })
    vi.mocked(deps.upsert).mockRejectedValue(new Error('invalid byte sequence'))
    await kabumStep(deps)
    expect(cursor()).toMatchObject({ index: 0, page: 2, totalPages: 6 })
  })

  test('a database outage fails the step before any write, so the page is retried after the error backoff', async () => {
    const { deps, cursor } = harness(stateRow({ cursor: inPass(['audio'], { page: 2, totalPages: 3 }) }), {
      [kabumListingUrl('audio', 2)]: listing(2, 3),
    })
    vi.mocked(deps.save).mockRejectedValue(new Error('connection refused'))
    vi.mocked(deps.upsert).mockRejectedValue(new Error('connection refused'))
    await expect(kabumStep(deps)).rejects.toThrow('connection refused')
    expect(deps.upsert).not.toHaveBeenCalled()
    expect(cursor()).toMatchObject({ page: 2 })
  })

  test('a department is read up to the page cap', async () => {
    const { step, cursor } = harness(stateRow({ cursor: inPass(['hardware', 'tv'], { page: KABUM_MAX_PAGES, totalPages: KABUM_MAX_PAGES }) }), {
      [kabumListingUrl('hardware', KABUM_MAX_PAGES)]: listing(KABUM_MAX_PAGES, 999),
    })
    await step()
    expect(cursor()).toMatchObject({ index: 1, page: 1 })
  })

  test('a missing or empty department is skipped once with a log, with no rematch and no backoff', async () => {
    const { deps, step, cursor, state } = harness(stateRow({ cursor: inPass(['games', 'moda', 'tv']) }), {
      [kabumListingUrl('moda', 1)]: listing(1, 1, []),
    })
    await step()
    await step()
    expect(cursor()).toMatchObject({ index: 2, page: 1 })
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: skipped games (HTTP 404)')
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: skipped moda (sem produtos)')
    expect(deps.rematch).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ backoffLevel: 0, blockedUntil: null, lastError: null, pagesToday: 2 })
  })

  test('a department that ends early after some pages still asks for a rematch', async () => {
    const { deps, step, cursor } = harness(stateRow({ cursor: inPass(['audio', 'tv'], { page: 3, totalPages: 5 }) }), {
      [kabumListingUrl('audio', 3)]: listing(3, 3, []),
    })
    await step()
    expect(cursor()).toMatchObject({ index: 1, page: 1 })
    expect(deps.rematch).toHaveBeenCalledTimes(1)
  })

  test('a wall keeps the page, backs off one step further each time and records the reason', async () => {
    const { deps, cursor, state } = harness(stateRow({ backoffLevel: 1, cursor: inPass(['audio'], { page: 4, totalPages: 9 }) }), {
      [kabumListingUrl('audio', 4)]: { status: 429, html: '' },
    })
    await kabumStep(deps)
    expect(cursor()).toMatchObject({ index: 0, page: 4, totalPages: 9 })
    expect(state()).toMatchObject({ backoffLevel: 2, blockedUntil: new Date(NOW.getTime() + 60 * MINUTE_MS), lastError: 'HTTP 429' })
    expect(deps.upsert).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: blocked until 2026-11-04T13:00:00.000Z (HTTP 429)')
  })

  test('an unknown page is skipped at once and counted in the streak', async () => {
    const { deps, cursor, state } = harness(stateRow({ cursor: inPass(['audio'], { page: 2, totalPages: 5 }) }), {
      [kabumListingUrl('audio', 2)]: UNKNOWN_PAGE,
    })
    await kabumStep(deps)
    expect(cursor()).toMatchObject({ index: 0, page: 3, totalPages: 5, unknownStreak: 1 })
    expect(state()).toMatchObject({ backoffLevel: 0, blockedUntil: null, lastError: 'sem __NEXT_DATA__' })
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: skipped audio page 2 (sem __NEXT_DATA__)')
  })

  test('three unknown pages in a row back off, and the crawl then resumes at the next page, never refetching one', async () => {
    const pages = Object.fromEntries([2, 3, 4].map((page) => [kabumListingUrl('audio', page), UNKNOWN_PAGE]))
    const { deps, step, cursor, state } = harness(stateRow({ cursor: inPass(['audio'], { page: 2, totalPages: 9 }) }), {
      ...pages,
      [kabumListingUrl('audio', 5)]: listing(5, 9),
    })
    await step()
    await step()
    await step()
    expect(cursor()).toMatchObject({ page: 5, unknownStreak: 0 })
    expect(state()).toMatchObject({ backoffLevel: 1, blockedUntil: new Date(NOW.getTime() + 2 * PAGE_PAUSE_MS + 15 * MINUTE_MS) })
    expect(await step()).toEqual({ sleepMs: MARKET_IDLE_RECHECK_MS, waitingFor: null })
    expect(await step()).toEqual({ sleepMs: 15 * MINUTE_MS - PAGE_PAUSE_MS - MARKET_IDLE_RECHECK_MS, waitingFor: null })
    expect(deps.fetch).toHaveBeenCalledTimes(3)
    await step()
    expect(deps.fetch).toHaveBeenLastCalledWith(kabumListingUrl('audio', 5))
    const fetched = vi.mocked(deps.fetch).mock.calls.map(([url]) => url)
    expect(new Set(fetched).size).toBe(fetched.length)
    expect(state()).toMatchObject({ backoffLevel: 0, lastError: null })
  })

  test('an unknown first page skips the department, whose page count is still unknown', async () => {
    const { deps, cursor } = harness(stateRow({ cursor: inPass(['moda', 'tv']) }), { [kabumListingUrl('moda', 1)]: UNKNOWN_PAGE })
    await kabumStep(deps)
    expect(cursor()).toMatchObject({ index: 1, page: 1, unknownStreak: 1 })
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: skipped moda page 1 (sem __NEXT_DATA__)')
    expect(deps.rematch).not.toHaveBeenCalled()
  })

  test('an unknown last page still ends the department with a rematch', async () => {
    const { deps, cursor } = harness(stateRow({ cursor: inPass(['audio', 'tv'], { page: 4, totalPages: 4 }) }), {
      [kabumListingUrl('audio', 4)]: { status: 200, html: listing(4, 4, [{ code: 1, name: '', price: 0 }]).html },
    })
    await kabumStep(deps)
    expect(cursor()).toMatchObject({ index: 1, page: 1 })
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: skipped audio page 4 (produtos ilegíveis)')
    expect(deps.rematch).toHaveBeenCalledTimes(1)
  })

  test('a network failure counts as unknown with its reason', async () => {
    const { deps, state, cursor } = harness(stateRow({ cursor: inPass(['audio'], { page: 3, totalPages: 6 }) }), {
      [kabumListingUrl('audio', 3)]: { status: 0, html: '', reason: 'tempo esgotado' },
    })
    await kabumStep(deps)
    expect(state().lastError).toBe('sem resposta: tempo esgotado')
    expect(cursor()).toMatchObject({ page: 4, unknownStreak: 1 })
  })

  test('a results page resets the backoff and clears the last error', async () => {
    const { deps, state, cursor } = harness(stateRow({ backoffLevel: 3, lastError: 'HTTP 403', cursor: inPass(['audio'], { unknownStreak: 2 }) }), {
      [kabumListingUrl('audio', 1)]: listing(1, 3),
    })
    await kabumStep(deps)
    expect(state()).toMatchObject({ backoffLevel: 0, blockedUntil: null, lastError: null })
    expect(cursor().unknownStreak).toBe(0)
  })

  test('the last department ends the pass and the crawler then waits for the next one', async () => {
    const { deps, step, cursor } = harness(stateRow({ passStartedAt: NOW, cursor: inPass(['audio', 'tv'], { index: 1 }) }), {
      [kabumListingUrl('tv', 1)]: listing(1, 1),
    })
    await step()
    expect(cursor()).toEqual(IDLE_KABUM_CURSOR)
    expect(deps.log).toHaveBeenCalledWith('[market] kabum: pass finished')
    expect(deps.rematch).toHaveBeenCalledTimes(1)
    expect(await step()).toEqual({ sleepMs: MARKET_IDLE_RECHECK_MS, waitingFor: 'next_pass' })
    expect(deps.fetch).toHaveBeenCalledTimes(1)
  })

  test('a restart resumes at the saved department and page with the saved list', async () => {
    const saved = inPass(['tv', 'audio', 'robotica'], { index: 2, page: 7, totalPages: 9 })
    const { deps } = harness(stateRow({ passStartedAt: new Date(NOW.getTime() - 10 * DAY_MS), cursor: saved }), {
      [kabumListingUrl('robotica', 7)]: listing(7, 9),
    })
    await kabumStep(deps)
    expect(deps.fetch).toHaveBeenCalledWith(kabumListingUrl('robotica', 7))
  })

  test('pages are counted per Sao Paulo day', async () => {
    const yesterday = harness(stateRow({ dayKey: '2026-11-03', pagesToday: 500, cursor: inPass(['audio']) }), { [kabumListingUrl('audio', 1)]: listing(1, 2) })
    await kabumStep(yesterday.deps)
    expect(yesterday.state()).toMatchObject({ dayKey: '2026-11-04', pagesToday: 1 })
    const today = harness(stateRow({ dayKey: '2026-11-04', pagesToday: 41, cursor: inPass(['audio']) }), { [kabumListingUrl('audio', 1)]: listing(1, 2) })
    await kabumStep(today.deps)
    expect(today.state().pagesToday).toBe(42)
  })
})

describe('kabumCursorOf', () => {
  test('a missing or malformed cursor reads as idle', () => {
    expect(kabumCursorOf({})).toEqual(IDLE_KABUM_CURSOR)
    expect(kabumCursorOf({ departments: 'audio', index: -1, page: 1.5, totalPages: '3', unknownStreak: null })).toEqual(IDLE_KABUM_CURSOR)
    expect(kabumCursorOf({ departments: ['audio', 3, 'tv'], index: 1, page: 2 })).toEqual({ departments: ['audio', 'tv'], index: 1, page: 2, totalPages: 0, unknownStreak: 0 })
  })
})
