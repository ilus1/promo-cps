import { beforeEach, expect, test, vi } from 'vitest'
import type { LoginStatus } from '@/lib/domain'
import { POST } from './route'

const { PORT, QUEUED, startLogin } = vi.hoisted(() => ({
  PORT: 8510,
  QUEUED: { state: 'queued', error: null } as LoginStatus,
  startLogin: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
const { mlRequestHold } = vi.hoisted(() => ({ mlRequestHold: vi.fn() }))
vi.mock('@/ingestion/request-hold', () => ({ mlRequestHold }))
vi.mock('@/ingestion/login', () => ({ startLogin, loginStatus: () => QUEUED }))

const LOCAL_HOST = `127.0.0.1:${PORT}`
const LOCAL_ORIGIN = `http://${LOCAL_HOST}`
const LOGIN_URL = `${LOCAL_ORIGIN}/api/ml/login`

const fromApp = (body: unknown) => new Request(LOGIN_URL, {
  method: 'POST',
  headers: { origin: LOCAL_ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  mlRequestHold.mockResolvedValue(null)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

test('a bare POST from a local Host -> 403 browser_only', async () => {
  const res = await POST(new Request(LOGIN_URL, { method: 'POST', headers: { host: LOCAL_HOST } }))
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'browser_only' })
  expect(startLogin).not.toHaveBeenCalled()
})

test('a same-origin POST without confirm -> 400', async () => {
  const res = await POST(fromApp({}))
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: 'invalid_request' })
  expect(startLogin).not.toHaveBeenCalled()
})

test('a confirmed same-origin POST -> 202 and starts the login once', async () => {
  const res = await POST(fromApp({ confirm: true }))
  expect(res.status).toBe(202)
  expect(await res.json()).toEqual(QUEUED)
  expect(startLogin).toHaveBeenCalledTimes(1)
})

test.each([
  ['vpn', 'VPN da empresa conectada: desconecte para rodar'],
  ['manual', 'Requisições pausadas manualmente: retome em Conta para rodar'],
])('a %s hold -> 409 with its text and nothing starts', async (kind, text) => {
  mlRequestHold.mockResolvedValue({ kind, text, reason: 'r' })
  const res = await POST(fromApp({ confirm: true }))
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: text })
  expect(startLogin).not.toHaveBeenCalled()
})
