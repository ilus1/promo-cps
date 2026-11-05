import { beforeEach, expect, test, vi } from 'vitest'
import type { Run } from '@/db/schema'
import type { CheckItem } from '@/lib/price-check-rules'
import { afterRun } from './after-run'
import { announce, type AnnounceDeps } from './announce'
import { rematchItems, requestRematch } from './market/rematch'

const mocks = vi.hoisted(() => ({
  release: (() => undefined) as () => void,
  releaseNotice: (() => undefined) as () => void,
  notified: [] as string[],
  announced: [] as string[],
}))

vi.mock('@/db/alerts', () => ({ collectDigests: vi.fn() }))
vi.mock('@/db/price-checks', () => ({ alertCandidatesToCheck: vi.fn() }))
vi.mock('@/db/runs', () => ({ previousStatus: vi.fn() }))
vi.mock('@/lib/alert-digest', () => ({ sessionAlertFor: vi.fn() }))
vi.mock('@/lib/app-url', () => ({ appBaseUrl: () => 'http://x' }))
vi.mock('@/lib/desktop-notify', () => ({ dealDigestNotification: vi.fn(), healthNotification: vi.fn(), sendDesktopNotification: vi.fn() }))
vi.mock('./market/rematch', () => ({ rematchItems: vi.fn(), requestRematch: vi.fn() }))
vi.mock('./announce', () => ({
  notifyStatus: vi.fn(async (run: Run) => {
    if (run.id === 'late-notice') await new Promise<void>((resolve) => { mocks.releaseNotice = resolve })
    mocks.notified.push(String(run.id))
  }),
  announce: vi.fn(async (run: Run) => {
    mocks.announced.push(`start ${run.id}`)
    if (run.id === 'boom') throw new Error('digest down')
    if (run.id === 'slow') await new Promise<void>((resolve) => { mocks.release = resolve })
    mocks.announced.push(`end ${run.id}`)
  }),
}))

const runWith = (id: string) => ({ id }) as unknown as Run
const finished = (id: string, kind: Run['kind'], status: Run['status'] = 'ok') => ({ id, kind, status }) as unknown as Run

beforeEach(() => {
  globalThis.__promoAfterRunTail = undefined
  mocks.notified.length = 0
  mocks.announced.length = 0
  vi.mocked(rematchItems).mockClear()
  vi.mocked(requestRematch).mockReset().mockImplementation(() => {
    mocks.announced.push('rematch')
  })
})

test('a run is notified at once even while an earlier announce is still running', async () => {
  afterRun(runWith('slow'))
  await vi.waitFor(() => expect(mocks.announced).toEqual(['start slow']))
  afterRun(runWith('next'))
  await vi.waitFor(() => expect(mocks.notified).toEqual(['slow', 'next']))
  expect(mocks.announced).toEqual(['start slow'])
  mocks.release()
  await vi.waitFor(() => expect(mocks.announced).toEqual(['start slow', 'end slow', 'start next', 'end next']))
})

test('an announce starts only after its own run notifications', async () => {
  afterRun(runWith('late-notice'))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(mocks.announced).toEqual([])
  mocks.releaseNotice()
  await vi.waitFor(() => expect(mocks.announced).toEqual(['start late-notice', 'end late-notice']))
  expect(mocks.notified).toEqual(['late-notice'])
})

async function liveDeps(): Promise<AnnounceDeps> {
  afterRun(runWith('deps'))
  await vi.waitFor(() => expect(mocks.announced).toContain('end deps'))
  return vi.mocked(announce).mock.calls.at(-1)?.[1] as AnnounceDeps
}

test('alert candidates are matched locally', async () => {
  const deps = await liveDeps()
  const candidates: CheckItem[] = [{ id: 'a', productId: null, title: 'Fone', finalCents: 100, showsSaving: true }]
  await deps.runChecks(candidates)
  expect(rematchItems).toHaveBeenCalledWith(candidates, expect.any(Date))
  expect(requestRematch).not.toHaveBeenCalled()
})

test.each([finished('cycle', 'cycle'), finished('busca', 'search', 'partial')])('a finished $kind run requests a full re-match once its announce settles', async (run) => {
  afterRun(run)
  await vi.waitFor(() => expect(mocks.announced).toEqual([`start ${run.id}`, `end ${run.id}`, 'rematch']))
})

test('the re-match is still requested when the announce fails', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  afterRun(finished('boom', 'cycle'))
  await vi.waitFor(() => expect(mocks.announced).toEqual(['start boom', 'rematch']))
  expect(error).toHaveBeenCalledWith('[after-run] failed:', 'digest down')
  error.mockRestore()
})

test.each([finished('failed', 'cycle', 'failed'), finished('login', 'login', 'logged_in')])('a $kind run with status $status requests no re-match', async (run) => {
  afterRun(run)
  await vi.waitFor(() => expect(mocks.announced).toEqual([`start ${run.id}`, `end ${run.id}`]))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(requestRematch).not.toHaveBeenCalled()
})
