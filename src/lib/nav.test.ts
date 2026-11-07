import { expect, test } from 'vitest'
import { isActivePath } from './nav'
import { productHref, ROUTES } from './routes'

test('the products route is active on the root and on a product page, not elsewhere', () => {
  expect(isActivePath('/', ROUTES.products)).toBe(true)
  expect(isActivePath(productHref('abc'), ROUTES.products)).toBe(true)
  expect(isActivePath(ROUTES.coupons, ROUTES.products)).toBe(false)
  expect(isActivePath('/produtos-extra', ROUTES.products)).toBe(false)
})

test('a section is active on itself and its children, not on a lookalike', () => {
  expect(isActivePath(ROUTES.coupons, ROUTES.coupons)).toBe(true)
  expect(isActivePath(`${ROUTES.coupons}/7`, ROUTES.coupons)).toBe(true)
  expect(isActivePath('/cupons-extra', ROUTES.coupons)).toBe(false)
})

test('a product link encodes its id', () => {
  expect(productHref('a/b c')).toBe('/produtos/a%2Fb%20c')
})
