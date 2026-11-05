import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { checkItemsByIds, keyItems, targetItemIds } from '@/db/match-targets'
import { saveChecks, type PriceCheckRow } from '@/db/price-checks'
import { HOUR_MS, MARKET_REMATCH_HOURS } from '@/lib/constants'
import { checkKey, type CheckItem } from '@/lib/price-check-rules'
import { localMatchRow } from './match-local'
import { REMATCH_BATCH, REMATCH_BOOT_DELAY_MS, rematchItems, rematchKeys, rematchLine, rematchTargets, requestRematch, startRematchLoop } from './rematch'

vi.mock('@/db/match-targets', () => ({ checkItemsByIds: vi.fn(), keyItems: vi.fn(), targetItemIds: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/db/price-checks', () => ({ saveCheck: vi.fn(), saveChecks: vi.fn() }))
vi.mock('./match-local', async (original) => ({ ...(await original<object>()), localMatchRow: vi.fn() }))

const NOW = new Date('2026-11-04T12:00:00Z')
const item = (id: string, productId: string | null = null): CheckItem => ({ id, productId, title: id, finalCents: 1000, showsSaving: true })

beforeEach(() => {
  globalThis.__promoRematch = undefined
  vi.mocked(localMatchRow).mockReset().mockImplementation(async (target) => (
    { key: checkKey(target), status: target.id.startsWith('m') ? 'matched' : 'no_match' } as PriceCheckRow
  ))
  vi.mocked(saveChecks).mockReset().mockResolvedValue(undefined)
  vi.mocked(targetItemIds).mockReset().mockResolvedValue([])
  vi.mocked(checkItemsByIds).mockReset().mockImplementation(async (ids) => ids.map((id) => item(id)))
  vi.mocked(keyItems).mockReset().mockResolvedValue([])
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  clearTimeout(globalThis.__promoRematch?.bootTimer)
  clearInterval(globalThis.__promoRematch?.timer)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('items are matched once per check key, saved in one write, and the matches are counted', async () => {
  const summary = await rematchItems([item('m1', 'MLB1'), item('x2', 'MLB1'), item('x3'), item('m4')], NOW)
  expect(summary).toEqual({ checked: 3, matched: 2 })
  expect(vi.mocked(localMatchRow).mock.calls.map(([target, at]) => [target.id, at])).toEqual([['m1', NOW], ['x3', NOW], ['m4', NOW]])
  expect(saveChecks).toHaveBeenCalledTimes(1)
  expect(vi.mocked(saveChecks).mock.calls[0][0].map((row) => row.key)).toEqual(['MLB1', 'item:x3', 'item:m4'])
})

test('re-matching keys reads their items, and no keys reads nothing', async () => {
  expect(await rematchKeys([], NOW)).toEqual({ checked: 0, matched: 0 })
  expect(keyItems).not.toHaveBeenCalled()
  vi.mocked(keyItems).mockResolvedValue([item('m1', 'MLB1')])
  expect(await rematchKeys(['MLB1'], NOW)).toEqual({ checked: 1, matched: 1 })
  expect(keyItems).toHaveBeenCalledWith(['MLB1'], NOW)
})

test('a full pass reads the targets in batches and yields to the event loop after each one', async () => {
  const ids = Array.from({ length: REMATCH_BATCH * 2 + 1 }, (_, index) => `${index % 2 === 0 ? 'm' : 'x'}${index}`)
  vi.mocked(targetItemIds).mockResolvedValue(ids)
  const yields = vi.spyOn(globalThis, 'setImmediate')
  expect(await rematchTargets(NOW)).toEqual({ checked: ids.length, matched: REMATCH_BATCH + 1 })
  expect(vi.mocked(checkItemsByIds).mock.calls.map(([batch]) => batch.length)).toEqual([REMATCH_BATCH, REMATCH_BATCH, 1])
  expect(vi.mocked(saveChecks).mock.calls.map(([rows]) => rows.length)).toEqual([REMATCH_BATCH, REMATCH_BATCH, 1])
  expect(yields).toHaveBeenCalledTimes(3)
})

test('a failing batch is logged and the pass goes on with the next one', async () => {
  vi.mocked(targetItemIds).mockResolvedValue(Array.from({ length: REMATCH_BATCH * 2 + 1 }, (_, index) => `m${index}`))
  vi.mocked(saveChecks).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('db down\nstack'))
  expect(await rematchTargets(NOW)).toEqual({ checked: REMATCH_BATCH + 1, matched: REMATCH_BATCH + 1 })
  expect(console.error).toHaveBeenCalledWith('[market]', 'rematch batch failed:', 'db down')
  expect(checkItemsByIds).toHaveBeenCalledTimes(3)
})

test('a failed query logs the Postgres cause and its code, not the query wrapper', async () => {
  vi.mocked(targetItemIds).mockResolvedValue(['m1'])
  const cause = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
  vi.mocked(saveChecks).mockRejectedValueOnce(new Error('Failed query: insert into "price_checks" ...', { cause }))
  await rematchTargets(NOW)
  expect(console.error).toHaveBeenCalledWith('[market]', 'rematch batch failed:', 'canceling statement due to lock timeout (55P03)')
})

test('the log line names what was checked and matched', () => {
  expect(rematchLine({ checked: 10, matched: 4 })).toBe('[market] rematch: 10 verificados, 4 com equivalente')
})

test('requests during a pass are coalesced into one more pass after it', async () => {
  let release: () => void = () => undefined
  vi.mocked(targetItemIds).mockImplementationOnce(() => new Promise((resolve) => {
    release = () => resolve([])
  }))
  requestRematch()
  requestRematch()
  requestRematch()
  expect(targetItemIds).toHaveBeenCalledTimes(1)
  release()
  await vi.waitFor(() => expect(console.log).toHaveBeenCalledTimes(2))
  expect(targetItemIds).toHaveBeenCalledTimes(2)
  expect(globalThis.__promoRematch?.running).toBe(false)
})

test('a failed pass is logged and the next request runs again', async () => {
  vi.mocked(targetItemIds).mockRejectedValueOnce(new Error('db down\nstack'))
  requestRematch()
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('[market]', 'rematch failed:', 'db down'))
  await vi.waitFor(() => expect(globalThis.__promoRematch?.running).toBe(false))
  requestRematch()
  await vi.waitFor(() => expect(targetItemIds).toHaveBeenCalledTimes(2))
})

test('the loop runs a pass after the boot delay and then every rematch interval, and a restart replaces its timers', async () => {
  vi.useFakeTimers()
  startRematchLoop()
  startRematchLoop()
  await vi.advanceTimersByTimeAsync(REMATCH_BOOT_DELAY_MS - 1)
  expect(targetItemIds).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(targetItemIds).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(MARKET_REMATCH_HOURS * HOUR_MS - REMATCH_BOOT_DELAY_MS)
  expect(targetItemIds).toHaveBeenCalledTimes(2)
})
