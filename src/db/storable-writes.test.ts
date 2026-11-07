import { beforeEach, expect, test, vi } from 'vitest'
import type { ParsedCoupon, RawCoupon } from '@/ingestion/ml/coupons'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb } from './__fixtures__/fake-db'
import { recordActivation, upsertCoupons, couponRow } from './coupons'
import { finishRun } from './runs'

const NUL = '\u0000'
const NOW = new Date('2026-11-05T01:39:00Z')
const dirty = (text: string) => `${NUL}${text}${NUL}mid${NUL}`

const parsed: ParsedCoupon = {
  campaignId: dirty('C1'),
  title: dirty('10% OFF'),
  kind: 'percent',
  percentOff: 10,
  amountOffCents: null,
  minPaymentCents: null,
  capCents: 5000,
  scopeLabel: dirty('Loja X'),
  isStore: true,
  status: dirty('inactive'),
  activationType: dirty('eu_quero'),
  activateCode: dirty('CODE'),
  listingUrl: dirty('https://www.mercadolivre.com.br/cupons/x'),
  startsAt: NOW,
  expiresAt: null,
}

const raw = { title: dirty('10% OFF'), items: [{ image_url: dirty('https://http2.mlstatic.com/i.webp'), alt_text: dirty('Fone') }] } as unknown as RawCoupon

const hasNul = (value: unknown): boolean => JSON.stringify(value).includes('\\u0000')
const capturedHasNul = () => captured.some((query) => query.params.some(hasNul))

beforeEach(resetFakeDb)

test('a coupon row holds no NUL in any string field or in its raw JSON', () => {
  const row = couponRow(parsed, raw, NOW)
  expect(hasNul(row)).toBe(false)
  expect(row.startsAt).toBe(NOW)
  expect(row.campaignId).toBe('C1mid')
})

test('the coupon upsert and an activation error send no NUL', async () => {
  queueRows([[true]])
  await upsertCoupons([{ parsed, raw }], NOW)
  await recordActivation('C1', { ok: false, error: dirty('timeout') }, NOW)
  expect(capturedHasNul()).toBe(false)
})

test('a run error sends no NUL', async () => {
  queueRows([['R1']])
  await finishRun('R1', { status: 'failed', pages: 0, counts: {}, error: dirty('invalid byte sequence') }).catch(() => undefined)
  expect(captured.length).toBeGreaterThanOrEqual(1)
  expect(capturedHasNul()).toBe(false)
})
