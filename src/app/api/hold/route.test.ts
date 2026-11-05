import { beforeEach, expect, test, vi } from 'vitest'
import { GET, POST } from './route'

const { PORT, setHoldSetting, holdState } = vi.hoisted(() => ({ PORT: 8510, setHoldSetting: vi.fn(), holdState: vi.fn() }))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/app-settings', () => ({
  REQUESTS_PAUSED_KEY: 'requests_paused',
  PRICE_CHECKS_PAUSED_KEY: 'price_checks_paused',
  setHoldSetting,
}))
vi.mock('@/ingestion/request-hold', () => ({ holdState }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const STATE = {
  hold: null, vpn: { state: 'clear', name: null }, requestsPaused: false, priceChecksPaused: false,
}

const post = (body: unknown, origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/hold`, {
  method: 'POST',
  headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  holdState.mockResolvedValue(STATE)
})

test('GET returns the hold state', async () => {
  const res = await (GET as (req: Request) => Promise<Response>)(new Request(`${LOCAL_ORIGIN}/api/hold`))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(STATE)
})

test('a foreign origin -> 403 and nothing is stored', async () => {
  const res = await POST(post({ requestsPaused: true }, 'http://evil.example'))
  expect(res.status).toBe(403)
  expect(setHoldSetting).not.toHaveBeenCalled()
})

test.each([{}, null, { requestsPaused: 'yes' }, { other: true }, { requestsPaused: true, extra: 1 }])('invalid body %j -> 400', async (body) => {
  const res = await POST(post(body))
  expect(res.status).toBe(400)
  expect(setHoldSetting).not.toHaveBeenCalled()
})

test('pausing the requests stores only that key and returns the new state', async () => {
  holdState.mockResolvedValue({ ...STATE, requestsPaused: true })
  const res = await POST(post({ requestsPaused: true }))
  expect(res.status).toBe(200)
  expect(setHoldSetting).toHaveBeenCalledTimes(1)
  expect(setHoldSetting).toHaveBeenCalledWith('requests_paused', true)
  expect((await res.json()).requestsPaused).toBe(true)
})

test('resuming the price checks stores only that key', async () => {
  await POST(post({ priceChecksPaused: false }))
  expect(setHoldSetting).toHaveBeenCalledTimes(1)
  expect(setHoldSetting).toHaveBeenCalledWith('price_checks_paused', false)
})

test('both keys can change in one request', async () => {
  await POST(post({ requestsPaused: false, priceChecksPaused: true }))
  expect(setHoldSetting).toHaveBeenCalledWith('requests_paused', false)
  expect(setHoldSetting).toHaveBeenCalledWith('price_checks_paused', true)
})
