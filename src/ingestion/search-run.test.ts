import { beforeEach, expect, test, vi } from 'vitest'
import { holdStop, RunStop } from './errors'
import { runningKinds } from './recorded-run'
import { activeBuscas, buscaActivity, recordSearchRun, requestBuscaRun } from './search-run'

const { getSearch, markUnreadTried, lastStatusRun, startRun, finishRun, runBuscasOn, withMlBrowser } = vi.hoisted(() => ({
  getSearch: vi.fn(), markUnreadTried: vi.fn(), lastStatusRun: vi.fn(), startRun: vi.fn(), finishRun: vi.fn(), runBuscasOn: vi.fn(), withMlBrowser: vi.fn(),
}))
vi.mock('@/db/searches', () => ({ getSearch, markUnreadTried }))
vi.mock('@/db/runs', () => ({ lastStatusRun, startRun, finishRun }))
vi.mock('./steps/buscas', () => ({ runBuscasOn }))
vi.mock('./browser', () => ({ withMlBrowser }))
vi.mock('./request-hold', () => ({ mlHoldCheck: vi.fn(async () => null) }))
vi.mock('./after-run', () => ({ afterRun: vi.fn() }))

const ID = 'busca-1'
const fakePage = { on: vi.fn() }
const step = (statuses: string[], lastError: string | null = null) => ({
  counts: { buscaReads: statuses.length },
  failed: statuses.filter((s) => s !== 'ok').length,
  lastError,
  outcomes: statuses.map((status) => ({ id: ID, status, error: null })),
})

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.__promoRunChain = undefined
  globalThis.__promoBuscaJobs = undefined
  getSearch.mockResolvedValue({ id: ID, lastRunAt: null, enabled: true })
  lastStatusRun.mockResolvedValue(undefined)
  startRun.mockResolvedValue({ id: 'run-1' })
  finishRun.mockImplementation(async (_id, result) => ({ id: 'run-1', ...result }))
  withMlBrowser.mockImplementation((_mode, fn) => fn(fakePage))
  runBuscasOn.mockResolvedValue(step(['ok']))
})

test('a run writes a search run row with the Busca outcome', async () => {
  expect(await requestBuscaRun(ID)).toMatchObject({ status: 'ok', counts: { buscaReads: 1 } })
  expect(startRun).toHaveBeenCalledWith('search')
})

test('a manual run reads a disabled Busca', async () => {
  const disabled = { id: ID, lastRunAt: null, enabled: false }
  getSearch.mockResolvedValue(disabled)
  await requestBuscaRun(ID)
  expect(runBuscasOn).toHaveBeenCalledWith(fakePage, [disabled], expect.any(Date), expect.any(Object))
})

test('a second request while one is queued or running shares it, and the phase clears afterwards', async () => {
  const first = requestBuscaRun(ID)
  expect(buscaActivity(ID)).toEqual({ phase: 'queued' })
  const second = requestBuscaRun(ID)
  expect(second).toBe(first)
  await first
  expect(runBuscasOn).toHaveBeenCalledTimes(1)
  expect(buscaActivity(ID)).toEqual({ phase: 'idle' })
})

test('runs of different Buscas never overlap in the browser', async () => {
  let open = 0
  let peak = 0
  withMlBrowser.mockImplementation(async (_mode, fn) => {
    open += 1
    peak = Math.max(peak, open)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const result = await fn(fakePage)
    open -= 1
    return result
  })
  await Promise.all([requestBuscaRun('a'), requestBuscaRun('b')])
  expect(peak).toBe(1)
})

test('a Busca read by a cycle after the request is not read again', async () => {
  getSearch.mockResolvedValue({ id: ID, lastRunAt: new Date(Date.now() + 60_000) })
  expect(await requestBuscaRun(ID)).toBeNull()
  expect(startRun).not.toHaveBeenCalled()
})

test('a deleted Busca is a no-op', async () => {
  getSearch.mockResolvedValue(undefined)
  expect(await requestBuscaRun(ID)).toBeNull()
  expect(startRun).not.toHaveBeenCalled()
})

test.each([['cycle'], ['search']])('a %s run that stopped after the request makes the queued run skip', async (kind) => {
  lastStatusRun.mockImplementation(async (k: string) => (
    k === kind ? { status: 'blocked', finishedAt: new Date(Date.now() + 60_000) } : undefined
  ))
  expect(await requestBuscaRun(ID)).toBeNull()
  expect(startRun).not.toHaveBeenCalled()
})

test('a stop that finished before the request does not skip it', async () => {
  lastStatusRun.mockResolvedValue({ status: 'blocked', finishedAt: new Date(Date.now() - 60_000) })
  expect(await requestBuscaRun(ID)).toMatchObject({ status: 'ok' })
})

test('a stop becomes the run status and the error is redacted', async () => {
  runBuscasOn.mockRejectedValue(new RunStop('blocked', 'wall https://a.com/x?token=SECRET'))
  expect(await requestBuscaRun(ID)).toMatchObject({ status: 'blocked', error: 'wall https://a.com/x' })
})

test.each([
  [[], 'ok'], [['ok', 'ok'], 'ok'], [['failed'], 'failed'], [['failed', 'failed'], 'failed'],
  [['ok', 'partial'], 'partial'], [['ok', 'failed'], 'partial'], [['partial'], 'partial'],
])('a scheduled run of outcomes %j has status %s', async (statuses, expected) => {
  runBuscasOn.mockResolvedValue(step(statuses, statuses.length > 0 && expected !== 'ok' ? 'oops' : null))
  const run = await recordSearchRun((page, now) => runBuscasOn(page, [], now))
  expect(run).toMatchObject({ status: expected, error: expected === 'ok' ? undefined : 'oops' })
})

test('activeBuscas lists a queued Busca and is empty once it settles', async () => {
  const done = requestBuscaRun(ID)
  expect(activeBuscas()).toEqual({ [ID]: { phase: 'queued' } })
  await done
  expect(activeBuscas()).toEqual({})
})

test('the running kind is cleared when startRun rejects', async () => {
  startRun.mockRejectedValue(new Error('db down'))
  await expect(recordSearchRun(runBuscasOn)).rejects.toThrow('db down')
  expect(runningKinds().size).toBe(0)
})

test('the running kind is cleared when finishRun rejects', async () => {
  finishRun.mockRejectedValue(new Error('db down'))
  await expect(recordSearchRun(runBuscasOn)).rejects.toThrow('db down')
  expect(runningKinds().size).toBe(0)
})

test('a run that fails before reading records the Busca as tried, so the cooldown applies', async () => {
  withMlBrowser.mockRejectedValue(new Error('chrome did not start'))
  const run = await requestBuscaRun(ID)
  expect(run).toMatchObject({ status: 'failed' })
  expect(markUnreadTried).toHaveBeenCalledWith([ID], 'failed', 'chrome did not start')
})

test('a run that read its Busca records nothing extra', async () => {
  await requestBuscaRun(ID)
  expect(markUnreadTried).not.toHaveBeenCalled()
})

test('a stopped run records the unread Busca with the stop status, not failed', async () => {
  runBuscasOn.mockRejectedValue(new RunStop('blocked', 'bloqueado'))
  await requestBuscaRun(ID)
  expect(markUnreadTried).toHaveBeenCalledWith([ID], 'blocked', 'bloqueado')
})

test('a run stopped by a hold is not marked as an unread attempt', async () => {
  runBuscasOn.mockRejectedValue(holdStop({ kind: 'vpn', text: 't', reason: 'VPN conectada' }))
  const run = await requestBuscaRun(ID)
  expect(run).toMatchObject({ status: 'partial', error: 'VPN conectada', counts: { held: 1 } })
  expect(markUnreadTried).not.toHaveBeenCalled()
})

test('a database error mid-run still marks the Busca and the original error is kept', async () => {
  finishRun.mockRejectedValue(new Error('db down'))
  await expect(requestBuscaRun(ID)).rejects.toThrow('db down')
  expect(markUnreadTried).toHaveBeenCalledWith([ID], 'failed', expect.any(String))
})

test('an error from the marking itself is logged and does not mask anything', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  markUnreadTried.mockRejectedValue(new Error('marking failed'))
  withMlBrowser.mockRejectedValue(new Error('chrome did not start'))
  expect(await requestBuscaRun(ID)).toMatchObject({ status: 'failed' })
  expect(log).toHaveBeenCalled()
  log.mockRestore()
})
