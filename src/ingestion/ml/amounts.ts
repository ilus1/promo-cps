import { CENTS_PER_REAL } from '@/lib/constants'

const PT_BR_INTEGER = /^\d{1,3}(?:\.\d{3})*$|^\d+$/
const CENTS = /^\d{1,2}$/
const THOUSANDS_DOT = /\./g

export function parseAmountCents(fractional: string | undefined, decimal: string | undefined): number | null {
  const centsText = decimal ?? '0'
  if (!fractional || !PT_BR_INTEGER.test(fractional) || !CENTS.test(centsText)) return null
  const whole = Number(fractional.replace(THOUSANDS_DOT, ''))
  const cents = Number(centsText.padEnd(2, '0'))
  return whole * CENTS_PER_REAL + cents
}
