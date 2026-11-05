import { setTimeout as sleep } from 'node:timers/promises'
import type { Page } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finishRun, startRun } from '@/db/runs'
import { LOGIN_TIMEOUT_MS, ML_COUPONS_URL, ML_HOST, ML_LOGIN_URL } from '@/lib/constants'
import { serialized } from './run-chain'
import {
  BROWSER_CRASHED_ERROR, LOGIN_BLOCK_MARKER, landing, loginStatus, observeLogin, startLogin, watchLogin,
} from './login'

const clock = vi.hoisted(() => ({ now: 0, onSleep: (() => undefined) as () => void }))
const chain = vi.hoisted(() => ({ jobs: [] as Array<() => Promise<unknown>> }))
const browser = vi.hoisted(() => ({ page: null as unknown }))

vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn(async (ms: number) => {
    clock.now += ms
    clock.onSleep()
  }),
}))
vi.mock('@/db/runs', () => ({
  startRun: vi.fn(async () => ({ id: 'login-run' })),
  finishRun: vi.fn(async () => ({})),
  lastRun: vi.fn(),
}))
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

const ORIGIN = new URL(ML_LOGIN_URL).origin
const HOME = `${ORIGIN}/`
const LOGIN = `${ORIGIN}/login/identification`
const REFUSAL_PAGE = `${LOGIN}/${LOGIN_BLOCK_MARKER}`
const JMS_CALLBACK = `${ORIGIN}/jms/mlb/lgz/login/callback?go=${encodeURIComponent(ML_LOGIN_URL)}`
const CLOSED_ERROR = 'Target page, context or browser has been closed'

type Handler = (arg?: unknown) => void
type FakeFrame = { url: () => string }

class FakePage {
  closed = false
  private readonly handlers = new Map<string, Set<Handler>>()
  private readonly frame: FakeFrame = { url: () => this.href }
  readonly goto = vi.fn(async (url: string) => {
    this.href = url
  })

  constructor(public href: string) {}

  url() {
    return this.href
  }

  isClosed() {
    return this.closed
  }

  mainFrame() {
    return this.frame
  }

  on(event: string, handler: Handler) {
    this.handlers.set(event, (this.handlers.get(event) ?? new Set()).add(handler))
  }

  once(event: string, handler: Handler) {
    this.on(event, handler)
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler)
  }

  listenerCount() {
    return [...this.handlers.values()].reduce((count, set) => count + set.size, 0)
  }

  navigate(href: string) {
    this.href = href
    this.emit('framenavigated', this.frame)
  }

  navigateSubframe(href: string) {
    this.emit('framenavigated', { url: () => href })
  }

  request(href: string, { navigation = true, subframe = false } = {}) {
    const frame = subframe ? { url: () => href } : this.frame
    this.emit('request', { url: () => href, isNavigationRequest: () => navigation, frame: () => frame })
  }

  crash() {
    this.emit('crash')
  }

  private emit(event: string, arg?: unknown) {
    this.handlers.get(event)?.forEach((handler) => handler(arg))
  }
}

async function watch(page: FakePage, deadline = Date.now() + LOGIN_TIMEOUT_MS) {
  const target = page as unknown as Page
  const observer = observeLogin(target)
  const outcome = watchLogin(target, deadline, observer)
  await outcome.catch(() => undefined)
  observer.stop()
  expect(page.goto).not.toHaveBeenCalled()
  expect(page.listenerCount()).toBe(0)
  return outcome
}

function onSleeps(actions: Record<number, () => void>) {
  let sleeps = 0
  clock.onSleep = () => {
    sleeps += 1
    actions[sleeps]?.()
  }
}

const loggedPaths = () => vi.mocked(console.info).mock.calls.map(([, path]) => path)

async function runQueuedJob() {
  await chain.jobs.shift()?.()
}

async function runLogin(page: FakePage) {
  browser.page = page
  startLogin()
  await runQueuedJob()
  expect(page.listenerCount()).toBe(0)
  return loginStatus()
}

beforeEach(() => {
  clock.now = 0
  clock.onSleep = () => undefined
  chain.jobs.length = 0
  hold.current = null
  globalThis.__promoLogin = undefined
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('landing', () => {
  it.each([
    [JMS_CALLBACK, null],
    [LOGIN, null],
    [ML_LOGIN_URL, 'coupons'],
    [ML_COUPONS_URL, 'coupons'],
    [HOME, 'home'],
    [`https://lista.${ML_HOST}/cupons`, null],
    [`${ORIGIN}/cuponsx`, null],
    ['about:blank', null],
    ['chrome-error://chromewebdata/', null],
  ])('%s -> %s', (href, expected) => {
    expect(landing(href)).toBe(expected)
  })
})

describe('watchLogin', () => {
  it.each([LOGIN, JMS_CALLBACK])('never succeeds on %s', async (href) => {
    expect(await watch(new FakePage(href))).toBe('timed_out')
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(console.info).toHaveBeenCalledWith('[login]', new URL(href).pathname)
  })

  it('succeeds once the coupons page has settled', async () => {
    expect(await watch(new FakePage(ML_LOGIN_URL))).toBe('logged_in')
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it('ignores a coupons page that redirects away before settling', async () => {
    const page = new FakePage(ML_LOGIN_URL)
    onSleeps({ 2: () => { page.href = LOGIN } })
    expect(await watch(page)).toBe('timed_out')
  })

  it('reports unconfirmed for a settled home page without navigating', async () => {
    expect(await watch(new FakePage(HOME))).toBe('unconfirmed')
    expect(sleep).toHaveBeenCalledTimes(5)
  })

  it('ignores a home page that moves on before settling', async () => {
    const page = new FakePage(HOME)
    onSleeps({ 2: () => { page.href = LOGIN } })
    expect(await watch(page)).toBe('timed_out')
  })

  it('reports refused as soon as a poll sees the refusal page', async () => {
    const page = new FakePage(LOGIN)
    onSleeps({ 3: () => { page.href = REFUSAL_PAGE }, 4: () => { page.href = HOME } })
    expect(await watch(page)).toBe('refused')
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(loggedPaths()).toEqual([new URL(LOGIN).pathname, new URL(REFUSAL_PAGE).pathname])
  })

  it('reports refused when the refusal page is visited only between two polls', async () => {
    const page = new FakePage(LOGIN)
    onSleeps({ 3: () => { page.navigate(REFUSAL_PAGE); page.navigate(HOME) } })
    expect(await watch(page)).toBe('refused')
    expect(loggedPaths()).toEqual([new URL(LOGIN).pathname])
  })

  it('reports refused when a navigation request reaches the refusal page between two polls', async () => {
    const page = new FakePage(LOGIN)
    onSleeps({ 2: () => { page.request(REFUSAL_PAGE); page.navigate(HOME) } })
    expect(await watch(page)).toBe('refused')
  })

  it('reports refused when the refusal page is visited during the last poll interval', async () => {
    const page = new FakePage(LOGIN)
    onSleeps({ 1: () => { page.navigate(REFUSAL_PAGE); page.navigate(HOME) } })
    expect(await watch(page, Date.now() + 1)).toBe('refused')
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('reports refused when the window closes after a refusal', async () => {
    const page = new FakePage(LOGIN)
    onSleeps({ 2: () => { page.navigate(REFUSAL_PAGE); page.closed = true } })
    expect(await watch(page)).toBe('refused')
  })

  it('reports refused when the page crashes after a refusal', async () => {
    const page = new FakePage(LOGIN)
    onSleeps({ 2: () => { page.navigate(REFUSAL_PAGE); page.crash() } })
    expect(await watch(page)).toBe('refused')
  })

  it.each([
    ['a subframe navigation', (page: FakePage) => page.navigateSubframe(REFUSAL_PAGE)],
    ['a subframe request', (page: FakePage) => page.request(REFUSAL_PAGE, { subframe: true })],
    ['a non-navigation request', (page: FakePage) => page.request(REFUSAL_PAGE, { navigation: false })],
    ['an unparsable request URL', (page: FakePage) => page.request('not a url')],
  ])('ignores %s', async (_label, event) => {
    const page = new FakePage(HOME)
    onSleeps({ 1: () => event(page) })
    expect(await watch(page)).toBe('unconfirmed')
  })

  it('reports timed_out as soon as the window closes', async () => {
    const page = new FakePage(LOGIN)
    onSleeps({ 2: () => { page.closed = true } })
    expect(await watch(page)).toBe('timed_out')
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('fails when the page crashes', async () => {
    const page = new FakePage(LOGIN)
    onSleeps({ 1: () => page.crash() })
    await expect(watch(page)).rejects.toThrow(BROWSER_CRASHED_ERROR)
  })
})

describe('startLogin', () => {
  it('a job queued while clear but started while held fails with the hold text and opens no browser', async () => {
    const { withMlBrowser } = await import('./browser')
    startLogin()
    hold.current = { kind: 'vpn', text: 'VPN da empresa conectada: desconecte para rodar', reason: 'VPN conectada' }
    await runQueuedJob()
    expect(loginStatus()).toEqual({ state: 'failed', error: 'VPN da empresa conectada: desconecte para rodar' })
    expect(withMlBrowser).not.toHaveBeenCalled()
    expect(startRun).not.toHaveBeenCalled()
  })

  it('is a no-op while queued or waiting', async () => {
    const page = new FakePage(ML_LOGIN_URL)
    const navigation = Promise.withResolvers<void>()
    page.goto.mockReturnValueOnce(navigation.promise)
    browser.page = page

    startLogin()
    expect(loginStatus().state).toBe('queued')
    startLogin()
    expect(serialized).toHaveBeenCalledTimes(1)

    const run = runQueuedJob()
    await vi.waitFor(() => expect(loginStatus().state).toBe('waiting'))
    startLogin()
    expect(serialized).toHaveBeenCalledTimes(1)

    navigation.resolve()
    await run
    expect(loginStatus()).toEqual({ state: 'logged_in', error: null })
    expect(page.listenerCount()).toBe(0)
  })

  it('records a login run and finishes it with the final outcome', async () => {
    const page = new FakePage(ML_LOGIN_URL)
    expect(await runLogin(page)).toEqual({ state: 'logged_in', error: null })
    expect(startRun).toHaveBeenCalledWith('login')
    expect(finishRun).toHaveBeenCalledWith('login-run', { status: 'logged_in', pages: 0, counts: {}, error: undefined })
  })

  it('finishes the run as failed with the error text stripped of any query string', async () => {
    const page = new FakePage(ML_LOGIN_URL)
    page.goto.mockRejectedValueOnce(new Error('net::ERR_FAILED at https://www.mercadolivre.com.br/x?code=SECRET\nCall log'))
    await runLogin(page)
    expect(finishRun).toHaveBeenCalledWith('login-run', {
      status: 'failed', pages: 0, counts: {}, error: 'net::ERR_FAILED at https://www.mercadolivre.com.br/x',
    })
  })

  it('still opens the window when the run cannot be recorded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(startRun).mockRejectedValueOnce(new Error('db down'))
    const page = new FakePage(ML_LOGIN_URL)
    expect(await runLogin(page)).toEqual({ state: 'logged_in', error: null })
    expect(finishRun).not.toHaveBeenCalled()
  })

  it('stores only the first line of an error', async () => {
    const page = new FakePage(ML_LOGIN_URL)
    page.goto.mockRejectedValueOnce(new Error('net::ERR_FAILED\nCall log:\n  - navigating'))
    expect(await runLogin(page)).toEqual({ state: 'failed', error: 'net::ERR_FAILED' })
  })

  it('stops at the observed refusal without navigating again', async () => {
    const page = new FakePage(ML_LOGIN_URL)
    page.goto.mockImplementationOnce(async () => { page.href = LOGIN })
    onSleeps({ 3: () => { page.href = REFUSAL_PAGE }, 4: () => { page.href = HOME } })
    expect(await runLogin(page)).toEqual({ state: 'refused', error: null })
    expect(page.goto).toHaveBeenCalledTimes(1)
  })

  it('reports refused when the first navigation redirects through the refusal page to home', async () => {
    const page = new FakePage(ML_LOGIN_URL)
    page.goto.mockImplementationOnce(async () => {
      page.request(REFUSAL_PAGE)
      page.navigate(HOME)
    })
    expect(await runLogin(page)).toEqual({ state: 'refused', error: null })
    expect(page.goto).toHaveBeenCalledTimes(1)
  })

  it('reports refused when the first navigation fails after a refusal', async () => {
    const page = new FakePage(ML_LOGIN_URL)
    page.goto.mockImplementationOnce(async () => {
      page.request(REFUSAL_PAGE)
      throw new Error('net::ERR_ABORTED')
    })
    expect(await runLogin(page)).toEqual({ state: 'refused', error: null })
    expect(page.goto).toHaveBeenCalledTimes(1)
  })

  it('reports timed_out when the window closes during the first navigation', async () => {
    const page = new FakePage(LOGIN)
    page.goto.mockImplementationOnce(async () => {
      page.closed = true
      throw new Error(CLOSED_ERROR)
    })
    expect(await runLogin(page)).toEqual({ state: 'timed_out', error: null })
  })
})
