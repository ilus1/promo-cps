import { expect, test } from 'vitest'
import { withoutKeys } from './browser-env'

test('drops the listed keys and keeps the rest without touching the source', () => {
  const source = { DATABASE_URL: 'postgres://x', PORT: '8510', PATH: '/bin', HOME: '/home/a' }
  expect(withoutKeys(source, ['DATABASE_URL', 'PORT'])).toEqual({ PATH: '/bin', HOME: '/home/a' })
  expect(source).toHaveProperty('DATABASE_URL')
})

test('a key that is not present or an empty list changes nothing', () => {
  expect(withoutKeys({ PATH: '/bin' }, ['MISSING'])).toEqual({ PATH: '/bin' })
  expect(withoutKeys({ PATH: '/bin' }, [])).toEqual({ PATH: '/bin' })
  expect(withoutKeys({}, ['PATH'])).toEqual({})
})
