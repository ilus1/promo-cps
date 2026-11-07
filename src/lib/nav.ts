import { PRODUCT_PATH, ROUTES } from './routes'

function within(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === ROUTES.products ? pathname === href || within(pathname, PRODUCT_PATH) : within(pathname, href)
}
