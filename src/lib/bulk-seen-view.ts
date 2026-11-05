import { DEAL_FILTER_KEYS, filterParams, type DealFilterKey, type DealFilters } from './deal-query'
import { formatCount } from './format'

export const BULK_SEEN_PAGE_LABEL = 'Marcar esta página como vista'
export const BULK_SEEN_CONSEQUENCE_TEXT = 'Eles saem de Novos e dos alertas até o preço cair.'
export const BULK_SEEN_CANCEL_ACTION = 'Cancelar'

export interface BulkSeenLabels {
  page: string
  filtered: string | null
  confirm: string
  confirmAction: string
  cancelAction: string
}

export function bulkSeenLabels(pageCount: number, total: number, filtered: boolean): BulkSeenLabels {
  const count = formatCount(total)
  return {
    page: BULK_SEEN_PAGE_LABEL,
    filtered: total <= pageCount ? null : filtered ? `Marcar os ${count} filtrados como vistos` : `Marcar todos os ${count} de Novos como vistos`,
    confirm: `${filtered
      ? `Marcar ${count} ${total === 1 ? 'item como visto' : 'itens como vistos'}?`
      : `Marcar todos os ${count} itens de Novos como vistos?`} ${BULK_SEEN_CONSEQUENCE_TEXT}`,
    confirmAction: total === 1 ? 'Marcar 1' : `Marcar os ${count}`,
    cancelAction: BULK_SEEN_CANCEL_ACTION,
  }
}

export function markedText(marked: number): string {
  return `${formatCount(marked)} ${marked === 1 ? 'marcado como visto' : 'marcados como vistos'}`
}

const WIDENING_KEYS: readonly DealFilterKey[] = ['sort', 'antigos', 'inflados']

export function narrowsList(filters: DealFilters): boolean {
  const values = filterParams(filters)
  return DEAL_FILTER_KEYS.some((key) => !WIDENING_KEYS.includes(key) && values[key] !== undefined)
}
