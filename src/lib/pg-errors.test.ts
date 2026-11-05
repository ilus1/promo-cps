import { expect, test } from 'vitest'
import { isUniqueViolation, PG_UNIQUE_VIOLATION } from './pg-errors'

test('recognizes the unique violation directly and as the cause of a wrapped query error', () => {
  expect(isUniqueViolation(Object.assign(new Error('dup'), { code: PG_UNIQUE_VIOLATION }))).toBe(true)
  expect(isUniqueViolation(new Error('wrapped', { cause: { code: PG_UNIQUE_VIOLATION } }))).toBe(true)
})

test('other codes, plain values and missing causes are not unique violations', () => {
  expect(isUniqueViolation(Object.assign(new Error('fk'), { code: '23503' }))).toBe(false)
  expect(isUniqueViolation(new Error('no code'))).toBe(false)
  expect(isUniqueViolation(new Error('wrapped', { cause: 'text' }))).toBe(false)
  expect(isUniqueViolation(null)).toBe(false)
  expect(isUniqueViolation(undefined)).toBe(false)
  expect(isUniqueViolation(PG_UNIQUE_VIOLATION)).toBe(false)
})
