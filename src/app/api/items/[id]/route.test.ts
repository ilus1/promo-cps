import { beforeEach, expect, test, vi } from 'vitest'
import { PATCH } from './route'

const { PORT, setItemStatus } = vi.hoisted(() => ({ PORT: 8510, setItemStatus: vi.fn() }))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/items', () => ({ setItemStatus }))

const LOCAL_HOST = `127.0.0.1:${PORT}`
const LOCAL_ORIGIN = `http://${LOCAL_HOST}`
const ITEM_ID = 'MLB123'
const ctx = { params: Promise.resolve({ id: ITEM_ID }) }

const patch = (body: unknown, origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/items/${ITEM_ID}`, {
  method: 'PATCH',
  headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  setItemStatus.mockResolvedValue(true)
})

test('a foreign origin -> 403 and nothing is written', async () => {
  const res = await PATCH(patch({ status: 'SAVED' }, 'http://evil.example'), ctx)
  expect(res.status).toBe(403)
  expect(setItemStatus).not.toHaveBeenCalled()
})

test.each([{}, { status: 'BOGUS' }, { status: 1 }, null])('invalid body %j -> 400', async (body) => {
  const res = await PATCH(patch(body), ctx)
  expect(res.status).toBe(400)
  expect(setItemStatus).not.toHaveBeenCalled()
})

test('an unknown item -> 404', async () => {
  setItemStatus.mockResolvedValue(false)
  const res = await PATCH(patch({ status: 'SAVED' }), ctx)
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'not_found' })
})

test('a valid status -> 200 and the status is stored', async () => {
  const res = await PATCH(patch({ status: 'SEEN' }), ctx)
  expect(res.status).toBe(200)
  expect(setItemStatus).toHaveBeenCalledWith(ITEM_ID, 'SEEN')
})
