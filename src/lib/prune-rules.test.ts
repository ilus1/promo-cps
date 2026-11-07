import { expect, test } from 'vitest'
import { DAY_MS } from './constants'
import { PRUNE_BATCH, PRUNE_LOCK_TIMEOUT_MS, PRUNE_MAX_BATCHES, pruneAnotherBatch, PRUNE_COUPON_DAYS, PRUNE_ITEM_DAYS, PRUNE_RUN_DAYS, pruneCutoffs, pruneLine } from './prune-rules'

const now = new Date('2026-11-03T12:00:00Z')

test('each cutoff is its own number of days before now', () => {
  const cutoffs = pruneCutoffs(now)
  expect(now.getTime() - cutoffs.items.getTime()).toBe(PRUNE_ITEM_DAYS * DAY_MS)
  expect(now.getTime() - cutoffs.coupons.getTime()).toBe(PRUNE_COUPON_DAYS * DAY_MS)
  expect(now.getTime() - cutoffs.runs.getTime()).toBe(PRUNE_RUN_DAYS * DAY_MS)
})

test('the ages keep items longest after coupons and runs longest of all', () => {
  expect(PRUNE_COUPON_DAYS).toBeLessThan(PRUNE_ITEM_DAYS)
  expect(PRUNE_ITEM_DAYS).toBeLessThan(PRUNE_RUN_DAYS)
})

test('the log line names the three counts', () => {
  expect(pruneLine({ items: 1, coupons: 2, runs: 3 })).toBe('1 item(ns), 2 cupom(ns), 3 execução(ões)')
})

test('another batch only after a full batch, and never past the per-cycle limit', () => {
  expect(pruneAnotherBatch(PRUNE_BATCH, 1)).toBe(true)
  expect(pruneAnotherBatch(PRUNE_BATCH - 1, 1)).toBe(false)
  expect(pruneAnotherBatch(0, 1)).toBe(false)
  expect(pruneAnotherBatch(PRUNE_BATCH, PRUNE_MAX_BATCHES - 1)).toBe(true)
  expect(pruneAnotherBatch(PRUNE_BATCH, PRUNE_MAX_BATCHES)).toBe(false)
})

test('a lock timeout of a few seconds', () => {
  expect(PRUNE_LOCK_TIMEOUT_MS).toBeGreaterThan(0)
  expect(PRUNE_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(10_000)
})
