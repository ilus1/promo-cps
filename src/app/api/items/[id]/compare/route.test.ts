import { beforeEach, expect, test, vi } from 'vitest'
import { POST } from './route'

const { PORT, itemToCheck, matchItemLocally, prioritizeSearch } = vi.hoisted(() => ({
  PORT: 8510, itemToCheck: vi.fn(), matchItemLocally: vi.fn(), prioritizeSearch: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/price-checks', () => ({ itemToCheck }))
vi.mock('@/db/market-searches', () => ({ prioritizeSearch }))
vi.mock('@/ingestion/market/match-local', () => ({ matchItemLocally }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ITEM_ID = 'MLB123'
const ctx = { params: Promise.resolve({ id: ITEM_ID }) }
const ITEM = { id: ITEM_ID, productId: null, title: 'Veja X14 Spray Tira Limo 500ml', finalCents: 1201, showsSaving: true }
const SEARCHED_AT = new Date('2026-11-01T09:30:00Z')

const post = (origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/items/${ITEM_ID}/compare`, {
  method: 'POST',
  headers: origin ? { origin } : {},
})

beforeEach(() => {
  vi.clearAllMocks()
  itemToCheck.mockResolvedValue(ITEM)
  matchItemLocally.mockResolvedValue('no_match')
  prioritizeSearch.mockResolvedValue({ queued: true, searchedAt: null })
})

test('a foreign origin -> 403 and no match', async () => {
  const res = await POST(post('http://evil.example'), ctx)
  expect(res.status).toBe(403)
  expect(matchItemLocally).not.toHaveBeenCalled()
})

test('a missing origin -> 403', async () => {
  expect((await POST(post(null), ctx)).status).toBe(403)
})

test('an unknown item -> 404, no match and nothing queued', async () => {
  itemToCheck.mockResolvedValue(null)
  const res = await POST(post(), ctx)
  expect(res.status).toBe(404)
  expect(matchItemLocally).not.toHaveBeenCalled()
  expect(prioritizeSearch).not.toHaveBeenCalled()
})

test.each(['matched', 'no_match'])('a local %s -> 200 with the outcome, and the key still goes to the Amazon queue', async (status) => {
  matchItemLocally.mockResolvedValue(status)
  const res = await POST(post(), ctx)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ status, amazonQueued: true, amazonSearchedAt: null })
  expect(matchItemLocally).toHaveBeenCalledWith(ITEM, expect.any(Date))
  expect(prioritizeSearch).toHaveBeenCalledTimes(1)
})

test('the key goes to the front of the Amazon queue with the compare query of the title', async () => {
  await POST(post(), ctx)
  expect(prioritizeSearch).toHaveBeenCalledWith(`item:${ITEM_ID}`, 'veja x14 spray tira limo 500ml', expect.any(Date))
})

test('a catalog product queues its product key', async () => {
  itemToCheck.mockResolvedValue({ ...ITEM, productId: 'MLB-P1' })
  await POST(post(), ctx)
  expect(prioritizeSearch).toHaveBeenCalledWith('MLB-P1', expect.any(String), expect.any(Date))
})

test('a key searched recently is not queued again, and the answer says when it was searched', async () => {
  prioritizeSearch.mockResolvedValue({ queued: false, searchedAt: SEARCHED_AT })
  expect(await (await POST(post(), ctx)).json()).toEqual({ status: 'no_match', amazonQueued: false, amazonSearchedAt: SEARCHED_AT.toISOString() })
})

test('a title with no query words is matched locally but not queued', async () => {
  itemToCheck.mockResolvedValue({ ...ITEM, title: '!!!' })
  const res = await POST(post(), ctx)
  expect(await res.json()).toEqual({ status: 'no_match', amazonQueued: false, amazonSearchedAt: null })
  expect(prioritizeSearch).not.toHaveBeenCalled()
})
