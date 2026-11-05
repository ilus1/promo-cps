import { beforeEach, expect, test, vi } from 'vitest'
import { GET, POST } from './route'

const { PORT, createSearch, listSearches, searchByUrl } = vi.hoisted(() => ({
  PORT: 8510, createSearch: vi.fn(), listSearches: vi.fn(), searchByUrl: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/searches', () => ({ createSearch, listSearches, searchByUrl }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const SEARCH_URL = 'https://lista.mercadolivre.com.br/ssd'
const ROW = { id: 'row' }

const post = (body: unknown, origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/searches`, {
  method: 'POST',
  headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  createSearch.mockResolvedValue(ROW)
  listSearches.mockResolvedValue([ROW])
  searchByUrl.mockResolvedValue(undefined)
})

test('GET lists the Buscas', async () => {
  const res = await (GET as (req: Request) => Promise<Response>)(new Request(`${LOCAL_ORIGIN}/api/searches`))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([ROW])
})

test('a foreign origin -> 403 and nothing is created', async () => {
  const res = await POST(post({ name: 'a', url: SEARCH_URL }, 'http://evil.example'))
  expect(res.status).toBe(403)
  expect(createSearch).not.toHaveBeenCalled()
})

test.each([
  {}, { name: 'a' }, { url: SEARCH_URL }, { name: '', url: SEARCH_URL },
  { name: 'a', url: 'https://evil.com/x' }, { name: 'a', url: SEARCH_URL, runEveryHours: 2 },
  { name: 'a', url: SEARCH_URL, enabled: 'yes' }, null, 'not json',
])('invalid body %j -> 400', async (body) => {
  const res = await POST(post(body))
  expect(res.status).toBe(400)
  expect(createSearch).not.toHaveBeenCalled()
})

test('a valid body -> 201 and the url is stored with its kind', async () => {
  const res = await POST(post({ name: ' Teste ', url: SEARCH_URL, runEveryHours: 6 }))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual(ROW)
  expect(createSearch).toHaveBeenCalledWith({
    name: 'Teste', url: { kind: 'search', url: SEARCH_URL }, runEveryHours: 6,
  })
})

test('a url that another Busca already has -> 409 and nothing is created', async () => {
  searchByUrl.mockResolvedValue(ROW)
  const res = await POST(post({ name: 'a', url: SEARCH_URL }))
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'duplicate_url' })
  expect(createSearch).not.toHaveBeenCalled()
  expect(searchByUrl).toHaveBeenCalledWith(SEARCH_URL)
})

test('a typed term -> 201 with the lista url built from it', async () => {
  const res = await POST(post({ name: 'Fone', url: 'Fone Bluetooth' }))
  expect(res.status).toBe(201)
  expect(createSearch).toHaveBeenCalledWith({
    name: 'Fone', url: { kind: 'search', url: 'https://lista.mercadolivre.com.br/fone-bluetooth' },
  })
})

test('a term without letters or numbers -> 400 and nothing is created', async () => {
  const res = await POST(post({ name: 'x', url: '?!' }))
  expect(res.status).toBe(400)
  expect(createSearch).not.toHaveBeenCalled()
})
