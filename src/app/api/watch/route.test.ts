import { beforeEach, expect, test, vi } from 'vitest'

const { PORT, createProduct, wakeWatch, watchRunning } = vi.hoisted(() => ({ PORT: 8510, createProduct: vi.fn(), wakeWatch: vi.fn(), watchRunning: vi.fn() }))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/watch-products', () => ({ createProduct }))
vi.mock('@/ingestion/watch/loops', () => ({ wakeWatch, watchRunning }))

import { POST } from './route'

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const ID = '5f0c1b0e-8f3a-4c36-9f43-6c8f1f0a9b11'

const request = (body: unknown, origin = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/watch`, {
  method: 'POST',
  headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  createProduct.mockResolvedValue(ID)
  watchRunning.mockReturnValue(true)
})

test('a typed name creates the product with its name as the search text, then wakes the loops', async () => {
  const res = await POST(request({ nameOrLink: ' Fone JBL Tune 520BT ', targetPriceCents: 25_000, dropPercent: 15 }))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ id: ID, started: true })
  expect(createProduct).toHaveBeenCalledWith({
    name: 'Fone JBL Tune 520BT', query: 'Fone JBL Tune 520BT', ean: null, eanSource: null, targetPriceCents: 25_000, dropPercent: 15,
  }, expect.any(Date))
  expect(wakeWatch).toHaveBeenCalledTimes(1)
})

test('a link is stored as the canonical link until the resolve reads its title, and a typed EAN is manual', async () => {
  await POST(request({ nameOrLink: 'amazon.com.br/Fone-JBL/dp/B0C1234567?ref=x', ean: '7891234567895' }))
  expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({
    name: 'https://www.amazon.com.br/dp/B0C1234567', query: 'https://www.amazon.com.br/dp/B0C1234567', ean: '7891234567895', eanSource: 'manual',
  }), expect.any(Date))
})

test.each([{}, { nameOrLink: '' }, { nameOrLink: 'https://www.magazineluiza.com.br/x/p/1' }, { nameOrLink: 'fone', ean: '1' }])(
  'an invalid body %j -> 400 with nothing created', async (body) => {
    expect((await POST(request(body))).status).toBe(400)
    expect(createProduct).not.toHaveBeenCalled()
    expect(wakeWatch).not.toHaveBeenCalled()
  },
)

test('with the loops off (AUTO_RUN=off) the product is saved and the answer says no search starts', async () => {
  watchRunning.mockReturnValue(false)
  const res = await POST(request({ nameOrLink: 'fone' }))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ id: ID, started: false })
})

test('a foreign origin -> 403', async () => {
  expect((await POST(request({ nameOrLink: 'fone' }, 'http://evil.example'))).status).toBe(403)
  expect(createProduct).not.toHaveBeenCalled()
})
