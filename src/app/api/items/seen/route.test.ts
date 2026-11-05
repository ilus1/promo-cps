import { beforeEach, expect, test, vi } from 'vitest'
import { POST } from './route'

const { PORT, markSeen } = vi.hoisted(() => ({ PORT: 8510, markSeen: vi.fn() }))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/items', () => ({ markSeen }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const AS_OF = new Date(Date.now() - 1000).toISOString()

const post = (body: unknown, origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/items/seen`, {
  method: 'POST',
  headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  markSeen.mockResolvedValue(2)
})

test('a foreign origin -> 403 and nothing is written', async () => {
  const res = await POST(post({ ids: ['MLB1'], asOf: AS_OF }, 'http://evil.example'))
  expect(res.status).toBe(403)
  expect(markSeen).not.toHaveBeenCalled()
})

test.each([{}, { ids: [], asOf: AS_OF }, { query: 1, asOf: AS_OF }, { ids: ['MLB1'] }, { query: '', asOf: '2999-01-01T00:00:00.000Z' }, null])('invalid body %j -> 400', async (body) => {
  const res = await POST(post(body))
  expect(res.status).toBe(400)
  expect(markSeen).not.toHaveBeenCalled()
})

test('an id list -> 200 with the marked count', async () => {
  const res = await POST(post({ ids: ['MLB1', 'MLB2'], asOf: AS_OF }))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ marked: 2 })
  expect(markSeen).toHaveBeenCalledWith({ ids: ['MLB1', 'MLB2'], asOf: new Date(AS_OF) }, expect.any(Date))
})

test('a query -> 200 and the filters reach the writer', async () => {
  const res = await POST(post({ query: 'q=fone', asOf: AS_OF }))
  expect(res.status).toBe(200)
  expect(markSeen).toHaveBeenCalledWith({ filters: expect.objectContaining({ text: 'fone' }), asOf: new Date(AS_OF) }, expect.any(Date))
})
