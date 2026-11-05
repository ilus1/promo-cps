import { beforeEach, expect, test, vi } from 'vitest'
import type { CycleActivity } from '@/lib/domain'
import { POST } from './route'

const { PORT, QUEUED, requestCycle } = vi.hoisted(() => ({
  PORT: 8510,
  QUEUED: { phase: 'queued' } as CycleActivity,
  requestCycle: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
const { mlRequestHold } = vi.hoisted(() => ({ mlRequestHold: vi.fn() }))
vi.mock('@/ingestion/request-hold', () => ({ mlRequestHold }))
vi.mock('@/ingestion/cycle', () => ({ requestCycle, cycleActivity: () => QUEUED }))

const LOCAL_HOST = `127.0.0.1:${PORT}`
const LOCAL_ORIGIN = `http://${LOCAL_HOST}`
const RUN_URL = `${LOCAL_ORIGIN}/api/run`

const fromApp = (body: unknown) => new Request(RUN_URL, {
  method: 'POST',
  headers: { origin: LOCAL_ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  mlRequestHold.mockResolvedValue(null)
  requestCycle.mockResolvedValue({})
})

test('a bare POST from a local Host -> 403 browser_only', async () => {
  const res = await POST(new Request(RUN_URL, { method: 'POST', headers: { host: LOCAL_HOST } }))
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'browser_only' })
  expect(requestCycle).not.toHaveBeenCalled()
})

test('a same-origin POST without confirm -> 400', async () => {
  const res = await POST(fromApp({}))
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: 'invalid_request' })
  expect(requestCycle).not.toHaveBeenCalled()
})

test('a confirmed same-origin POST -> 202 with the cycle activity and requests one cycle', async () => {
  const res = await POST(fromApp({ confirm: true }))
  expect(res.status).toBe(202)
  expect(await res.json()).toEqual(QUEUED)
  expect(requestCycle).toHaveBeenCalledTimes(1)
})

test('a cycle that rejects is logged, not thrown', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  requestCycle.mockRejectedValueOnce(new Error('db down https://a.com/x?code=SECRET'))
  const res = await POST(fromApp({ confirm: true }))
  expect(res.status).toBe(202)
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('[cycle]', 'db down https://a.com/x'))
})

test.each([
  ['vpn', 'VPN da empresa conectada: desconecte para rodar'],
  ['manual', 'Requisições pausadas manualmente: retome em Conta para rodar'],
])('a %s hold -> 409 with its text and nothing starts', async (kind, text) => {
  mlRequestHold.mockResolvedValue({ kind, text, reason: 'r' })
  const res = await POST(fromApp({ confirm: true }))
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: text })
  expect(requestCycle).not.toHaveBeenCalled()
})
