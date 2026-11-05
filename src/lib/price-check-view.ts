import { PRICE_CHECK_SUMMARY_HOURS } from './constants'
import { formatAgo, formatCount } from './format'
import type { PriceCheckStatus } from './domain'

export const NO_CHECK_YET_TEXT = 'Nenhuma verificação ainda'

export interface PriceCheckSummaryView {
  lastCheckedAt: Date | null
  counts: Record<PriceCheckStatus, number>
}

export interface PriceCheckPanel {
  last: string
  counts: string
  inflated: string
}

export function priceCheckPanel(summary: PriceCheckSummaryView, inflatedNow: number, now: Date): PriceCheckPanel {
  const { matched, no_match: noMatch, failed } = summary.counts
  const checked = `${formatCount(matched + noMatch)} ${matched + noMatch === 1 ? 'verificado' : 'verificados'}`
  const failures = failed > 0 ? `, ${formatCount(failed)} ${failed === 1 ? 'falha' : 'falhas'}` : ''
  return {
    last: summary.lastCheckedAt ? `Última verificação ${formatAgo(summary.lastCheckedAt, now)}` : NO_CHECK_YET_TEXT,
    counts: `Nas últimas ${PRICE_CHECK_SUMMARY_HOURS} h: ${checked}, ${formatCount(matched)} com equivalente${failures}`,
    inflated: `Descontos inflados ativos: ${formatCount(inflatedNow)}`,
  }
}
