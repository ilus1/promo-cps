import { EMPTY_PAGE_TEXT, type EmptyAction } from './coupon-empty'

export const EMPTY_DEALS_TEXT = 'Nenhuma oferta ainda. Rode um ciclo em Conta.'
export const EMPTY_FILTERED_DEALS_TEXT = 'Nenhuma oferta com estes filtros.'
export const EMPTY_TAB_TEXT = 'Nenhuma oferta nesta aba.'

export interface DealEmptyInput {
  shown: number
  total: number
  filtered: boolean
  anyTab: number
}

export function dealEmptyState({ shown, total, filtered, anyTab }: DealEmptyInput): { text: string; action: EmptyAction | null } | null {
  if (shown > 0) return null
  if (total > 0) return { text: EMPTY_PAGE_TEXT, action: 'first-page' }
  if (anyTab > 0) return { text: EMPTY_TAB_TEXT, action: null }
  if (filtered) return { text: EMPTY_FILTERED_DEALS_TEXT, action: 'clear-filters' }
  return { text: EMPTY_DEALS_TEXT, action: 'account' }
}
