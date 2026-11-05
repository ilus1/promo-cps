import { beforeEach, expect, test, vi } from 'vitest'
import { DELETE, PATCH } from './route'

const { PORT, deleteSearch, searchByUrl, updateSearch } = vi.hoisted(() => ({
  PORT: 8510, deleteSearch: vi.fn(), searchByUrl: vi.fn(), updateSearch: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/searches', () => ({ deleteSearch, searchByUrl, updateSearch }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ID = '5f0c1b0e-8f3a-4c36-9f43-6c8f1f0a9b11'
const ROW = { id: ID }
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) })

const request = (method: string, body?: unknown, origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/searches/${ID}`, {
  method,
  headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  updateSearch.mockResolvedValue(ROW)
  deleteSearch.mockResolvedValue(true)
  searchByUrl.mockResolvedValue(undefined)
})

test('a foreign origin -> 403 on PATCH and DELETE', async () => {
  expect((await PATCH(request('PATCH', { enabled: false }, 'http://evil.example'), ctxOf(ID))).status).toBe(403)
  expect((await DELETE(request('DELETE', undefined, 'http://evil.example'), ctxOf(ID))).status).toBe(403)
  expect(updateSearch).not.toHaveBeenCalled()
  expect(deleteSearch).not.toHaveBeenCalled()
})

test.each([{}, { name: '' }, { url: 'https://evil.com' }, { runEveryHours: 5 }, { enabled: 'no' }, { kind: 'product' }, null])(
  'PATCH invalid body %j -> 400', async (body) => {
    const res = await PATCH(request('PATCH', body), ctxOf(ID))
    expect(res.status).toBe(400)
    expect(updateSearch).not.toHaveBeenCalled()
  },
)

test('PATCH an unknown id -> 404', async () => {
  updateSearch.mockResolvedValue(undefined)
  const res = await PATCH(request('PATCH', { enabled: false }), ctxOf(ID))
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'not_found' })
})

test('PATCH and DELETE with a malformed id -> 404 without touching the database', async () => {
  expect((await PATCH(request('PATCH', { enabled: false }), ctxOf('not-a-uuid'))).status).toBe(404)
  expect((await DELETE(request('DELETE'), ctxOf('not-a-uuid'))).status).toBe(404)
  expect(updateSearch).not.toHaveBeenCalled()
  expect(deleteSearch).not.toHaveBeenCalled()
})

test('PATCH a valid patch -> 200 with the row', async () => {
  const res = await PATCH(request('PATCH', { enabled: false, runEveryHours: 12 }), ctxOf(ID))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(ROW)
  expect(updateSearch).toHaveBeenCalledWith(ID, { enabled: false, runEveryHours: 12 })
})

test('PATCH a new url sends its kind along', async () => {
  await PATCH(request('PATCH', { url: 'https://www.mercadolivre.com.br/x/p/MLB1' }), ctxOf(ID))
  expect(updateSearch).toHaveBeenCalledWith(ID, { url: { kind: 'product', url: 'https://www.mercadolivre.com.br/x/p/MLB1' } })
})

test('DELETE an unknown id -> 404', async () => {
  deleteSearch.mockResolvedValue(false)
  expect((await DELETE(request('DELETE'), ctxOf(ID))).status).toBe(404)
})

test('DELETE a known id -> 200', async () => {
  const res = await DELETE(request('DELETE'), ctxOf(ID))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(deleteSearch).toHaveBeenCalledWith(ID)
})

test('PATCH checks the id before the body: a malformed id with an invalid body is a 404', async () => {
  expect((await PATCH(request('PATCH', {}), ctxOf('not-a-uuid'))).status).toBe(404)
})

test('PATCH a url that belongs to another Busca -> 409', async () => {
  searchByUrl.mockResolvedValue({ id: 'other' })
  const res = await PATCH(request('PATCH', { url: 'https://lista.mercadolivre.com.br/ssd' }), ctxOf(ID))
  expect(res.status).toBe(409)
  expect(updateSearch).not.toHaveBeenCalled()
})

test('PATCH the url a Busca already has is allowed', async () => {
  searchByUrl.mockResolvedValue({ id: ID })
  const res = await PATCH(request('PATCH', { url: 'https://lista.mercadolivre.com.br/ssd' }), ctxOf(ID))
  expect(res.status).toBe(200)
})
