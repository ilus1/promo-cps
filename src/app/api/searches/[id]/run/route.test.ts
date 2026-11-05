import { beforeEach, expect, test, vi } from 'vitest'
import type { CycleActivity } from '@/lib/domain'
import { POST } from './route'

const { PORT, QUEUED, getSearch, requestBuscaRun } = vi.hoisted(() => ({
  PORT: 8510,
  QUEUED: { phase: 'queued' } as CycleActivity,
  getSearch: vi.fn(),
  requestBuscaRun: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
const { mlRequestHold } = vi.hoisted(() => ({ mlRequestHold: vi.fn() }))
vi.mock('@/ingestion/request-hold', () => ({ mlRequestHold }))
vi.mock('@/db/searches', () => ({ getSearch }))
vi.mock('@/ingestion/search-run', () => ({ requestBuscaRun, buscaActivity: () => QUEUED }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ID = '5f0c1b0e-8f3a-4c36-9f43-6c8f1f0a9b11'
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) })

const fromApp = (body: unknown) => new Request(`${LOCAL_ORIGIN}/api/searches/${ID}/run`, {
  method: 'POST',
  headers: { origin: LOCAL_ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  mlRequestHold.mockResolvedValue(null)
  getSearch.mockResolvedValue({ id: ID })
  requestBuscaRun.mockResolvedValue(null)
})

test('a bare POST from a local origin -> 403 browser_only', async () => {
  const res = await POST(
    new Request(`${LOCAL_ORIGIN}/api/searches/${ID}/run`, { method: 'POST', headers: { origin: LOCAL_ORIGIN } }),
    ctxOf(ID),
  )
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'browser_only' })
  expect(requestBuscaRun).not.toHaveBeenCalled()
})

test('a same-origin POST without confirm -> 400', async () => {
  const res = await POST(fromApp({}), ctxOf(ID))
  expect(res.status).toBe(400)
  expect(requestBuscaRun).not.toHaveBeenCalled()
})

test('an unknown or malformed id -> 404', async () => {
  getSearch.mockResolvedValue(undefined)
  expect((await POST(fromApp({ confirm: true }), ctxOf(ID))).status).toBe(404)
  expect((await POST(fromApp({ confirm: true }), ctxOf('not-a-uuid'))).status).toBe(404)
  expect(requestBuscaRun).not.toHaveBeenCalled()
})

test('a confirmed same-origin POST -> 202 with the activity and requests one run', async () => {
  const res = await POST(fromApp({ confirm: true }), ctxOf(ID))
  expect(res.status).toBe(202)
  expect(await res.json()).toEqual(QUEUED)
  expect(requestBuscaRun).toHaveBeenCalledWith(ID)
})

test('a run that rejects is logged, not thrown', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  requestBuscaRun.mockRejectedValueOnce(new Error('db down https://a.com/x?code=SECRET'))
  const res = await POST(fromApp({ confirm: true }), ctxOf(ID))
  expect(res.status).toBe(202)
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('[busca]', 'db down https://a.com/x'))
})

test('a foreign origin -> 403 forbidden_origin and nothing is requested', async () => {
  const res = await POST(
    new Request(`${LOCAL_ORIGIN}/api/searches/${ID}/run`, {
      method: 'POST',
      headers: { origin: 'http://evil.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    }),
    ctxOf(ID),
  )
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'forbidden_origin' })
  expect(requestBuscaRun).not.toHaveBeenCalled()
})

test.each([
  ['vpn', 'VPN da empresa conectada: desconecte para rodar'],
  ['manual', 'Requisições pausadas manualmente: retome em Conta para rodar'],
])('a %s hold -> 409 with its text and nothing starts', async (kind, text) => {
  mlRequestHold.mockResolvedValue({ kind, text, reason: 'r' })
  const res = await POST(fromApp({ confirm: true }), ctxOf(ID))
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: text })
  expect(requestBuscaRun).not.toHaveBeenCalled()
})
