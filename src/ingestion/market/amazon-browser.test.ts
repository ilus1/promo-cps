import { beforeEach, expect, test, vi } from 'vitest'

const { launchChrome, startXvfb, closeWithin, killProfileBrowser, mkdir } = vi.hoisted(() => ({
  launchChrome: vi.fn(),
  startXvfb: vi.fn(),
  closeWithin: vi.fn(),
  killProfileBrowser: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ mkdir }))
vi.mock('@/env', () => ({ env: () => ({ ML_PROFILE_DIR: '/home/u/.promo/ml-profile' }) }))
vi.mock('../browser-launch', () => ({ launchChrome }))
vi.mock('../xvfb', () => ({ startXvfb }))
vi.mock('../browser-close', () => ({ closeWithin, killProfileBrowser }))

import { AMAZON_SESSION_DEADLINE_MS } from '@/lib/constants'
import { amazonPageLoader, amazonProfileDir, withAmazonBrowser } from './amazon-browser'

const AMAZON_PROFILE = '/home/u/.promo/amazon-profile'
const XVFB = { display: ':98', stop: vi.fn(async () => undefined) }

function fakePage(over: Record<string, unknown> = {}) {
  return {
    goto: vi.fn(async () => ({ status: () => 200 })),
    content: vi.fn(async () => '<html>ok</html>'),
    mouse: { wheel: vi.fn(async () => undefined) },
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => true),
    isClosed: () => false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  startXvfb.mockResolvedValue(XVFB)
  closeWithin.mockImplementation(async (target: { close: () => Promise<void> }) => {
    await target.close()
    return true
  })
})

test('the Amazon profile sits next to the ML profile, never inside it', () => {
  expect(amazonProfileDir('/home/u/.promo/ml-profile')).toBe(AMAZON_PROFILE)
  expect(amazonProfileDir()).toBe(AMAZON_PROFILE)
})

test('an ML profile already named amazon-profile is refused rather than shared', () => {
  expect(() => amazonProfileDir('/home/u/.promo/amazon-profile')).toThrow('o perfil da Amazon seria o perfil do ML')
  expect(() => amazonProfileDir('/home/u/.promo/amazon-profile/')).toThrow('o perfil da Amazon seria o perfil do ML')
})

test('a session launches the shared Chrome on its own Xvfb with the Amazon profile, then closes both', async () => {
  const page = fakePage()
  const close = vi.fn(async () => undefined)
  launchChrome.mockResolvedValue({ pages: () => [page], newPage: vi.fn(), close })
  expect(await withAmazonBrowser(async (p) => p === (page as unknown))).toBe(true)
  expect(mkdir).toHaveBeenCalledWith(AMAZON_PROFILE, { recursive: true })
  expect(launchChrome).toHaveBeenCalledWith(AMAZON_PROFILE, XVFB)
  expect(close).toHaveBeenCalled()
  expect(XVFB.stop).toHaveBeenCalled()
})

test('the session reads as open until the browser is closed, and closed from then on', async () => {
  const page = fakePage({ isClosed: () => false })
  launchChrome.mockResolvedValue({ pages: () => [page], newPage: vi.fn(), close: vi.fn(async () => undefined) })
  let isOpen: () => boolean = () => true
  await withAmazonBrowser(async (_page, open) => {
    isOpen = open
    expect(open()).toBe(true)
  })
  expect(isOpen()).toBe(false)
})

test('a session that passes its deadline is closed before its work can go on', async () => {
  vi.useFakeTimers()
  const page = fakePage({ isClosed: () => false })
  launchChrome.mockResolvedValue({ pages: () => [page], newPage: vi.fn(), close: vi.fn(async () => undefined) })
  let isOpen: () => boolean = () => true
  const session = withAmazonBrowser((_page, open) => {
    isOpen = open
    return new Promise<never>(() => undefined)
  })
  const settled = expect(session).rejects.toThrow('a sessão da Amazon passou do tempo limite')
  await vi.advanceTimersByTimeAsync(AMAZON_SESSION_DEADLINE_MS)
  await settled
  expect(isOpen()).toBe(false)
  vi.useRealTimers()
})

test('a hung close kills only the Amazon profile browser', async () => {
  launchChrome.mockResolvedValue({ pages: () => [fakePage()], newPage: vi.fn(), close: vi.fn() })
  closeWithin.mockImplementation(async (target: { kill: () => Promise<void> }) => {
    await target.kill()
    return false
  })
  await withAmazonBrowser(async () => undefined)
  expect(killProfileBrowser).toHaveBeenCalledWith(AMAZON_PROFILE)
})

test('a failed launch stops the Xvfb display and rethrows', async () => {
  launchChrome.mockRejectedValue(new Error('SingletonLock'))
  await expect(withAmazonBrowser(async () => undefined)).rejects.toThrow('SingletonLock')
  expect(XVFB.stop).toHaveBeenCalled()
})

test('the loader returns the status and the page content, scrolling first when asked', async () => {
  const page = fakePage()
  const load = amazonPageLoader(page as never)
  expect(await load('https://www.amazon.com.br/s?k=a55', false)).toEqual({ status: 200, html: '<html>ok</html>' })
  expect(page.mouse.wheel).not.toHaveBeenCalled()
  await load('https://www.amazon.com.br/gp/bestsellers/electronics', true)
  expect(page.mouse.wheel).toHaveBeenCalledTimes(1)
  expect(page.goto).toHaveBeenCalledWith('https://www.amazon.com.br/gp/bestsellers/electronics', expect.objectContaining({ waitUntil: 'domcontentloaded' }))
})

test('a navigation on a closed page rejects instead of reading as an unknown page', async () => {
  const page = fakePage({ isClosed: () => true, goto: vi.fn(async () => { throw new Error('Target page, context or browser has been closed') }) })
  await expect(amazonPageLoader(page as never)('https://www.amazon.com.br/s?k=a55', false)).rejects.toThrow('has been closed')
})

test('a failed navigation gives status 0 and the reason', async () => {
  const page = fakePage({ goto: vi.fn(async () => { throw new Error('net::ERR_TIMED_OUT at https://www.amazon.com.br/s?k=a55\ncall log') }) })
  expect(await amazonPageLoader(page as never)('https://www.amazon.com.br/s?k=a55', false))
    .toEqual({ status: 0, html: '', reason: 'net::ERR_TIMED_OUT at https://www.amazon.com.br/s?k=a55' })
})
