import { storeName } from '@/ingestion/ml/coupons'

export const COUPON_LABEL_SEPARATOR = ' - '

export interface LabeledCoupon {
  title: string
  isStore: boolean
  scopeLabel: string | null
}

export function couponLabel(coupon: LabeledCoupon): string {
  const title = coupon.title.trim()
  const store = coupon.isStore ? storeName(coupon.scopeLabel)?.trim() : undefined
  if (!store) return title
  if (!title) return store
  if (title.toLowerCase().includes(store.toLowerCase())) return title
  return `${title}${COUPON_LABEL_SEPARATOR}${store}`
}
