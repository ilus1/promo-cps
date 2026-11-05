import { beforeEach, expect, test, vi } from 'vitest'
import { GET, POST } from './route'

const { PORT, alertByQuery, createAlert, hasUnknownBusca, listAlerts } = vi.hoisted(() => ({
  PORT: 8510, alertByQuery: vi.fn(), createAlert: vi.fn(), hasUnknownBusca: vi.fn(), listAlerts: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/alerts', () => ({ alertByQuery, createAlert, hasUnknownBusca, listAlerts }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ROW = { id: 'row' }

const post = (body: unknown, origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/alerts`, {
  method: 'POST',
  headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  createAlert.mockResolvedValue(ROW)
  listAlerts.mockResolvedValue([ROW])
  alertByQuery.mockResolvedValue(undefined)
  hasUnknownBusca.mockResolvedValue(false)
})

test('GET lists the alerts', async () => {
  const res = await (GET as (req: Request) => Promise<Response>)(new Request(`${LOCAL_ORIGIN}/api/alerts`))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([ROW])
})

test('a foreign origin -> 403 and nothing is created', async () => {
  const res = await POST(post({ name: 'a', query: '' }, 'http://evil.example'))
  expect(res.status).toBe(403)
  expect(createAlert).not.toHaveBeenCalled()
})

test.each([
  {}, { name: 'a' }, { query: '' }, { name: '  ', query: '' }, { name: 'a'.repeat(81), query: '' },
  { name: 'a', query: 1 }, { name: 'a', query: '', extra: true }, null, 'not json',
])('invalid body %j -> 400', async (body) => {
  const res = await POST(post(body))
  expect(res.status).toBe(400)
  expect(createAlert).not.toHaveBeenCalled()
})

test('a valid body -> 201 with the trimmed name and the server-normalized query', async () => {
  const res = await POST(post({ name: ' Teste ', query: 'queda=1&aba=salvos' }))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual(ROW)
  expect(createAlert).toHaveBeenCalledWith({ name: 'Teste', query: 'queda=1' })
})

test('a view that already has an alert -> 409 and nothing is created', async () => {
  alertByQuery.mockResolvedValue(ROW)
  const res = await POST(post({ name: 'a', query: 'queda=1' }))
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'duplicate_query' })
  expect(createAlert).not.toHaveBeenCalled()
  expect(alertByQuery).toHaveBeenCalledWith('queda=1')
})

test('an unknown or deleted busca -> 422 and nothing is created', async () => {
  hasUnknownBusca.mockResolvedValue(true)
  const res = await POST(post({ name: 'a', query: 'busca=3f2b8c1e-0a4d-4e7b-9c55-1d2e3f4a5b6c&queda=1' }))
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'busca_not_found' })
  expect(hasUnknownBusca).toHaveBeenCalledWith('busca=3f2b8c1e-0a4d-4e7b-9c55-1d2e3f4a5b6c&queda=1')
  expect(createAlert).not.toHaveBeenCalled()
})
