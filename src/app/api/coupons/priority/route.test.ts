import { beforeEach, expect, test, vi } from 'vitest'
import { POST } from './route'

const { PORT, prioritizeCoupons, autoRunStatus, cycleActivity } = vi.hoisted(() => ({
  PORT: 8510, prioritizeCoupons: vi.fn(), autoRunStatus: vi.fn(), cycleActivity: vi.fn(),
}))
vi.mock('@/env', () => ({ env: () => ({ PORT }) }))
vi.mock('@/db/coupons', () => ({ prioritizeCoupons }))
vi.mock('@/ingestion/auto-run', () => ({ autoRunStatus }))
vi.mock('@/ingestion/cycle', () => ({ cycleActivity }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const NEXT_RUN = new Date('2026-11-03T01:31:00Z')

const post = (body: unknown, origin: string | null = LOCAL_ORIGIN) => new Request(`${LOCAL_ORIGIN}/api/coupons/priority`, {
  method: 'POST',
  headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  prioritizeCoupons.mockResolvedValue(7)
  cycleActivity.mockReturnValue({ phase: 'idle' })
  autoRunStatus.mockReturnValue({ enabled: true, running: false, nextRunAt: new Date(NEXT_RUN.getTime() - 1), cycleNextRunAt: NEXT_RUN, pause: null })
})

test('prioritizes the coupons matching the parsed query and returns the next run', async () => {
  const res = await POST(post({ query: 'q=M%C3%B3veis&status=ativo&ordem=vence&page=3' }))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ prioritized: 7, cycleNextRunAt: NEXT_RUN.toISOString(), pause: null, running: false })
  expect(prioritizeCoupons).toHaveBeenCalledTimes(1)
  const [filters, now] = prioritizeCoupons.mock.calls[0]
  expect(filters).toMatchObject({ status: 'active', text: 'Móveis' })
  expect(now).toBeInstanceOf(Date)
})

test('a query with no coupon filters -> 422 and nothing is written', async () => {
  for (const query of ['', 'ordem=vence&pagina=2', 'zzz=1', '%%%=&&zzz']) {
    const res = await POST(post({ query }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'coupon_filter_required' })
  }
  expect(prioritizeCoupons).not.toHaveBeenCalled()
})

test.each(['queued', 'running'])('a manual cycle in phase %s counts as running', async (phase) => {
  cycleActivity.mockReturnValue({ phase })
  expect(await (await POST(post({ query: 'q=a' }))).json()).toMatchObject({ running: true })
})

test('reports a running cycle', async () => {
  autoRunStatus.mockReturnValue({ enabled: true, running: true, cycleNextRunAt: NEXT_RUN, pause: null })
  expect(await (await POST(post({ query: 'q=a' }))).json()).toMatchObject({ running: true })
})

test('zero matches -> 200 with prioritized 0', async () => {
  prioritizeCoupons.mockResolvedValue(0)
  expect(await (await POST(post({ query: 'q=zzz' }))).json()).toMatchObject({ prioritized: 0 })
})

test('returns the pause text and no time while automatic runs are paused or off', async () => {
  autoRunStatus.mockReturnValue({ enabled: true, running: false, cycleNextRunAt: null, pause: 'sessão do Mercado Livre expirada' })
  expect(await (await POST(post({ query: 'q=a' }))).json())
    .toEqual({ prioritized: 7, cycleNextRunAt: null, pause: 'sessão do Mercado Livre expirada', running: false })
})

test('a missing or non-string query, extra keys or invalid JSON -> 400', async () => {
  for (const body of [{}, { query: 5 }, { query: '', extra: 1 }, 'not json']) {
    const res = await POST(post(body))
    expect(res.status).toBe(400)
  }
  expect(prioritizeCoupons).not.toHaveBeenCalled()
})

test('a request from a foreign origin -> 403 and nothing is written', async () => {
  const res = await POST(post({ query: 'q=a' }, 'http://evil.example'))
  expect(res.status).toBe(403)
  expect(prioritizeCoupons).not.toHaveBeenCalled()
})
