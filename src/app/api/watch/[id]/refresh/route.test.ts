import { beforeEach, expect, test, vi } from 'vitest'

const { PORT, requestHold, requestWatchCheck, watchRunning, activeProductExists } = vi.hoisted(() => ({
  PORT: 8510, requestHold: vi.fn(), requestWatchCheck: vi.fn(), watchRunning: vi.fn(), activeProductExists: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/monitoring', () => ({ activeProductExists }))
vi.mock('@/ingestion/request-hold', () => ({ requestHold }))
vi.mock('@/ingestion/watch/loops', () => ({ requestWatchCheck, watchRunning, WATCH_OFF_TEXT: 'Verificações automáticas desligadas (AUTO_RUN=off)' }))

import { POST } from './route'

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ID = '5f0c1b0e-8f3a-4c36-9f43-6c8f1f0a9b11'
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) })
const request = (origin = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/watch/${ID}/refresh`, { method: 'POST', headers: { origin } })

beforeEach(() => {
  vi.clearAllMocks()
  requestHold.mockResolvedValue(null)
  requestWatchCheck.mockResolvedValue(true)
  watchRunning.mockReturnValue(true)
  activeProductExists.mockResolvedValue(true)
})

test('marks the product for a new search and refresh -> 202', async () => {
  const res = await POST(request(), ctxOf(ID))
  expect(res.status).toBe(202)
  expect(requestWatchCheck).toHaveBeenCalledWith(ID)
})

test('a hold, including the price pause, -> 409 with its text and nothing marked', async () => {
  requestHold.mockResolvedValue({ kind: 'price_manual', text: 'Comparação de preços pausada manualmente: retome em Conta', reason: 'r' })
  const res = await POST(request(), ctxOf(ID))
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Comparação de preços pausada manualmente: retome em Conta' })
  expect(requestWatchCheck).not.toHaveBeenCalled()
})

test('with the loops off (AUTO_RUN=off) -> 409 saying so, and nothing marked', async () => {
  watchRunning.mockReturnValue(false)
  const res = await POST(request(), ctxOf(ID))
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Verificações automáticas desligadas (AUTO_RUN=off)' })
  expect(requestWatchCheck).not.toHaveBeenCalled()
})

test('an unknown, stopped or malformed id -> 404', async () => {
  activeProductExists.mockResolvedValue(false)
  expect((await POST(request(), ctxOf(ID))).status).toBe(404)
  expect((await POST(request(), ctxOf('nope'))).status).toBe(404)
  expect(requestWatchCheck).not.toHaveBeenCalled()
})

test('a foreign origin -> 403', async () => {
  expect((await POST(request('http://evil.example'), ctxOf(ID))).status).toBe(403)
  expect(requestWatchCheck).not.toHaveBeenCalled()
})
