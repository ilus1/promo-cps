import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, resetFakeDb } from './__fixtures__/fake-db'
import { saveChecks, type PriceCheckRow } from './price-checks'

const NOW = new Date('2026-11-04T12:00:00Z')
const row = (key: string, status: PriceCheckRow['status']): PriceCheckRow => ({
  key, itemId: key, checkedAt: NOW, status, query: 'q', confidence: null, mlPriceCents: 100, marketLowCents: null, secondLowCents: null,
  marketStore: null, storeCount: null, offers: [], sourceUrl: '', reason: null,
})

beforeEach(resetFakeDb)

test('many checks are written in one upsert that overwrites every column but the key, the last row of a key winning', async () => {
  await saveChecks([row('MLB1', 'no_match'), row('MLB2', 'no_match'), row('MLB1', 'matched')])
  expect(captured).toHaveLength(1)
  const [upsert] = captured
  expect(upsert.sql).toMatch(/^insert into "price_checks" \(.*\) values \(\$1, .*\), \(\$\d+, .*\) on conflict \("key"\) do update set /)
  expect(upsert.sql.endsWith('"item_id" = excluded."item_id", "checked_at" = excluded."checked_at", "status" = excluded."status", '
    + '"confidence" = excluded."confidence", "query" = excluded."query", "ml_price_cents" = excluded."ml_price_cents", '
    + '"market_low_cents" = excluded."market_low_cents", "second_low_cents" = excluded."second_low_cents", '
    + '"market_store" = excluded."market_store", "store_count" = excluded."store_count", "offers" = excluded."offers", '
    + '"source_url" = excluded."source_url", "reason" = excluded."reason"')).toBe(true)
  expect(upsert.sql).not.toContain('"key" = excluded')
  expect(upsert.params.filter((param) => param === 'MLB1')).toHaveLength(2)
  expect(upsert.params.filter((param) => param === 'matched')).toHaveLength(1)
  expect(upsert.params.filter((param) => param === 'no_match')).toHaveLength(1)
})

test('no checks send nothing', async () => {
  await saveChecks([])
  expect(captured).toEqual([])
})
