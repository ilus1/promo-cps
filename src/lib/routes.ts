export const ROUTES = {
  products: '/',
  coupons: '/cupons',
  account: '/conta',
} as const

export const PRODUCT_PATH = '/produtos'
export const STOPPED_PARAM = 'parado'
const STOPPED_ON = '1'

export function productHref(id: string): string {
  return `${PRODUCT_PATH}/${encodeURIComponent(id)}`
}

export function stoppedHref(): string {
  return `${ROUTES.products}?${STOPPED_PARAM}=${STOPPED_ON}`
}

export function isStopped(value: string | string[] | undefined): boolean {
  return value === STOPPED_ON
}
