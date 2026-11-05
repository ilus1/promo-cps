import { beforeEach, expect, test, vi } from 'vitest'
import { RunStop } from './errors'
import { recordedRun } from './recorded-run'

const { startRun, finishRun, withMlBrowser } = vi.hoisted(() => ({ startRun: vi.fn(), finishRun: vi.fn(), withMlBrowser: vi.fn() }))
vi.mock('@/db/runs', () => ({ startRun, finishRun, lastStatusRun: vi.fn() }))
vi.mock('./browser', () => ({ withMlBrowser }))
vi.mock('./request-hold', () => ({ mlHoldCheck: vi.fn(async () => null) }))

const fakePage = { on: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  startRun.mockResolvedValue({ id: 'run-1' })
  finishRun.mockImplementation(async (_id, result) => ({ id: 'run-1', ...result }))
  withMlBrowser.mockImplementation((_mode, fn) => fn(fakePage))
})

test('a failed query records the database cause and its code, with queries redacted', async () => {
  const cause = Object.assign(new Error('deadlock detected on https://a.com/x?k=1'), { code: '40P01' })
  const failure = new Error('Failed query: insert into "items" ("id") values ($1)\nparams: 1', { cause })
  await recordedRun('cycle', async () => {
    throw failure
  })
  expect(finishRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
    status: 'failed', error: 'deadlock detected on https://a.com/x (40P01)',
  }))
})

test('a run stop keeps its own message and status', async () => {
  await recordedRun('cycle', async () => {
    throw new RunStop('blocked', 'Mercado Livre bloqueou o acesso', { cause: new Error('inner') })
  })
  expect(finishRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'blocked', error: 'Mercado Livre bloqueou o acesso' }))
})
