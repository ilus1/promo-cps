import { beforeEach, expect, test, vi } from 'vitest'
import { HOLD_SETTINGS_CACHE_MS } from '@/lib/constants'

const mocks = vi.hoisted(() => ({ rows: [] as { key: string; value: boolean }[], selects: 0, inserts: [] as unknown[] }))

vi.mock('./client', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => { mocks.selects += 1; return mocks.rows } }) }),
    insert: () => ({
      values: (v: unknown) => ({ onConflictDoUpdate: async () => { mocks.inserts.push(v) } }),
    }),
  },
}))

import { readHoldSettings, setHoldSetting } from './app-settings'

beforeEach(async () => {
  globalThis.__promoHoldSettings = undefined
  mocks.rows = []
  mocks.selects = 0
  mocks.inserts = []
  await setHoldSetting('requests_paused', false)
  mocks.inserts = []
})

test('nothing stored means nothing is paused', async () => {
  expect(await readHoldSettings(1_000)).toEqual({ requestsPaused: false, priceChecksPaused: false })
})

test('each key maps to its own flag', async () => {
  mocks.rows = [{ key: 'price_checks_paused', value: true }, { key: 'requests_paused', value: false }]
  expect(await readHoldSettings(1_000)).toEqual({ requestsPaused: false, priceChecksPaused: true })
})

test('a non-true value is not paused', async () => {
  mocks.rows = [{ key: 'requests_paused', value: 'yes' as unknown as boolean }]
  expect((await readHoldSettings(1_000)).requestsPaused).toBe(false)
})

test('reads inside the cache window do not query again, and the window ends', async () => {
  await readHoldSettings(1_000)
  await readHoldSettings(1_000 + HOLD_SETTINGS_CACHE_MS - 1)
  expect(mocks.selects).toBe(1)
  await readHoldSettings(1_000 + HOLD_SETTINGS_CACHE_MS)
  expect(mocks.selects).toBe(2)
})

test('setting a value writes it and drops the cache so the next read is fresh', async () => {
  await readHoldSettings(1_000)
  mocks.rows = [{ key: 'requests_paused', value: true }]
  await setHoldSetting('requests_paused', true)
  expect(mocks.inserts).toEqual([{ key: 'requests_paused', value: true }])
  expect((await readHoldSettings(1_001)).requestsPaused).toBe(true)
})

test('the cache lives on globalThis, so another bundle sees a write', async () => {
  await readHoldSettings(1_000)
  expect(globalThis.__promoHoldSettings?.settings).toEqual({ requestsPaused: false, priceChecksPaused: false })
  await setHoldSetting('price_checks_paused', true)
  expect(globalThis.__promoHoldSettings).toBeUndefined()
})
