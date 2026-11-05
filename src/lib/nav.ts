import { ROUTES } from './routes'

export function isActivePath(pathname: string, href: string): boolean {
  return href === ROUTES.offers ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
}
