export const PERCENT_OFF = /(\d+(?:,\d+)?)\s*%\s*OFF\b/i

export interface CouponHint {
  text: string
  percentOff: number | null
  amountOffCents: number | null
  priceAfterCents: number | null
}
