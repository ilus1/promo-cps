import type { Page } from 'playwright'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyTargets } from '@/db/coupons'
import { ML_COUPONS_URL, VERIFY_TIMEOUT_MS } from '@/lib/constants'
import { serialized } from './run-chain'
import { VERIFY_CRASHED_ERROR, observeVerify, startVerify, verifyStatus, watchVerify } from './verify'

const clock = vi.hoisted(() => ({ now: 0, onSleep: (() => undefined) as () => void }))
const chain = vi.hoisted(() => ({ jobs: [] as Array<() => Promise<unknown>> }))
const browser = vi.hoisted(() => ({ page: null as unknown }))

vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn(async (ms: number) => {
    clock.now += ms
    clock.onSleep()
  }),
}))
vi.mock('@/db/coupons', () => ({ verifyTargets: vi.fn() }))
const hold = vi.hoisted(() => ({ current: null as null | { kind: string; text: string; reason: string } }))
vi.mock('./request-hold', () => ({ mlHoldCheck: vi.fn(async () => hold.current) }))
vi.mock('./run-chain', () => ({
  serialized: vi.fn((job: () => Promise<unknown>) => new Promise((resolve, reject) => {
    chain.jobs.push(() => job().then(resolve, reject))
  })),
}))
vi.mock('./browser', () => ({
  withMlBrowser: vi.fn((_mode: string, task: (page: unknown) => Promise<unknown>) => task(browser.page)),
}))

const ORIGIN = 'https://www.mercadolivre.com.br'
const WALL = `${ORIGIN}/captcha/wall/logged?go_url=x`
const LISTING = 'https://lista.mercadolivre.com.br/ssd'
const GOTO_OPTIONS = { waitUntil: 'commit', timeout: expect.any(Number) }

type Handler = (arg?: unknown) => void

class FakePage {
  closed = false
  private readonly handlers = new Map<string, Set<Handler>>()
  private readonly frame = {}
  readonly goto = vi.fn(async (url: string): Promise<{ status: () => number } | null> => {
    this.href = url
    return null
  })

  constructor(public href: string) {}

  url() { return this.href }
  isClosed() { return this.closed }
  mainFrame() { return this.frame }
  on(event: string, handler: Handler) { this.handlers.set(event, (this.handlers.get(event) ?? new Set()).add(handler)) }
  once(event: string, handler: Handler) { this.on(event, handler) }
  off(event: string, handler: Handler) { this.handlers.get(event)?.delete(handler) }
  listenerCount() { return [...this.handlers.values()].reduce((count, set) => count + set.size, 0) }

  response(status: number, { navigation = true, subframe = false } = {}) {
    const frame = subframe ? {} : this.frame
    this.emit('response', { status: () => status, request: () => ({ isNavigationRequest: () => navigation }), frame: () => frame })
  }

  crash() { this.emit('crash') }

  private emit(event: string, arg?: unknown) {
    this.handlers.get(event)?.forEach((handler) => handler(arg))
  }
}

function onSleeps(actions: Record<number, () => void>) {
  let sleeps = 0
  clock.onSleep = () => {
    sleeps += 1
    actions[sleeps]?.()
  }
}

async function watch(page: FakePage) {
  const observer = observeVerify(page as unknown as Page)
  const outcome = watchVerify(page as unknown as Page, Date.now() + VERIFY_TIMEOUT_MS, observer)
  await outcome.catch(() => undefined)
  observer.stop()
  expect(page.goto).not.toHaveBeenCalled()
  expect(page.listenerCount()).toBe(0)
  return outcome
}

async function runQueuedJob() {
  await chain.jobs.shift()?.()
}

async function runVerify(page: FakePage) {
  browser.page = page
  startVerify()
  await runQueuedJob()
  expect(page.listenerCount()).toBe(0)
  return verifyStatus()
}

beforeEach(() => {
  clock.now = 0
  clock.onSleep = () => undefined
  chain.jobs.length = 0
  hold.current = null
  globalThis.__promoVerify = undefined
  vi.clearAllMocks()
  vi.mocked(verifyTargets).mockResolvedValue([])
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('watchVerify', () => {
  it('returns cleared once the page leaves the wall for an ML page', async () => {
    const page = new FakePage(WALL)
    onSleeps({ 2: () => { page.href = LISTING } })
    expect(await watch(page)).toBe('cleared')
  })

  it('returns closed when the window closes while walled', async () => {
    const page = new FakePage(WALL)
    onSleeps({ 1: () => { page.closed = true } })
    expect(await watch(page)).toBe('closed')
  })

  it('returns cleared when the window closes during the settle after the wall cleared', async () => {
    const page = new FakePage(LISTING)
    onSleeps({ 1: () => { page.closed = true } })
    expect(await watch(page)).toBe('cleared')
  })

  it('returns closed when the page falls back to the wall during the settle and the window then closes', async () => {
    const page = new FakePage(LISTING)
    onSleeps({ 1: () => { page.href = WALL }, 2: () => { page.closed = true } })
    expect(await watch(page)).toBe('closed')
  })

  it('returns timed_out while the wall persists', async () => {
    expect(await watch(new FakePage(WALL))).toBe('timed_out')
  })

  it('keeps waiting when the page falls back to the wall during the settle', async () => {
    const page = new FakePage(LISTING)
    onSleeps({ 1: () => { page.href = WALL } })
    expect(await watch(page)).toBe('timed_out')
  })

  it('does not clear a blocked response and keeps the window until it closes', async () => {
    const page = new FakePage(LISTING)
    onSleeps({ 1: () => page.response(429), 2: () => { page.closed = true } })
    expect(await watch(page)).toBe('closed')
  })

  it('clears once a later navigation answers normally', async () => {
    const page = new FakePage(LISTING)
    onSleeps({ 1: () => page.response(403), 2: () => page.response(200) })
    expect(await watch(page)).toBe('cleared')
  })

  it.each([
    ['a subframe response', (page: FakePage) => page.response(403, { subframe: true })],
    ['a non-navigation response', (page: FakePage) => page.response(403, { navigation: false })],
  ])('ignores %s', async (_label, event) => {
    const page = new FakePage(LISTING)
    onSleeps({ 1: () => event(page) })
    expect(await watch(page)).toBe('cleared')
  })

  it('throws when the browser crashed', async () => {
    const page = new FakePage(WALL)
    onSleeps({ 1: () => page.crash() })
    await expect(watch(page)).rejects.toThrow(VERIFY_CRASHED_ERROR)
  })
})

describe('startVerify', () => {
  it('a job queued while clear but started while held fails with the hold text and opens no browser', async () => {
    const { withMlBrowser } = await import('./browser')
    startVerify()
    hold.current = { kind: 'manual', text: 'Requisições pausadas manualmente: retome em Conta para rodar', reason: 'pausado manualmente' }
    await runQueuedJob()
    expect(verifyStatus()).toEqual({ state: 'failed', error: 'Requisições pausadas manualmente: retome em Conta para rodar' })
    expect(withMlBrowser).not.toHaveBeenCalled()
    expect(verifyTargets).not.toHaveBeenCalled()
  })

  it('is a no-op while queued or waiting', async () => {
    const page = new FakePage(WALL)
    const navigation = Promise.withResolvers<null>()
    page.goto.mockReturnValueOnce(navigation.promise)
    browser.page = page

    startVerify()
    expect(verifyStatus().state).toBe('queued')
    startVerify()
    expect(serialized).toHaveBeenCalledTimes(1)

    const run = runQueuedJob()
    await vi.waitFor(() => expect(verifyStatus().state).toBe('waiting'))
    startVerify()
    expect(serialized).toHaveBeenCalledTimes(1)

    page.closed = true
    navigation.resolve(null)
    await run
    expect(verifyStatus()).toEqual({ state: 'closed', error: null })
  })

  it('stores only the first line of a database failure and launches nothing', async () => {
    vi.mocked(verifyTargets).mockRejectedValueOnce(new Error('connect ECONNREFUSED\nstack line'))
    const { withMlBrowser } = await import('./browser')
    startVerify()
    await runQueuedJob()
    expect(verifyStatus()).toEqual({ state: 'failed', error: 'connect ECONNREFUSED' })
    expect(withMlBrowser).not.toHaveBeenCalled()
  })

  it('redacts query strings from a stored failure', async () => {
    vi.mocked(verifyTargets).mockRejectedValueOnce(new Error('goto https://a.com/x?token=SECRET failed'))
    startVerify()
    await runQueuedJob()
    expect(verifyStatus()).toEqual({ state: 'failed', error: 'goto https://a.com/x failed' })
  })

  it('opens the coupons page when there are no targets', async () => {
    const page = new FakePage(WALL)
    page.closed = true
    await runVerify(page)
    expect(page.goto).toHaveBeenCalledWith(ML_COUPONS_URL, GOTO_OPTIONS)
  })

  it('opens the first target listing url with one commit-only goto', async () => {
    vi.mocked(verifyTargets).mockResolvedValueOnce([{ listingUrl: LISTING }] as never)
    const page = new FakePage(WALL)
    page.closed = true
    await runVerify(page)
    expect(page.goto).toHaveBeenCalledTimes(1)
    expect(page.goto).toHaveBeenCalledWith(LISTING, GOTO_OPTIONS)
  })

  it('keeps watching when goto rejects on an open page', async () => {
    const page = new FakePage(WALL)
    page.goto.mockRejectedValueOnce(new Error('Timeout 30000ms exceeded\nCall log'))
    onSleeps({ 1: () => { page.href = LISTING } })
    expect(await runVerify(page)).toEqual({ state: 'cleared', error: null })
    expect(page.goto).toHaveBeenCalledTimes(1)
  })

  it('reports closed when goto rejects on a closed page', async () => {
    const page = new FakePage(WALL)
    page.goto.mockImplementationOnce(async () => {
      page.closed = true
      throw new Error('Target page, context or browser has been closed')
    })
    expect(await runVerify(page)).toEqual({ state: 'closed', error: null })
  })

  it('treats a 403 goto response as walled', async () => {
    const page = new FakePage(LISTING)
    page.goto.mockResolvedValueOnce({ status: () => 403 })
    onSleeps({ 1: () => { page.closed = true } })
    expect(await runVerify(page)).toEqual({ state: 'closed', error: null })
  })
})
