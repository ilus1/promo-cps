import { beforeEach, expect, test, vi } from 'vitest'

const { PORT, removeListing, activeListing } = vi.hoisted(() => ({ PORT: 8510, removeListing: vi.fn(), activeListing: vi.fn() }))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/watch-listings', () => ({ removeListing }))
vi.mock('@/db/monitoring', () => ({ activeListing }))

import { DELETE } from './route'

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ID = '5f0c1b0e-8f3a-4c36-9f43-6c8f1f0a9b11'
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) })
const request = (origin = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/watch/listings/${ID}`, { method: 'DELETE', headers: { origin } })

beforeEach(() => {
  vi.clearAllMocks()
  removeListing.mockResolvedValue(true)
  activeListing.mockResolvedValue(true)
})

test('removes the listing for good', async () => {
  const res = await DELETE(request(), ctxOf(ID))
  expect(res.status).toBe(200)
  expect(removeListing).toHaveBeenCalledWith(ID)
})

test('a listing already removed, unknown, or of a stopped product -> 404 without touching it', async () => {
  activeListing.mockResolvedValue(false)
  expect((await DELETE(request(), ctxOf(ID))).status).toBe(404)
  expect(removeListing).not.toHaveBeenCalled()
})

test('a foreign origin -> 403', async () => {
  expect((await DELETE(request('http://evil.example'), ctxOf(ID))).status).toBe(403)
  expect(removeListing).not.toHaveBeenCalled()
})
