import { beforeEach, expect, test, vi } from 'vitest'
import { holdStop, isRunStop } from '../errors'
import { activate } from './activate'
import { loadBreaker } from './breaker'

const mocks = vi.hoisted(() => ({
  applyCoupon: vi.fn(),
  recordActivation: vi.fn(),
  activationCandidates: vi.fn(),
  matchOnPage: vi.fn(),
}))

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => undefined) }))
vi.mock('@/env', () => ({ env: () => ({ PAGE_DELAY_MS: 0 }) }))
vi.mock('@/db/coupons', () => ({
  activationCandidates: mocks.activationCandidates,
  recordActivation: mocks.recordActivation,
}))
vi.mock('../ml/activate-click', () => ({
  applyCoupon: mocks.applyCoupon,
  COUPON_WITHOUT_APPLY: 'sem botão',
  matchOnPage: mocks.matchOnPage,
}))
vi.mock('../ml/coupons', () => ({ tryParseCouponPage: () => ({ ok: true, page: { coupons: [] } }) }))
vi.mock('../ml/page-state', () => ({
  loadPageProps: async () => ({ finalUrl: 'https://x/page', pageProps: {} }),
  throwIfClosed: () => undefined,
}))

const page = { url: () => 'https://x/page' } as never
const NOW = new Date('2026-11-03T12:00:00Z')
const HOLD = { kind: 'vpn', text: 't', reason: 'VPN conectada' } as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.activationCandidates.mockResolvedValue([{ campaignId: 'c1' }, { campaignId: 'c2' }, { campaignId: 'c3' }])
  mocks.matchOnPage.mockReturnValue({
    applicable: ['c1', 'c2', 'c3'].map((campaignId) => ({ candidate: { campaignId }, coupon: { campaignId } })),
    notApplicable: [],
  })
  mocks.applyCoupon.mockResolvedValue({ attempted: true, outcome: { ok: true }, click: 'answered' })
})

test('without a hold every coupon is applied', async () => {
  const result = await activate(page, 3, NOW, new Map(), loadBreaker(async () => null))
  expect(mocks.applyCoupon).toHaveBeenCalledTimes(3)
  expect(result.activated).toBe(3)
})

test('a hold that appears between coupons stops before the next click, as a hold stop', async () => {
  let checks = 0
  const breaker = loadBreaker(async () => (++checks > 2 ? HOLD : null))
  const e = await activate(page, 3, NOW, new Map(), breaker).then(() => null, (error: unknown) => error)
  expect(isRunStop(e) && e.status).toBe('partial')
  expect(isRunStop(e) && e.counts).toEqual(holdStop(HOLD).counts)
  expect(mocks.applyCoupon).toHaveBeenCalledTimes(1)
  expect(mocks.recordActivation).toHaveBeenCalledTimes(1)
})

test('a hold already on when the first coupon is reached clicks nothing', async () => {
  let checks = 0
  const breaker = loadBreaker(async () => (++checks > 1 ? HOLD : null))
  await expect(activate(page, 3, NOW, new Map(), breaker)).rejects.toMatchObject({ status: 'partial' })
  expect(mocks.applyCoupon).not.toHaveBeenCalled()
})
