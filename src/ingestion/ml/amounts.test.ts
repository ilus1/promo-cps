import { describe, expect, it } from 'vitest'
import { parseAmountCents } from './amounts'

describe('parseAmountCents', () => {
  it.each([
    ['85', '0', 8500],
    ['4.999', '0', 499900],
    ['10.000', '0', 1000000],
    ['16', '99', 1699],
    ['16', '5', 1650],
    ['600', undefined, 60000],
  ])('%s,%s -> %s', (f, d, cents) => expect(parseAmountCents(f, d)).toBe(cents))
  it.each([
    [undefined, '0'], ['', '0'], ['1,5', '0'], ['abc', '0'], ['10', 'x'],
    ['1.5', '0'], ['1..000', '0'], ['16.99', '0'], ['16', '995'],
  ])('rejects %s,%s', (f, d) => expect(parseAmountCents(f, d)).toBeNull())
})
