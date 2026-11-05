import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('./client', async () => ({ db: (await import('./__fixtures__/fake-db')).fakeDb }))

import { captured, queueRows, resetFakeDb } from './__fixtures__/fake-db'
import { loadCrawlerState, saveCrawlerState } from './crawler-state'

const UPDATED = '2026-11-04T12:00:00.000Z'
const stateRow = (site: string, pagesToday: number) => [site, { departmentIndex: 2, page: 7 }, 1, null, '2026-11-04', pagesToday, null, null, null, null, UPDATED]

beforeEach(resetFakeDb)

test('an existing state row is read as it is, with one query', async () => {
  queueRows([stateRow('kabum', 12)])
  const state = await loadCrawlerState('kabum')
  expect(state).toMatchObject({ site: 'kabum', cursor: { departmentIndex: 2, page: 7 }, backoffLevel: 1, dayKey: '2026-11-04', pagesToday: 12 })
  expect(state.updatedAt).toEqual(new Date(UPDATED))
  expect(captured).toHaveLength(1)
  expect(captured[0].sql).toMatch(/from "crawler_state" where "crawler_state"\."site" = \$1 limit \$2$/)
  expect(captured[0].params).toEqual(['kabum', 1])
})

test('a missing state row is created with the defaults and returned', async () => {
  queueRows([], [stateRow('amazon', 0)])
  expect(await loadCrawlerState('amazon')).toMatchObject({ site: 'amazon', pagesToday: 0 })
  expect(captured[1].sql).toMatch(/^insert into "crawler_state" .* values \(\$1, default, .*\) on conflict do nothing returning /)
  expect(captured[1].params).toEqual(['amazon'])
})

test('a row created by a concurrent caller is read back instead', async () => {
  queueRows([], [], [stateRow('amazon', 3)])
  expect(await loadCrawlerState('amazon')).toMatchObject({ site: 'amazon', pagesToday: 3 })
  expect(captured).toHaveLength(3)
})

test('a save writes only the patched columns and stamps the update time', async () => {
  await saveCrawlerState('kabum', { pagesToday: 3, cursor: { departmentIndex: 1, page: 2 } })
  const [upsert] = captured
  expect(upsert.sql).toMatch(/on conflict \("site"\) do update set "cursor" = \$4, "pages_today" = \$5, "updated_at" = now\(\)$/)
  expect(upsert.params).toEqual(['kabum', '{"departmentIndex":1,"page":2}', 3, '{"departmentIndex":1,"page":2}', 3])
})
