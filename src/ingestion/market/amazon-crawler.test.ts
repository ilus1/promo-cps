import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { CrawlerStateRow } from '@/db/crawler-state'
import {
  AMAZON_BESTSELLER_DAILY_PAGES, AMAZON_DAILY_PAGES, AMAZON_PAGE_INTERVAL_MS, AMAZON_PAGE_JITTER_MS, AMAZON_SESSION_PAGES, DAY_MS,
  HOLD_RECHECK_MS, HOUR_MS, MARKET_BUSY_RECHECK_MS, MARKET_IDLE_RECHECK_MS, MINUTE_MS,
} from '@/lib/constants'
import { amazonBestsellersRootUrl, amazonSearchUrl } from '@/lib/market/parse-amazon'
import type { AmazonBestsellerExtra, ParsedPage } from '@/lib/market/types'
import type { PageLoader } from './amazon-browser'
import {
  activeBestsellerPass, amazonCursorOf, amazonStep, bestsellersDue, nextBestsellerQueue, type AmazonDeps,
} from './amazon-crawler'
import type { FetchedPage } from './crawl-page'

const NOW = new Date('2026-11-04T12:00:00Z')
const FIXTURES = join(__dirname, '..', '..', 'lib', 'market', '__fixtures__')
const fixture = (name: string): FetchedPage => ({ status: 200, html: readFileSync(join(FIXTURES, name), 'utf8') })
const SEARCH_PAGE = fixture('amazon-search-a55.html')
const EMPTY_PAGE = fixture('amazon-empty.html')
const CAPTCHA_PAGE = fixture('amazon-captcha.html')
const BESTSELLERS_PAGE = fixture('amazon-bestsellers-electronics.html')
const UNKNOWN_PAGE: FetchedPage = { status: 200, html: '<html><body>nada aqui</body></html>' }
const ROOT = amazonBestsellersRootUrl()
const ELECTRONICS = 'https://www.amazon.com.br/gp/bestsellers/electronics'
const KITCHEN = 'https://www.amazon.com.br/gp/bestsellers/kitchen'
const ROOT_PAGE: FetchedPage = {
  status: 200,
  html: '<a href="/gp/bestsellers/electronics/ref=zg_bs_nav_electronics_0">Eletrônicos</a><a href="/gp/bestsellers/kitchen">Cozinha</a>',
}
const PAUSE_MS = AMAZON_PAGE_INTERVAL_MS + Math.floor(0.5 * AMAZON_PAGE_JITTER_MS)
const HOLD = { kind: 'price_manual', text: 'Comparação de preços pausada manualmente', reason: 'comparação pausada manualmente' } as const
const FRESH_BESTSELLERS = new Date(NOW.getTime() - HOUR_MS)
const search = (n: number) => ({ key: `MLB-P${n}`, query: `galaxy a55 ${n}` })

function stateRow(over: Partial<CrawlerStateRow> = {}): CrawlerStateRow {
  return {
    site: 'amazon', cursor: {}, backoffLevel: 0, blockedUntil: null, dayKey: null, pagesToday: 0, lastPageAt: null,
    passStartedAt: null, bestsellersAt: FRESH_BESTSELLERS, lastError: null, updatedAt: NOW, ...over,
  }
}

function harness(row: CrawlerStateRow, pages: (url: string) => FetchedPage = () => SEARCH_PAGE) {
  let current = row
  let clock = NOW.getTime()
  let due = Array.from({ length: 50 }, (_, index) => search(index + 1))
  let open = true
  const load = vi.fn<PageLoader>(async (url) => pages(url))
  const deps: AmazonDeps = {
    now: vi.fn(() => new Date(clock)),
    hold: vi.fn(async () => null),
    idle: vi.fn(() => true),
    load: vi.fn(async () => current),
    save: vi.fn(async (patch) => {
      current = { ...current, ...patch } as CrawlerStateRow
    }),
    session: vi.fn(async (work) => work({ load, isOpen: () => open })),
    dueSearches: vi.fn(async () => due.slice(0, 1)),
    recordSearch: vi.fn(async (key: string) => {
      due = due.filter((entry) => entry.key !== key)
    }),
    upsert: vi.fn(async (offers) => offers.length),
    rematchKeys: vi.fn(async () => ({ checked: 1, matched: 1 })),
    rematch: vi.fn(),
    pause: vi.fn(async (ms: number) => {
      clock += ms
      return true
    }),
    random: () => 0.5,
    log: vi.fn(),
  }
  return {
    deps, load, state: () => current, cursor: () => amazonCursorOf(current.cursor),
    setDue: (next: typeof due) => {
      due = next
    },
    close: () => {
      open = false
    },
  }
}

describe('amazonStep before a session', () => {
  test('a hold of any kind waits a minute and opens no browser', async () => {
    const { deps } = harness(stateRow())
    vi.mocked(deps.hold).mockResolvedValue(HOLD)
    expect(await amazonStep(deps)).toEqual({ sleepMs: HOLD_RECHECK_MS, waitingFor: null })
    expect(deps.session).not.toHaveBeenCalled()
  })

  test('a block waits and opens no browser', async () => {
    const { deps } = harness(stateRow({ blockedUntil: new Date(NOW.getTime() + 4 * HOUR_MS) }))
    expect(await amazonStep(deps)).toEqual({ sleepMs: MARKET_IDLE_RECHECK_MS, waitingFor: null })
    expect(deps.session).not.toHaveBeenCalled()
  })

  test('an ML job queued or running keeps Amazon closed', async () => {
    const { deps } = harness(stateRow())
    vi.mocked(deps.idle).mockReturnValue(false)
    expect(await amazonStep(deps)).toEqual({ sleepMs: MARKET_BUSY_RECHECK_MS, waitingFor: 'ml_busy' })
    expect(deps.session).not.toHaveBeenCalled()
    expect(deps.dueSearches).not.toHaveBeenCalled()
  })

  test('the daily budget stops it for the rest of the Sao Paulo day', async () => {
    const spent = harness(stateRow({ dayKey: '2026-11-04', pagesToday: AMAZON_DAILY_PAGES }))
    expect(await amazonStep(spent.deps)).toEqual({ sleepMs: MARKET_IDLE_RECHECK_MS, waitingFor: 'daily_budget' })
    expect(spent.deps.session).not.toHaveBeenCalled()
    const yesterday = harness(stateRow({ dayKey: '2026-11-03', pagesToday: AMAZON_DAILY_PAGES }))
    await amazonStep(yesterday.deps)
    expect(yesterday.deps.session).toHaveBeenCalledTimes(1)
  })

  test('nothing to search and fresh best sellers opens no browser', async () => {
    const { deps, setDue } = harness(stateRow())
    setDue([])
    expect(await amazonStep(deps)).toEqual({ sleepMs: MARKET_IDLE_RECHECK_MS, waitingFor: 'queue_empty' })
    expect(deps.session).not.toHaveBeenCalled()
  })

  test('a session never starts sooner than the interval after the last page', async () => {
    const { deps } = harness(stateRow({ lastPageAt: new Date(NOW.getTime() - 10_000) }))
    expect(await amazonStep(deps)).toEqual({ sleepMs: AMAZON_PAGE_INTERVAL_MS - 10_000, waitingFor: null })
    expect(deps.session).not.toHaveBeenCalled()
  })
})

describe('amazonStep searches', () => {
  test('a results page upserts the offers, records the search and re-matches its key', async () => {
    const { deps, load, state } = harness(stateRow())
    await amazonStep(deps)
    expect(load).toHaveBeenNthCalledWith(1, amazonSearchUrl('galaxy a55 1'), false)
    expect(vi.mocked(deps.upsert).mock.calls[0][0].length).toBeGreaterThan(0)
    expect(deps.recordSearch).toHaveBeenNthCalledWith(1, 'MLB-P1', 'galaxy a55 1', 'results', 59, NOW)
    expect(deps.rematchKeys).toHaveBeenNthCalledWith(1, ['MLB-P1'], NOW)
    expect(state()).toMatchObject({ backoffLevel: 0, lastError: null })
  })

  test('a session reads up to its page limit, paced, then closes', async () => {
    const { deps, load, state } = harness(stateRow())
    expect(await amazonStep(deps)).toEqual({ sleepMs: PAUSE_MS, waitingFor: null })
    expect(load).toHaveBeenCalledTimes(AMAZON_SESSION_PAGES)
    expect(deps.pause).toHaveBeenCalledTimes(AMAZON_SESSION_PAGES - 1)
    expect(deps.pause).toHaveBeenCalledWith(PAUSE_MS)
    expect(state().pagesToday).toBe(AMAZON_SESSION_PAGES)
    expect(deps.save).toHaveBeenCalledTimes(2 * AMAZON_SESSION_PAGES)
  })

  test('a pause cut short by an ML job ends the session, even if the chain is idle again at the next check', async () => {
    const { deps, load } = harness(stateRow())
    vi.mocked(deps.pause).mockResolvedValue(false)
    await amazonStep(deps)
    expect(load).toHaveBeenCalledTimes(1)
    expect(deps.idle).toHaveBeenCalledTimes(2)
  })

  test('offers that always fail to save record the search as unknown, so the next page is another key', async () => {
    const { deps, load, state, cursor } = harness(stateRow({ dayKey: '2026-11-04', pagesToday: 4 }))
    vi.mocked(deps.upsert).mockRejectedValue(new Error('Failed query', { cause: Object.assign(new Error('integer out of range'), { code: '22003' }) }))
    vi.mocked(deps.dueSearches).mockResolvedValueOnce([search(1)]).mockResolvedValueOnce([search(2)]).mockResolvedValue([])
    await amazonStep(deps)
    expect(load.mock.calls.map(([url]) => url)).toEqual([amazonSearchUrl('galaxy a55 1'), amazonSearchUrl('galaxy a55 2')])
    expect(deps.recordSearch).toHaveBeenNthCalledWith(1, 'MLB-P1', 'galaxy a55 1', 'unknown', 0, NOW)
    expect(deps.rematchKeys).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ pagesToday: 6, lastError: 'falha ao gravar: integer out of range (22003)' })
    expect(cursor().unknownStreak).toBe(2)
    expect(deps.log).toHaveBeenCalledWith('[market] amazon: MLB-P1 not saved (falha ao gravar: integer out of range (22003))')
  })

  test('a search that fails to record counts as unknown and the session goes on', async () => {
    const { deps, load, state } = harness(stateRow())
    vi.mocked(deps.recordSearch).mockRejectedValueOnce(new Error('value too long'))
    vi.mocked(deps.dueSearches).mockResolvedValueOnce([search(1)]).mockResolvedValueOnce([search(2)]).mockResolvedValue([])
    await amazonStep(deps)
    expect(load).toHaveBeenCalledTimes(2)
    expect(deps.rematchKeys).toHaveBeenCalledTimes(1)
    expect(deps.rematchKeys).toHaveBeenCalledWith(['MLB-P2'], expect.any(Date))
    expect(deps.log).toHaveBeenCalledWith('[market] amazon: search of MLB-P1 not recorded (falha ao gravar: value too long)')
    expect(state().lastError).toBeNull()
  })

  test('a database outage fails the session before any write, so the page is retried after the error backoff', async () => {
    const { deps } = harness(stateRow())
    vi.mocked(deps.save).mockRejectedValue(new Error('connection refused'))
    await expect(amazonStep(deps)).rejects.toThrow('connection refused')
    expect(deps.upsert).not.toHaveBeenCalled()
    expect(deps.recordSearch).not.toHaveBeenCalled()
  })

  test('a closed page ends the session with no search recorded and no state saved', async () => {
    const { deps, load } = harness(stateRow())
    load.mockRejectedValue(new Error('Target page, context or browser has been closed'))
    await expect(amazonStep(deps)).rejects.toThrow('has been closed')
    expect(deps.recordSearch).not.toHaveBeenCalled()
    expect(deps.save).not.toHaveBeenCalled()
  })

  test('a session closed by its deadline while a page loads writes nothing for that page', async () => {
    const { deps, load, close } = harness(stateRow())
    load.mockImplementation(async () => {
      close()
      return SEARCH_PAGE
    })
    await expect(amazonStep(deps)).rejects.toThrow('amazon session closed')
    expect(deps.save).not.toHaveBeenCalled()
    expect(deps.upsert).not.toHaveBeenCalled()
    expect(deps.recordSearch).not.toHaveBeenCalled()
    expect(deps.rematchKeys).not.toHaveBeenCalled()
  })

  test('a session closed between pages loads no further page', async () => {
    const { deps, load, close } = harness(stateRow())
    vi.mocked(deps.pause).mockImplementation(async () => {
      close()
      return true
    })
    await amazonStep(deps)
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('a wall ends the session, records no search and backs off', async () => {
    const { deps, load, state } = harness(stateRow(), (url) => (url === amazonSearchUrl('galaxy a55 2') ? CAPTCHA_PAGE : SEARCH_PAGE))
    await amazonStep(deps)
    expect(load).toHaveBeenCalledTimes(2)
    expect(deps.recordSearch).toHaveBeenCalledTimes(1)
    expect(state()).toMatchObject({ backoffLevel: 1, blockedUntil: new Date(NOW.getTime() + PAUSE_MS + 15 * MINUTE_MS), lastError: 'captcha' })
    expect(deps.log).toHaveBeenCalledWith(expect.stringMatching(/^\[market\] amazon: blocked until .+ \(captcha\)$/))
  })

  test('after a wall the same key is searched again once the backoff ends', async () => {
    const { deps, load, state } = harness(stateRow(), () => CAPTCHA_PAGE)
    await amazonStep(deps)
    const blockedUntil = state().blockedUntil
    expect(blockedUntil).not.toBeNull()
    vi.mocked(deps.now).mockReturnValue(blockedUntil as Date)
    await amazonStep(deps)
    expect(load.mock.calls.map(([url]) => url)).toEqual([amazonSearchUrl('galaxy a55 1'), amazonSearchUrl('galaxy a55 1')])
    expect(deps.recordSearch).not.toHaveBeenCalled()
  })

  test('a missing page is recorded as unknown for the short retry, with no rematch and no backoff', async () => {
    const { deps, state, cursor } = harness(stateRow(), () => ({ status: 404, html: '' }))
    await amazonStep(deps)
    expect(deps.recordSearch).toHaveBeenNthCalledWith(1, 'MLB-P1', 'galaxy a55 1', 'unknown', 0, NOW)
    expect(deps.recordSearch).toHaveBeenCalledTimes(AMAZON_SESSION_PAGES)
    expect(deps.rematchKeys).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ backoffLevel: 0, blockedUntil: null })
    expect(cursor().unknownStreak).toBe(0)
  })

  test('a plain 503 is a wall too', async () => {
    const { deps, state } = harness(stateRow(), () => ({ status: 503, html: '' }))
    await amazonStep(deps)
    expect(deps.recordSearch).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ backoffLevel: 1, lastError: 'HTTP 503' })
  })

  test('an ML job appearing closes the session at the next page boundary', async () => {
    const { deps, load } = harness(stateRow())
    vi.mocked(deps.idle).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false)
    await amazonStep(deps)
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('a hold appearing closes the session before the next page', async () => {
    const { deps, load } = harness(stateRow())
    vi.mocked(deps.hold).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(HOLD)
    await amazonStep(deps)
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('the session stops when the daily budget runs out', async () => {
    const { deps, load, state } = harness(stateRow({ dayKey: '2026-11-04', pagesToday: AMAZON_DAILY_PAGES - 3 }))
    await amazonStep(deps)
    expect(load).toHaveBeenCalledTimes(3)
    expect(state().pagesToday).toBe(AMAZON_DAILY_PAGES)
  })

  test('an empty search is recorded and re-matched; an unknown one is recorded as unknown without a rematch', async () => {
    const pages = (url: string) => (url === amazonSearchUrl('galaxy a55 1') ? EMPTY_PAGE : UNKNOWN_PAGE)
    const { deps } = harness(stateRow(), pages)
    await amazonStep(deps)
    expect(deps.recordSearch).toHaveBeenNthCalledWith(1, 'MLB-P1', 'galaxy a55 1', 'empty', 0, NOW)
    expect(deps.recordSearch).toHaveBeenNthCalledWith(2, 'MLB-P2', 'galaxy a55 2', 'unknown', 0, expect.any(Date))
    expect(deps.rematchKeys).toHaveBeenCalledTimes(1)
  })

  test('three unknown pages in a row block and end the session, each recorded so the queue moves on', async () => {
    const { deps, load, state, cursor } = harness(stateRow(), () => UNKNOWN_PAGE)
    await amazonStep(deps)
    expect(load.mock.calls.map(([url]) => url)).toEqual([1, 2, 3].map((n) => amazonSearchUrl(`galaxy a55 ${n}`)))
    expect(vi.mocked(deps.recordSearch).mock.calls.map(([key, , status]) => [key, status])).toEqual([
      ['MLB-P1', 'unknown'], ['MLB-P2', 'unknown'], ['MLB-P3', 'unknown'],
    ])
    expect(state()).toMatchObject({ backoffLevel: 1, lastError: 'página desconhecida' })
    expect(cursor().unknownStreak).toBe(0)
  })

  test('a failed rematch is logged and the session goes on', async () => {
    const { deps, load } = harness(stateRow())
    vi.mocked(deps.rematchKeys).mockRejectedValueOnce(new Error('Failed query', { cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }) }))
    await amazonStep(deps)
    expect(deps.log).toHaveBeenCalledWith('[market] amazon: rematch of MLB-P1 failed: deadlock detected (40P01)')
    expect(load).toHaveBeenCalledTimes(AMAZON_SESSION_PAGES)
  })
})

describe('amazonStep best sellers', () => {
  const pages = (url: string): FetchedPage => {
    if (url === ROOT) return ROOT_PAGE
    if (url.startsWith(ELECTRONICS)) return BESTSELLERS_PAGE
    return { status: 404, html: '' }
  }

  test('a due pass goes first: the root, then each department with its second page, then the searches', async () => {
    const { deps, load, state, cursor } = harness(stateRow({ bestsellersAt: new Date(NOW.getTime() - DAY_MS) }), pages)
    await amazonStep(deps)
    expect(load.mock.calls.slice(0, 5)).toEqual([
      [ROOT, false],
      [ELECTRONICS, true],
      [`${ELECTRONICS}?ie=UTF8&pg=2`, true],
      [KITCHEN, true],
      [amazonSearchUrl('galaxy a55 1'), false],
    ])
    expect(vi.mocked(deps.upsert).mock.calls[1][0]).toHaveLength(29)
    expect(cursor().bestsellers).toBeNull()
    expect(state().bestsellersAt).toEqual(new Date(NOW.getTime() + 3 * PAUSE_MS))
    expect(deps.rematch).toHaveBeenCalledTimes(1)
    expect(deps.log).toHaveBeenCalledWith('[market] amazon: best sellers finished after 4 pages')
  })

  test('the pass keeps its queue in the cursor and resumes it after a wall', async () => {
    const walled = (url: string) => (url === `${ELECTRONICS}?ie=UTF8&pg=2` ? CAPTCHA_PAGE : pages(url))
    const { deps, cursor } = harness(stateRow({ bestsellersAt: null }), walled)
    await amazonStep(deps)
    expect(cursor().bestsellers).toEqual({ queue: [`${ELECTRONICS}?ie=UTF8&pg=2`, KITCHEN], pages: 3 })
    const resumed = harness(stateRow({ bestsellersAt: null, cursor: { bestsellers: cursor().bestsellers } }), pages)
    await amazonStep(resumed.deps)
    expect(resumed.load.mock.calls[0]).toEqual([`${ELECTRONICS}?ie=UTF8&pg=2`, true])
  })

  test('an unknown department page is skipped for the day', async () => {
    const unreadable = (url: string) => (url === KITCHEN ? UNKNOWN_PAGE : pages(url))
    const { deps, load, state, cursor } = harness(stateRow({ bestsellersAt: null }), unreadable)
    await amazonStep(deps)
    expect(load.mock.calls.filter(([url]) => url === KITCHEN)).toHaveLength(1)
    expect(cursor().bestsellers).toBeNull()
    expect(state().bestsellersAt).not.toBeNull()
    expect(bestsellersDue(state().bestsellersAt, new Date(NOW.getTime() + HOUR_MS))).toBe(false)
  })

  test('a best-seller page whose offers fail to save is dropped for the day and the pass goes on', async () => {
    const { deps, load, cursor, state } = harness(stateRow({ cursor: { bestsellers: { queue: [ELECTRONICS, KITCHEN], pages: 3 } } }), pages)
    vi.mocked(deps.upsert).mockRejectedValueOnce(new Error('invalid input syntax for type timestamp'))
    await amazonStep(deps)
    expect(load.mock.calls.slice(0, 2)).toEqual([[ELECTRONICS, true], [KITCHEN, true]])
    expect(cursor().bestsellers).toBeNull()
    expect(state().lastError).toBe('falha ao gravar: invalid input syntax for type timestamp')
  })

  test('the pass stops at its page cap', async () => {
    const queue = [ELECTRONICS, KITCHEN]
    const { deps, load, cursor, state } = harness(stateRow({ cursor: { bestsellers: { queue, pages: AMAZON_BESTSELLER_DAILY_PAGES - 1 } } }), pages)
    await amazonStep(deps)
    expect(load.mock.calls[0]).toEqual([ELECTRONICS, true])
    expect(load.mock.calls[1]).toEqual([amazonSearchUrl('galaxy a55 1'), false])
    expect(cursor().bestsellers).toBeNull()
    expect(state().bestsellersAt).toEqual(NOW)
  })
})

describe('best-seller rules', () => {
  test('the pass is due daily', () => {
    expect(bestsellersDue(null, NOW)).toBe(true)
    expect(bestsellersDue(new Date(NOW.getTime() - DAY_MS), NOW)).toBe(true)
    expect(bestsellersDue(new Date(NOW.getTime() - DAY_MS + 1), NOW)).toBe(false)
  })

  test('a saved pass wins, and an exhausted or empty one gives way to a new pass only when due', () => {
    const saved = { queue: [KITCHEN], pages: 3 }
    expect(activeBestsellerPass({ unknownStreak: 0, bestsellers: saved }, FRESH_BESTSELLERS, NOW)).toBe(saved)
    expect(activeBestsellerPass({ unknownStreak: 0, bestsellers: { queue: [], pages: 3 } }, FRESH_BESTSELLERS, NOW)).toBeNull()
    expect(activeBestsellerPass({ unknownStreak: 0, bestsellers: null }, null, NOW)).toEqual({ queue: [ROOT], pages: 0 })
  })

  test('the queue grows from the root, puts page two first, retries walls and skips other failures', () => {
    const pass = { queue: [ROOT, KITCHEN], pages: 0 }
    const root: ParsedPage<AmazonBestsellerExtra> = { kind: 'results', offers: [], extra: { nextPageUrl: null, nodeUrls: [ELECTRONICS, KITCHEN] } }
    expect(nextBestsellerQueue(pass, root, true)).toEqual([KITCHEN, ELECTRONICS])
    const department: ParsedPage<AmazonBestsellerExtra> = { kind: 'results', offers: [], extra: { nextPageUrl: `${KITCHEN}?pg=2`, nodeUrls: [] } }
    expect(nextBestsellerQueue({ queue: [KITCHEN, ELECTRONICS], pages: 1 }, department, false)).toEqual([`${KITCHEN}?pg=2`, ELECTRONICS])
    expect(nextBestsellerQueue(pass, { kind: 'wall', reason: 'captcha' }, true)).toEqual(pass.queue)
    expect(nextBestsellerQueue(pass, { kind: 'unknown', reason: 'x' }, true)).toEqual([KITCHEN])
  })

  test('a malformed cursor reads as no pass and no streak', () => {
    expect(amazonCursorOf({})).toEqual({ unknownStreak: 0, bestsellers: null })
    expect(amazonCursorOf({ unknownStreak: 2, bestsellers: { queue: 'x' } })).toEqual({ unknownStreak: 2, bestsellers: null })
    expect(amazonCursorOf({ bestsellers: { queue: [KITCHEN, 4] } })).toEqual({ unknownStreak: 0, bestsellers: { queue: [KITCHEN], pages: 0 } })
  })
})
