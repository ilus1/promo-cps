import { expect, test } from 'vitest'
import { isActivePath } from './nav'
import { ROUTES } from './routes'

test('the offers route is active only on the exact root', () => {
  expect(isActivePath('/', ROUTES.offers)).toBe(true)
  expect(isActivePath(ROUTES.coupons, ROUTES.offers)).toBe(false)
})

test('a section is active on itself and its children, not on a lookalike', () => {
  expect(isActivePath(ROUTES.coupons, ROUTES.coupons)).toBe(true)
  expect(isActivePath(`${ROUTES.coupons}/7`, ROUTES.coupons)).toBe(true)
  expect(isActivePath('/cupons-extra', ROUTES.coupons)).toBe(false)
})
