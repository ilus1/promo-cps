import { PAGE_SIZE } from './constants'
import { str, type QueryParams } from './query-params'

export const MAX_PAGE = 10000
export const PAGE_PARAM = 'pagina'
export const FIRST_PAGE = 1

export function clampPage(page: number): number {
  return Number.isFinite(page) ? Math.min(MAX_PAGE, Math.max(FIRST_PAGE, Math.floor(page))) : FIRST_PAGE
}

export function pageFromParams(sp: QueryParams): number {
  return clampPage(Number(str(sp[PAGE_PARAM]) ?? FIRST_PAGE))
}

export function pageOffset(page: number, limit: number = PAGE_SIZE): number {
  return (clampPage(page) - FIRST_PAGE) * limit
}
