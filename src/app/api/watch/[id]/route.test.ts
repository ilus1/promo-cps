import { beforeEach, expect, test, vi } from 'vitest'

const { PORT, updateProduct, deactivateProduct, activeProductExists, requestWatchCheck } = vi.hoisted(() => ({
  PORT: 8510, updateProduct: vi.fn(), deactivateProduct: vi.fn(), activeProductExists: vi.fn(), requestWatchCheck: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/watch-products', () => ({ updateProduct, deactivateProduct }))
vi.mock('@/db/monitoring', () => ({ activeProductExists }))
vi.mock('@/ingestion/watch/loops', () => ({ requestWatchCheck }))

import { DELETE, PATCH } from './route'

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ID = '5f0c1b0e-8f3a-4c36-9f43-6c8f1f0a9b11'
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) })

const request = (method: string, body?: unknown, origin = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/watch/${ID}`, {
  method,
  headers: { origin, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  updateProduct.mockResolvedValue(true)
  deactivateProduct.mockResolvedValue(true)
  activeProductExists.mockResolvedValue(true)
  requestWatchCheck.mockResolvedValue(true)
})

test('alert settings change without a new search', async () => {
  const res = await PATCH(request('PATCH', { targetPriceCents: null, dropPercent: 20 }), ctxOf(ID))
  expect(res.status).toBe(200)
  expect(updateProduct).toHaveBeenCalledWith(ID, { targetPriceCents: null, dropPercent: 20, active: undefined })
  expect(requestWatchCheck).not.toHaveBeenCalled()
})

test('a new name becomes the search text and asks for a new search', async () => {
  await PATCH(request('PATCH', { name: 'Fone JBL 520BT' }), ctxOf(ID))
  expect(updateProduct).toHaveBeenCalledWith(ID, expect.objectContaining({ name: 'Fone JBL 520BT', query: 'Fone JBL 520BT' }))
  expect(requestWatchCheck).toHaveBeenCalledWith(ID)
})

test('a typed EAN is manual, a cleared one clears its source, and both search again', async () => {
  await PATCH(request('PATCH', { ean: '7891234567895' }), ctxOf(ID))
  expect(updateProduct).toHaveBeenLastCalledWith(ID, expect.objectContaining({ ean: '7891234567895', eanSource: 'manual' }))
  await PATCH(request('PATCH', { ean: null }), ctxOf(ID))
  expect(updateProduct).toHaveBeenLastCalledWith(ID, expect.objectContaining({ ean: null, eanSource: null }))
  expect(requestWatchCheck).toHaveBeenCalledTimes(2)
})

test('a stopped product -> 404 on PATCH and DELETE, but a resume still goes through', async () => {
  activeProductExists.mockResolvedValue(false)
  expect((await PATCH(request('PATCH', { dropPercent: 5 }), ctxOf(ID))).status).toBe(404)
  expect((await DELETE(request('DELETE'), ctxOf(ID))).status).toBe(404)
  expect(updateProduct).not.toHaveBeenCalled()
  expect(deactivateProduct).not.toHaveBeenCalled()
  expect((await PATCH(request('PATCH', { active: true }), ctxOf(ID))).status).toBe(200)
  expect(updateProduct).toHaveBeenCalledWith(ID, expect.objectContaining({ active: true }))
  expect(requestWatchCheck).toHaveBeenCalledWith(ID)
})

test('an unknown or malformed id -> 404', async () => {
  updateProduct.mockResolvedValue(false)
  expect((await PATCH(request('PATCH', { dropPercent: 5 }), ctxOf(ID))).status).toBe(404)
  expect((await PATCH(request('PATCH', { dropPercent: 5 }), ctxOf('nope'))).status).toBe(404)
  deactivateProduct.mockResolvedValue(false)
  expect((await DELETE(request('DELETE'), ctxOf(ID))).status).toBe(404)
  expect((await DELETE(request('DELETE'), ctxOf('nope'))).status).toBe(404)
})

test.each([{}, { name: '' }, { dropPercent: 0 }, { ean: 'abc' }, { removed: true }, null])('PATCH invalid body %j -> 400', async (body) => {
  expect((await PATCH(request('PATCH', body), ctxOf(ID))).status).toBe(400)
  expect(updateProduct).not.toHaveBeenCalled()
})

test('DELETE stops watching the product', async () => {
  const res = await DELETE(request('DELETE'), ctxOf(ID))
  expect(res.status).toBe(200)
  expect(deactivateProduct).toHaveBeenCalledWith(ID)
})

test('a foreign origin -> 403 on PATCH and DELETE', async () => {
  expect((await PATCH(request('PATCH', { dropPercent: 5 }, 'http://evil.example'), ctxOf(ID))).status).toBe(403)
  expect((await DELETE(request('DELETE', undefined, 'http://evil.example'), ctxOf(ID))).status).toBe(403)
  expect(updateProduct).not.toHaveBeenCalled()
  expect(deactivateProduct).not.toHaveBeenCalled()
})
