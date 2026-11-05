import type { CouponListStatus } from './domain'
import { formatCount } from './format'

export function couponCountLine(total: number, valid: number | null, status: CouponListStatus | undefined): string {
  if (status !== undefined || valid === null) return `${formatCount(total)} ${total === 1 ? 'cupom encontrado' : 'cupons encontrados'}`
  return `${formatCount(total)} ${total === 1 ? 'cupom' : 'cupons'}, ${formatCount(valid)} ${valid === 1 ? 'válido' : 'válidos'}`
}
