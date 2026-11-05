import { expect, test } from 'vitest'
import { BASIS_POINTS, isMeaningfulDrop, keepBasisPoints } from './price-drop'

test('exactly 1% and R$ 1 lower is a meaningful drop, one cent less is not', () => {
  expect(isMeaningfulDrop(9900, 10000)).toBe(true)
  expect(isMeaningfulDrop(9901, 10000)).toBe(false)
  expect(isMeaningfulDrop(900, 1000)).toBe(true)
  expect(isMeaningfulDrop(901, 1000)).toBe(false)
})

test('a drop under R$ 1 is never meaningful, even when it is over 1%', () => {
  expect(isMeaningfulDrop(50, 100)).toBe(false)
  expect(isMeaningfulDrop(0, 100)).toBe(true)
  expect(isMeaningfulDrop(0, 99)).toBe(false)
})

test('the same or a higher price is not a drop', () => {
  expect(isMeaningfulDrop(10000, 10000)).toBe(false)
  expect(isMeaningfulDrop(10100, 10000)).toBe(false)
})

test('the kept share is derived in basis points, so a fractional ratio is not rounded to a whole percent', () => {
  expect(keepBasisPoints(0.01)).toBe(9900)
  expect(keepBasisPoints(0.005)).toBe(9950)
  expect(keepBasisPoints(0.0125)).toBe(9875)
  expect(BASIS_POINTS).toBe(10_000)
})
