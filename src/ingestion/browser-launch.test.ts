import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const { launchPersistentContext, startXvfb, closeWithin, killProfileBrowser } = vi.hoisted(() => ({
  launchPersistentContext: vi.fn(),
  startXvfb: vi.fn(),
  closeWithin: vi.fn(),
  killProfileBrowser: vi.fn(),
}))
vi.mock('playwright', () => ({ chromium: { launchPersistentContext } }))
vi.mock('@/env', () => ({ ENV_KEYS: ['DATABASE_URL', 'ML_PROFILE_DIR'], env: () => ({ ML_PROFILE_DIR: '/home/u/.promo/ml-profile' }) }))
vi.mock('./xvfb', () => ({ SCREEN: { width: 1366, height: 768 }, startXvfb }))
vi.mock('./browser-close', () => ({ closeWithin, killProfileBrowser }))

import { withMlBrowser } from './browser'
import { launchChrome } from './browser-launch'

const XVFB = { display: ':99', stop: vi.fn(async () => undefined) }
const SHARED_OPTIONS = {
  channel: 'chrome',
  headless: false,
  locale: 'pt-BR',
  viewport: { width: 1366, height: 768 },
  ignoreDefaultArgs: ['--enable-automation'],
}

beforeEach(() => {
  vi.clearAllMocks()
  const page = {}
  launchPersistentContext.mockResolvedValue({ pages: () => [page], newPage: vi.fn(), close: vi.fn(async () => undefined) })
  startXvfb.mockResolvedValue(XVFB)
  closeWithin.mockResolvedValue(true)
  vi.stubEnv('DATABASE_URL', 'postgres://secret')
  vi.stubEnv('WAYLAND_DISPLAY', 'wayland-0')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('on Xvfb Chrome runs headed on its display, forced to X11, without the automation switch or flag', async () => {
  await launchChrome('/home/u/.promo/amazon-profile', XVFB)
  const [profileDir, options] = launchPersistentContext.mock.calls[0]
  expect(profileDir).toBe('/home/u/.promo/amazon-profile')
  expect(options).toMatchObject({ ...SHARED_OPTIONS, args: ['--disable-blink-features=AutomationControlled', '--ozone-platform=x11'] })
  expect(options.env.DISPLAY).toBe(':99')
  expect(options.env).not.toHaveProperty('WAYLAND_DISPLAY')
  expect(options.env).not.toHaveProperty('DATABASE_URL')
})

test('on the desktop it keeps the session display and only the automation flag', async () => {
  await launchChrome('/p', null)
  const [, options] = launchPersistentContext.mock.calls[0]
  expect(options).toMatchObject({ ...SHARED_OPTIONS, args: ['--disable-blink-features=AutomationControlled'] })
  expect(options.env.WAYLAND_DISPLAY).toBe('wayland-0')
  expect(options.env).not.toHaveProperty('DATABASE_URL')
})

test('the ML browser launches its own profile with the same options as before', async () => {
  await withMlBrowser('hidden', async () => undefined)
  const [profileDir, options] = launchPersistentContext.mock.calls[0]
  expect(profileDir).toBe('/home/u/.promo/ml-profile')
  expect(options).toMatchObject({ ...SHARED_OPTIONS, args: ['--disable-blink-features=AutomationControlled', '--ozone-platform=x11'] })
  expect(Object.keys(options).sort()).toEqual(['args', 'channel', 'env', 'headless', 'ignoreDefaultArgs', 'locale', 'viewport'])
  expect(XVFB.stop).toHaveBeenCalled()
})
