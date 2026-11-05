import { CENTS_PER_REAL, DAY_MS, PERCENT_BASE, HOUR_MS, MINUTE_MS, SECOND_MS } from './constants'

const HALF_PERCENT = 0.5
const THOUSANDTHS_PER_PERCENT = 1000
const HALF_TENTH_IN_THOUSANDTHS = 50
const THOUSANDTHS_PER_WHOLE = THOUSANDTHS_PER_PERCENT * PERCENT_BASE
const LOCALE = 'pt-BR'
export const TIME_ZONE = 'America/Sao_Paulo'
const JUST_NOW = 'agora'
const SOON = 'em instantes'
const PERCENT = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 })
const PERCENT_ONE_DECIMAL = new Intl.NumberFormat(LOCALE, {
  style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1,
})
const DATE = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeZone: TIME_ZONE })
const DAY_MONTH = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', timeZone: TIME_ZONE })
const TIME = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE })
const DATE_TIME = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short', timeZone: TIME_ZONE })
const COUNT = new Intl.NumberFormat(LOCALE)
const WHOLE_REAIS = { maximumFractionDigits: 0 }
const WITH_CENTAVOS = { minimumFractionDigits: 2, maximumFractionDigits: 2 }

export function formatPrice(price: string | number | null | undefined): string {
  if (price === null || price === undefined || price === '') return 'Sem preço'
  const n = Number(price)
  return `R$ ${n.toLocaleString(LOCALE, Number.isInteger(n) ? WHOLE_REAIS : WITH_CENTAVOS)}`
}

export function formatCents(cents: number): string {
  return formatPrice(cents / CENTS_PER_REAL)
}

export function formatPercent(ratio: number): string {
  return PERCENT.format(ratio)
}

export function formatPercentOneDecimal(ratio: number): string {
  return PERCENT_ONE_DECIMAL.format(ratio)
}

export function savingThresholdRatio(wholePercent: number): number {
  return (wholePercent * THOUSANDTHS_PER_PERCENT - HALF_TENTH_IN_THOUSANDTHS) / THOUSANDTHS_PER_WHOLE
}

export function discountThresholdRatio(wholePercent: number): number {
  return (wholePercent - HALF_PERCENT) / PERCENT_BASE
}

export function formatWholeReais(reais: number): string {
  return `R$ ${COUNT.format(reais)}`
}

export function formatAgo(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime()
  if (diff >= DAY_MS) return `há ${Math.floor(diff / DAY_MS)} d`
  if (diff >= HOUR_MS) return `há ${Math.floor(diff / HOUR_MS)} h`
  if (diff >= MINUTE_MS) return `há ${Math.floor(diff / MINUTE_MS)} min`
  return JUST_NOW
}

export function relativeTime(date: Date, now: Date = new Date()): string {
  const wait = date.getTime() - now.getTime()
  if (wait >= DAY_MS) return `em ${Math.floor(wait / DAY_MS)} d`
  if (wait >= HOUR_MS) return `em ${Math.floor(wait / HOUR_MS)} h`
  if (wait >= MINUTE_MS) return `em ${Math.floor(wait / MINUTE_MS)} min`
  return SOON
}

export function formatDate(date: Date): string {
  return DATE.format(date)
}

export function formatDayMonth(date: Date): string {
  return DAY_MONTH.format(date)
}

export function formatDayMonthTime(date: Date): string {
  return `${DAY_MONTH.format(date)} ${TIME.format(date)}`
}

export function formatDateTime(date: Date): string {
  return DATE_TIME.format(date)
}

export function formatCount(n: number): string {
  return COUNT.format(n)
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / SECOND_MS))
  const hours = Math.floor(total / (HOUR_MS / SECOND_MS))
  const minutes = Math.floor((total % (HOUR_MS / SECOND_MS)) / (MINUTE_MS / SECOND_MS))
  const seconds = total % (MINUTE_MS / SECOND_MS)
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min ${seconds} s`
  return `${seconds} s`
}
