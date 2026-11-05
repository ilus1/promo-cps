import { expect, test } from 'vitest'
import { BULK_SEEN_CLOCK_SKEW_MS, BULK_SEEN_MAX_IDS, parseBulkSeen } from './bulk-seen'
import { OFERTAS_QUERY_MAX } from './constants'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const AS_OF = '2026-11-03T11:59:00.000Z'

test('an id list is kept without duplicates, with the render time', () => {
  expect(parseBulkSeen({ ids: ['MLB1', 'MLB2', 'MLB1'], asOf: AS_OF }, NOW))
    .toEqual({ ids: ['MLB1', 'MLB2'], asOf: new Date(AS_OF) })
})

test('a query is parsed with the Ofertas filter parser', () => {
  const target = parseBulkSeen({ query: 'q=fone&precoMax=100&ofertas=1&aba=salvos&pagina=3', asOf: AS_OF }, NOW)
  expect(target).toMatchObject({ filters: { text: 'fone', priceMaxCents: 10000, offersOnly: true } })
})

test('an empty query means no filters', () => {
  expect(parseBulkSeen({ query: '', asOf: AS_OF }, NOW)).toMatchObject({ filters: { offersOnly: false, includeStale: false } })
})

test('asOf may be at most the clock skew ahead of now', () => {
  const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
  expect(parseBulkSeen({ ids: ['MLB1'], asOf: ahead(BULK_SEEN_CLOCK_SKEW_MS) }, NOW).asOf.getTime())
    .toBe(NOW.getTime() + BULK_SEEN_CLOCK_SKEW_MS)
  expect(() => parseBulkSeen({ ids: ['MLB1'], asOf: ahead(BULK_SEEN_CLOCK_SKEW_MS + 1) }, NOW)).toThrow()
})

test.each([
  null,
  {},
  { ids: ['MLB1'] },
  { query: '' },
  { ids: [], asOf: AS_OF },
  { ids: [''], asOf: AS_OF },
  { ids: [1], asOf: AS_OF },
  { ids: Array.from({ length: BULK_SEEN_MAX_IDS + 1 }, (_, i) => `MLB${i}`), asOf: AS_OF },
  { query: 'x'.repeat(OFERTAS_QUERY_MAX + 1), asOf: AS_OF },
  { query: 5, asOf: AS_OF },
  { ids: ['MLB1'], query: '', asOf: AS_OF },
  { ids: ['MLB1'], asOf: 'yesterday' },
  { ids: ['MLB1'], asOf: 5 },
])('invalid body %j is rejected', (body) => {
  expect(() => parseBulkSeen(body, NOW)).toThrow()
})
