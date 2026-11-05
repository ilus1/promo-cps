import { beforeEach, expect, test, vi } from 'vitest'
import { DELETE } from './route'

const { PORT, deleteAlert } = vi.hoisted(() => ({ PORT: 8510, deleteAlert: vi.fn() }))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/alerts', () => ({ deleteAlert }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ID = '3f2b8c1e-0a4d-4e7b-9c55-1d2e3f4a5b6c'

const del = (origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/alerts/${ID}`, {
  method: 'DELETE', headers: origin ? { origin } : {},
})
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  deleteAlert.mockResolvedValue(true)
})

test('a foreign origin -> 403 and nothing is deleted', async () => {
  const res = await DELETE(del('http://evil.example'), ctx(ID))
  expect(res.status).toBe(403)
  expect(deleteAlert).not.toHaveBeenCalled()
})

test('a malformed id -> 404 without touching the database', async () => {
  const res = await DELETE(del(), ctx('not-a-uuid'))
  expect(res.status).toBe(404)
  expect(deleteAlert).not.toHaveBeenCalled()
})

test('an alert that does not exist -> 404', async () => {
  deleteAlert.mockResolvedValue(false)
  expect((await DELETE(del(), ctx(ID))).status).toBe(404)
})

test('an existing alert -> 200', async () => {
  const res = await DELETE(del(), ctx(ID))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(deleteAlert).toHaveBeenCalledWith(ID)
})
