import { describe, expect, it } from 'vitest'
import { lastByKey } from './batch'

describe('lastByKey', () => {
  it('keeps one row per key, the last one seen, in first-seen order', () => {
    const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'a', v: 3 }]
    expect(lastByKey(rows, (r) => r.id)).toEqual([{ id: 'a', v: 3 }, { id: 'b', v: 2 }])
  })
  it('returns an empty list for no rows', () => {
    expect(lastByKey([], String)).toEqual([])
  })
})
