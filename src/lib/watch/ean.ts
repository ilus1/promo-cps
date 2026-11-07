const NON_DIGITS = /\D/g
const EAN_INPUT = /^[\d\s.-]*$/
const ONLY_DIGITS = /^\d+$/
const ONLY_ZEROS = /^0+$/
const GTIN_LENGTHS: ReadonlySet<number> = new Set([8, 12, 13, 14])
const GTIN_KEY_LENGTH = 14
const CHECK_MODULUS = 10
const ODD_WEIGHT = 3
const EVEN_WEIGHT = 1
const PAD_DIGIT = '0'

export function normalizeEan(raw: string): string {
  return raw.replace(NON_DIGITS, '')
}

export function isValidGtin(code: string): boolean {
  if (!ONLY_DIGITS.test(code) || !GTIN_LENGTHS.has(code.length) || ONLY_ZEROS.test(code)) return false
  const digits = [...code].map(Number)
  const check = digits.pop()
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? ODD_WEIGHT : EVEN_WEIGHT), 0)
  return (CHECK_MODULUS - (sum % CHECK_MODULUS)) % CHECK_MODULUS === check
}

export function validEan(raw: string | null | undefined): string | null {
  if (!raw || !EAN_INPUT.test(raw)) return null
  const code = normalizeEan(raw)
  return isValidGtin(code) ? code : null
}

export function sameGtin(left: string, right: string): boolean {
  return left.padStart(GTIN_KEY_LENGTH, PAD_DIGIT) === right.padStart(GTIN_KEY_LENGTH, PAD_DIGIT)
}
