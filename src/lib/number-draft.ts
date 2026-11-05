const NON_DIGITS = /\D/g
const NON_DECIMAL = /[^\d.,]/g
const DECIMAL_SEPARATOR = /[.,]/
const MAX_DECIMALS = 2

export function digitsDraft(raw: string): string {
  return raw.replace(NON_DIGITS, '')
}

export function decimalDraft(raw: string): string {
  const [whole, ...rest] = raw.replace(NON_DECIMAL, '').split(DECIMAL_SEPARATOR)
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, MAX_DECIMALS)}`
}
