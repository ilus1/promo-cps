import { CENTS_PER_REAL, MAX_DISCOUNT_PERCENT } from './constants'
import { storableText } from './storable-text'

const INT4_MAX = 2147483647
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: string): boolean {
  return UUID_SHAPE.test(v)
}

export type QueryParams = Record<string, string | string[] | undefined>

export function lookup<K extends string>(map: Record<K, string>, keys: readonly K[], value: string | undefined): K | undefined {
  return keys.find((key) => map[key] === value)
}

export function num(v: string | string[] | undefined): number | undefined {
  if (typeof v !== 'string' || v === '') return undefined
  const n = Number(v)
  return (Number.isFinite(n) && n >= 0 && n <= INT4_MAX) ? n : undefined
}

export function str(v: string | string[] | undefined): string | undefined {
  const text = typeof v === 'string' ? storableText(v) : ''
  return text !== '' ? text : undefined
}

export function centsFromReais(v: string | string[] | undefined): number | undefined {
  const reais = num(v)
  if (reais === undefined) return undefined
  const cents = Math.round(reais * CENTS_PER_REAL)
  return cents <= INT4_MAX ? cents : undefined
}

export function wholePercent(n: number | undefined): number | undefined {
  const whole = Math.ceil(n ?? 0)
  return whole > 0 ? Math.min(whole, MAX_DISCOUNT_PERCENT) : undefined
}
