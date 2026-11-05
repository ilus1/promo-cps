import { beforeEach, describe, expect, test, vi } from 'vitest'
import { countEndingCandidates, endCouponsNotSeenSince } from '@/db/coupons'
import { LOAD_FAILURE_TEXT } from '@/lib/domain'
import { RunStop } from './errors'
import { pruneOld } from '@/db/prune'
import { finishRun, lastHealthNotifiedAt, lastRun, lastStatusRun, lastWorkedCycleRun, startRun } from '@/db/runs'
import { cycleActivity, requestCycle } from './cycle'
import { withMlBrowser } from './browser'
import { mlHoldCheck } from './request-hold'
import { activate } from './steps/activate'
import { runDueBuscas } from './steps/buscas'
import { discover } from './steps/discover'
import { harvest } from './steps/harvest'
import { serialized } from './run-chain'

const chain = vi.hoisted(() => ({ release: (() => undefined) as () => void }))

vi.mock('@/db/coupons', () => ({ endCouponsNotSeenSince: vi.fn(), countEndingCandidates: vi.fn() }))
vi.mock('@/db/runs', () => ({
  lastRun: vi.fn(), lastStatusRun: vi.fn(), startRun: vi.fn(), finishRun: vi.fn(), lastWorkedCycleRun: vi.fn(), lastHealthNotifiedAt: vi.fn(),
}))
vi.mock('@/db/prune', () => ({ pruneOld: vi.fn() }))
vi.mock('@/env', () => ({ env: () => ({ ACTIVATE_PER_RUN: 20, DISCOVERY_PAGES_PER_RUN: 300, RUN_EVERY_HOURS: 3 }) }))
vi.mock('./browser', () => ({ withMlBrowser: vi.fn() }))
vi.mock('./request-hold', () => ({ mlHoldCheck: vi.fn(async () => null) }))
vi.mock('./after-run', () => ({ afterRun: vi.fn() }))
vi.mock('./steps/activate', () => ({ activate: vi.fn() }))
vi.mock('./steps/buscas', () => ({ runDueBuscas: vi.fn() }))
vi.mock('./steps/discover', () => ({ discover: vi.fn() }))
vi.mock('./steps/harvest', () => ({ harvest: vi.fn() }))
vi.mock('./run-chain', () => ({
  serialized: vi.fn((job: () => Promise<unknown>) => new Promise<void>((resolve) => {
    chain.release = resolve
  }).then(job)),
}))

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.__promoCycle = undefined
  vi.mocked(lastRun).mockResolvedValue(undefined)
  vi.mocked(lastWorkedCycleRun).mockResolvedValue(undefined)
  vi.mocked(lastHealthNotifiedAt).mockResolvedValue(null)
  vi.mocked(pruneOld).mockResolvedValue({ items: 0, coupons: 0, runs: 0, priceChecks: 0, marketOffers: 0 })
})

test('a second request while one is queued or running returns the same promise and queues nothing', async () => {
  vi.mocked(startRun).mockRejectedValue(new Error('db down'))
  const first = requestCycle()
  const second = requestCycle()
  expect(second).toBe(first)
  expect(serialized).toHaveBeenCalledTimes(1)
  expect(cycleActivity()).toEqual({ phase: 'queued' })
  vi.mocked(startRun).mockImplementationOnce(async () => {
    expect(cycleActivity()).toEqual({ phase: 'running' })
    throw new Error('db down')
  })
  chain.release()
  await expect(first).rejects.toThrow('db down')
  expect(cycleActivity()).toEqual({ phase: 'idle' })
})

test('the flag resets after a failed cycle so the next request starts a new one', async () => {
  vi.mocked(startRun).mockRejectedValue(new Error('db down'))
  const first = requestCycle()
  chain.release()
  await first.catch(() => undefined)
  const next = requestCycle()
  expect(next).not.toBe(first)
  expect(serialized).toHaveBeenCalledTimes(2)
  chain.release()
  await next.catch(() => undefined)
})

describe('the cycle with Buscas', () => {
  const FULL_HARVEST = {
    allPagesLoaded: true, seen: 5, inserted: 1, skipped: 0, unparsed: 0, totalCoupons: 5, failedPages: 0,
    couponPages: [], lastError: null,
  }
  const DISCOVERY = {
    pages: 3, read: 3, items: 90, failed: 0, empty: 0, couponLinks: 9, cards: 90, basisOther: 0, droppedCards: 0, itemIds: [], lastError: null,
  }
  const BUSCAS = {
    counts: { buscaReads: 2, buscaPages: 40, buscaItems: 7, buscaFailed: 0, buscaDropped: 0 },
    failed: 0, lastError: null as string | null, outcomes: [],
  }

  async function runWith(buscas: typeof BUSCAS, discovered: object = DISCOVERY, harvested: object = FULL_HARVEST) {
    vi.mocked(startRun).mockResolvedValue({ id: 'run-1' } as never)
    vi.mocked(finishRun).mockImplementation(async (_id, result) => ({ id: 'run-1', ...result }) as never)
    vi.mocked(withMlBrowser).mockImplementation((async (_mode: string, fn: (page: unknown) => unknown) => fn({ on: vi.fn() })) as never)
    vi.mocked(harvest).mockResolvedValue(harvested as never)
    vi.mocked(activate).mockResolvedValue({ activated: 0, failed: 0, skipped: 0 } as never)
    vi.mocked(runDueBuscas).mockResolvedValue(buscas as never)
    vi.mocked(discover).mockResolvedValue(discovered as never)
    const run = requestCycle()
    chain.release()
    const finished = await run
    if (!finished) throw new Error('cycle skipped')
    return finished
  }

  test('merges the Busca counts into the cycle counts and shrinks the discovery budget by the Busca pages', async () => {
    const run = await runWith(BUSCAS)
    expect(run.counts).toMatchObject(BUSCAS.counts)
    expect(run).toMatchObject({ status: 'ok' })
    expect(vi.mocked(discover).mock.calls[0][1]).toBe(300 - 40)
  })

  test('an empty listing is counted on its own and does not make the cycle partial', async () => {
    const run = await runWith(BUSCAS, { ...DISCOVERY, pages: 30, read: 29, items: 900, cards: 900, empty: 1, couponLinks: 9 })
    expect(run).toMatchObject({ status: 'ok' })
    expect(run.counts).toMatchObject({ discoveryEmpty: 1, discoveryRead: 29, discoveryLinks: 9 })
  })

  test('a healthy cycle stores no warnings and asks for no notification', async () => {
    const run = await runWith(BUSCAS)
    expect(run.counts).toMatchObject({ health: 0, healthNotify: 0 })
  })

  test('a changed reader stores the warning mask and asks for a notification once', async () => {
    const run = await runWith(BUSCAS, DISCOVERY, { ...FULL_HARVEST, skipped: 2 })
    expect(run.counts.health).toBeGreaterThan(0)
    expect(run.counts.healthNotify).toBe(1)
    vi.mocked(lastWorkedCycleRun).mockResolvedValue({ counts: { health: run.counts.health } } as never)
    vi.mocked(lastHealthNotifiedAt).mockResolvedValue(new Date())
    globalThis.__promoCycle = undefined
    const again = await runWith(BUSCAS, DISCOVERY, { ...FULL_HARVEST, skipped: 2 })
    expect(again.counts).toMatchObject({ health: run.counts.health, healthNotify: 0 })
  })

  test('prunes after the run is finished, and a failing prune does not fail the cycle', async () => {
    vi.mocked(pruneOld).mockRejectedValue(new Error('db down'))
    const run = await runWith(BUSCAS)
    expect(run.status).toBe('ok')
    expect(pruneOld).toHaveBeenCalledTimes(1)
    expect(vi.mocked(finishRun).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(pruneOld).mock.invocationCallOrder[0])
  })

  test('failed Buscas make the cycle partial and surface their last error', async () => {
    const run = await runWith({ ...BUSCAS, failed: 1, lastError: 'busca falhou' })
    expect(run).toMatchObject({ status: 'partial', error: 'busca falhou' })
  })

  test('Busca pages beyond the discovery allowance leave discovery with zero pages', async () => {
    await runWith({ ...BUSCAS, counts: { ...BUSCAS.counts, buscaPages: 400 } })
    expect(vi.mocked(discover).mock.calls[0][1]).toBe(0)
  })

  test('a discovery error wins over a Busca error in the partial reason', async () => {
    const run = await runWith({ ...BUSCAS, failed: 1, lastError: 'busca falhou' }, { ...DISCOVERY, failed: 1, lastError: 'listagem falhou' })
    expect(run).toMatchObject({ status: 'partial', error: 'listagem falhou' })
  })

  test('one load breaker is shared by the harvest, the activation, the Buscas and the discovery', async () => {
    await runWith(BUSCAS)
    const breaker = vi.mocked(harvest).mock.calls[0][1]
    expect(breaker).toBeDefined()
    expect(vi.mocked(activate).mock.calls[0][4]).toBe(breaker)
    expect(vi.mocked(runDueBuscas).mock.calls[0][2]).toBe(breaker)
    expect(vi.mocked(discover).mock.calls[0][3]).toBe(breaker)
  })

  test('activation gets its limit when the harvest saw coupons and none when it saw zero', async () => {
    await runWith(BUSCAS)
    expect(vi.mocked(activate).mock.calls[0][1]).toBe(20)
    vi.mocked(activate).mockClear()
    globalThis.__promoCycle = undefined
    await runWith(BUSCAS, DISCOVERY, { ...FULL_HARVEST, seen: 0, totalCoupons: 0 })
    expect(vi.mocked(activate).mock.calls[0][1]).toBe(0)
  })
})

describe('ending vanished coupons', () => {
  const FULL = {
    allPagesLoaded: true, seen: 2000, inserted: 0, skipped: 0, unparsed: 0, totalCoupons: 2000, failedPages: 0,
    couponPages: [], lastError: null,
  }
  const PREVIOUS = { startedAt: new Date('2026-11-03T04:00:00Z'), counts: { fullHarvest: 1 } }
  const NO_BUSCAS = { counts: {}, failed: 0, lastError: null, outcomes: [] }
  const DISCOVERY = {
    pages: 0, read: 0, items: 0, failed: 0, empty: 0, couponLinks: 0, cards: 0, basisOther: 0, droppedCards: 0, itemIds: [], lastError: null,
  }

  async function cycle(harvested: object, endable: number, previous: object = PREVIOUS) {
    vi.mocked(lastRun).mockResolvedValue(previous as never)
    vi.mocked(countEndingCandidates).mockResolvedValue({ endable, live: 2000 })
    vi.mocked(endCouponsNotSeenSince).mockResolvedValue(endable)
    vi.mocked(startRun).mockResolvedValue({ id: 'run-1' } as never)
    vi.mocked(finishRun).mockImplementation(async (_id, result) => ({ id: 'run-1', ...result }) as never)
    vi.mocked(withMlBrowser).mockImplementation((async (_mode: string, fn: (page: unknown) => unknown) => fn({ on: vi.fn() })) as never)
    vi.mocked(harvest).mockResolvedValue(harvested as never)
    vi.mocked(activate).mockResolvedValue({ activated: 0, failed: 0, skipped: 0 } as never)
    vi.mocked(runDueBuscas).mockResolvedValue(NO_BUSCAS as never)
    vi.mocked(discover).mockResolvedValue(DISCOVERY as never)
    const run = requestCycle()
    chain.release()
    const finished = await run
    if (!finished) throw new Error('cycle skipped')
    return finished
  }

  test('a normal ending goes through', async () => {
    const run = await cycle(FULL, 20)
    expect(endCouponsNotSeenSince).toHaveBeenCalledTimes(1)
    expect(run).toMatchObject({ status: 'ok', error: undefined, counts: { ended: 20 } })
    expect(run.counts).not.toHaveProperty('endingRefused')
  })

  test('a mass ending is refused: nothing ends, the count and the reason are recorded', async () => {
    const run = await cycle(FULL, 1500)
    expect(endCouponsNotSeenSince).not.toHaveBeenCalled()
    expect(run.counts).toMatchObject({ ended: 0, endingRefused: 1500 })
    expect(run.error).toContain('1500')
  })

  test('a repeated mass disappearance is confirmed and ends, while a different count is refused again', async () => {
    const refusedBefore = { ...PREVIOUS, counts: { fullHarvest: 1, endingRefused: 1500 } }
    const confirmed = await cycle(FULL, 1550, refusedBefore)
    expect(endCouponsNotSeenSince).toHaveBeenCalledTimes(1)
    expect(confirmed.counts).toMatchObject({ ended: 1550 })
    vi.mocked(endCouponsNotSeenSince).mockClear()
    globalThis.__promoCycle = undefined
    const again = await cycle(FULL, 200, refusedBefore)
    expect(endCouponsNotSeenSince).not.toHaveBeenCalled()
    expect(again.counts).toMatchObject({ ended: 0, endingRefused: 200 })
  })

  test('an all-skipped harvest is not full, so nothing is counted or ended', async () => {
    const run = await cycle({ ...FULL, allPagesLoaded: false, seen: 0, skipped: 2000 }, 2000)
    expect(countEndingCandidates).not.toHaveBeenCalled()
    expect(endCouponsNotSeenSince).not.toHaveBeenCalled()
    expect(run).toMatchObject({ status: 'partial', counts: { ended: 0, fullHarvest: 0 } })
  })

  test('a tripped load breaker ends the run failed with the load failure text', async () => {
    vi.mocked(lastRun).mockResolvedValue(undefined)
    vi.mocked(startRun).mockResolvedValue({ id: 'run-1' } as never)
    vi.mocked(finishRun).mockImplementation(async (_id, result) => ({ id: 'run-1', ...result }) as never)
    vi.mocked(withMlBrowser).mockImplementation((async (_mode: string, fn: (page: unknown) => unknown) => fn({ on: vi.fn() })) as never)
    vi.mocked(harvest).mockRejectedValue(new RunStop('failed', `${LOAD_FAILURE_TEXT}: net::ERR_TIMED_OUT`, { counts: { loadBreaker: 1 } }))
    const run = requestCycle()
    chain.release()
    expect(await run).toMatchObject({ status: 'failed', error: `${LOAD_FAILURE_TEXT}: net::ERR_TIMED_OUT`, counts: { loadBreaker: 1 } })
  })
  test('a cycle queued while clear but started while held opens no browser and ends partial, marked held', async () => {
    vi.mocked(lastRun).mockResolvedValue(undefined)
    vi.mocked(startRun).mockResolvedValue({ id: 'run-1' } as never)
    vi.mocked(finishRun).mockImplementation(async (_id, result) => ({ id: 'run-1', ...result }) as never)
    vi.mocked(withMlBrowser).mockClear()
    vi.mocked(mlHoldCheck).mockResolvedValueOnce({ kind: 'vpn', text: 't', reason: 'VPN conectada' })
    const run = requestCycle()
    chain.release()
    expect(await run).toMatchObject({ status: 'partial', error: 'VPN conectada', counts: { held: 1 } })
    expect(withMlBrowser).not.toHaveBeenCalled()
  })

  test('a hold stop ends the run partial with its reason, not failed', async () => {
    vi.mocked(lastRun).mockResolvedValue(undefined)
    vi.mocked(startRun).mockResolvedValue({ id: 'run-1' } as never)
    vi.mocked(finishRun).mockImplementation(async (_id, result) => ({ id: 'run-1', ...result }) as never)
    vi.mocked(withMlBrowser).mockImplementation((async (_mode: string, fn: (page: unknown) => unknown) => fn({ on: vi.fn() })) as never)
    vi.mocked(harvest).mockRejectedValue(new RunStop('partial', 'VPN conectada', { counts: { held: 1 } }))
    const run = requestCycle()
    chain.release()
    expect(await run).toMatchObject({ status: 'partial', error: 'VPN conectada', counts: { held: 1 } })
  })
})

describe('a queued cycle that a stop overtook', () => {
  const stoppedAfterRequest = (status: string) => async (kind: string) => (
    kind === 'search' ? { status, finishedAt: new Date(Date.now() + 60_000) } : undefined
  )

  test.each([['blocked'], ['session_expired']])('skips on %s without writing a run row', async (status) => {
    vi.mocked(lastStatusRun).mockImplementation(stoppedAfterRequest(status) as never)
    const queued = requestCycle()
    chain.release()
    expect(await queued).toBeNull()
    expect(startRun).not.toHaveBeenCalled()
  })

  test('runs when the stop finished before the request', async () => {
    vi.mocked(lastStatusRun).mockResolvedValue({ status: 'blocked', finishedAt: new Date(Date.now() - 60_000) } as never)
    vi.mocked(startRun).mockRejectedValue(new Error('db down'))
    const queued = requestCycle()
    chain.release()
    await expect(queued).rejects.toThrow('db down')
  })
})
