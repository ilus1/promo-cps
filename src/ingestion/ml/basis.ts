import type { Basis } from '@/lib/domain'

const PIX = /\bpix\b/i
const COUPON = /\bcupom\b/i

export function basisFromComplement(text: string | undefined): Basis {
  const t = text?.trim()
  if (!t) return 'none'
  const pix = PIX.test(t)
  const coupon = COUPON.test(t)
  if (pix && coupon) return 'pix_coupon'
  if (pix) return 'pix'
  if (coupon) return 'coupon'
  return 'other'
}

export const COUPON_BASES: readonly Basis[] = ['coupon', 'pix_coupon']
