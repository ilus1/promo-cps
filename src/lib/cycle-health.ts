import { DAY_MS, HALF_DIVISOR, HOUR_MS, PERCENT_BASE } from './constants'
import { CYCLE_COUNT } from './cycle-counts'
import { SKIPPED_ENTRIES_LABEL } from './labels'

export const HEALTH_MIN_SEEN_PERCENT = 90
export const HEALTH_MAX_UNPARSED_PERCENT = 5
export const HEALTH_MIN_ITEMS_PER_PAGE = 20
export const HEALTH_MAX_DROPPED_PERCENT = 5
export const HEALTH_MAX_FAILED_LISTINGS_PERCENT = 10
export const HEALTH_MAX_BASIS_OTHER_PERCENT = 5
export const HEALTH_NOTIFY_EVERY_MS = DAY_MS
export const HEALTH_PREFIX = 'O leitor do Mercado Livre pode ter mudado'

export const HEALTH_TEXT = {
  fewCoupons: `cupons lidos abaixo de ${HEALTH_MIN_SEEN_PERCENT}% do total do ML`,
  skipped: `${SKIPPED_ENTRIES_LABEL} na lista de cupons`,
  unparsed: `mais de ${HEALTH_MAX_UNPARSED_PERCENT}% dos cupons não reconhecidos`,
  fewItems: `menos de ${HEALTH_MIN_ITEMS_PER_PAGE} ofertas por listagem lida`,
  dropped: `mais de ${HEALTH_MAX_DROPPED_PERCENT}% dos produtos descartados`,
  listings: `mais de ${HEALTH_MAX_FAILED_LISTINGS_PERCENT}% das listagens falharam ou vieram vazias`,
  noLinks: 'nenhum vínculo de cupom gravado',
  basisOther: `mais de ${HEALTH_MAX_BASIS_OTHER_PERCENT}% das ofertas com base de preço desconhecida`,
} as const

export type HealthCode = keyof typeof HEALTH_TEXT

export const HEALTH_CODES = Object.keys(HEALTH_TEXT) as readonly HealthCode[]

type Counts = Readonly<Record<string, number | undefined>>

function count(counts: Counts, key: string): number {
  const value = counts[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function overPercent(part: number, whole: number, percent: number): boolean {
  return whole > 0 && part * PERCENT_BASE > whole * percent
}

export function cycleHealth(counts: Counts): HealthCode[] {
  const seen = count(counts, CYCLE_COUNT.seen)
  const total = count(counts, CYCLE_COUNT.totalCoupons)
  const pages = count(counts, CYCLE_COUNT.discoveryPages)
  const read = count(counts, CYCLE_COUNT.discoveryRead)
  const cards = count(counts, CYCLE_COUNT.discoveryCards)
  const warnings: Record<HealthCode, boolean> = {
    fewCoupons: counts[CYCLE_COUNT.seen] === 0 || (total > 0 && seen * PERCENT_BASE < total * HEALTH_MIN_SEEN_PERCENT),
    skipped: count(counts, CYCLE_COUNT.skipped) > 0,
    unparsed: overPercent(count(counts, CYCLE_COUNT.unparsed), seen, HEALTH_MAX_UNPARSED_PERCENT),
    fewItems: read > 0 && cards < read * HEALTH_MIN_ITEMS_PER_PAGE,
    dropped: overPercent(count(counts, CYCLE_COUNT.droppedCards), cards, HEALTH_MAX_DROPPED_PERCENT),
    listings: overPercent(
      count(counts, CYCLE_COUNT.discoveryFailed) + count(counts, CYCLE_COUNT.discoveryEmpty), pages, HEALTH_MAX_FAILED_LISTINGS_PERCENT,
    ),
    noLinks: read > 0 && count(counts, CYCLE_COUNT.discoveryLinks) === 0,
    basisOther: overPercent(count(counts, CYCLE_COUNT.discoveryBasisOther), cards, HEALTH_MAX_BASIS_OTHER_PERCENT),
  }
  return HEALTH_CODES.filter((code) => warnings[code])
}

export function healthMask(codes: readonly HealthCode[]): number {
  return codes.reduce((mask, code) => mask | (1 << HEALTH_CODES.indexOf(code)), 0)
}

export function healthCodes(mask: number | undefined): HealthCode[] {
  if (typeof mask !== 'number' || !Number.isInteger(mask) || mask <= 0) return []
  return HEALTH_CODES.filter((_, index) => (mask & (1 << index)) !== 0)
}

export function healthLine(codes: readonly HealthCode[]): string | null {
  if (codes.length === 0) return null
  return `${HEALTH_PREFIX}: ${codes.map((code) => HEALTH_TEXT[code]).join('; ')}`
}

export function healthBannerText(counts: Counts | null | undefined): string | null {
  return healthLine(healthCodes(counts?.[CYCLE_COUNT.health]))
}

export interface HealthNotifyInput {
  mask: number
  previousMask: number
  lastNotifiedAt: Date | null
  startedAt: Date
  cycleEveryHours: number
}

export function reminderToleranceMs(cycleEveryHours: number): number {
  return cycleEveryHours * HOUR_MS / HALF_DIVISOR
}

export function shouldNotifyHealth({ mask, previousMask, lastNotifiedAt, startedAt, cycleEveryHours }: HealthNotifyInput): boolean {
  if (mask === 0) return false
  if ((mask & ~previousMask) !== 0) return true
  return lastNotifiedAt === null || startedAt.getTime() - lastNotifiedAt.getTime() >= HEALTH_NOTIFY_EVERY_MS - reminderToleranceMs(cycleEveryHours)
}
