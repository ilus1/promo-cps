export const EMPTY_TABLE_TEXT = 'Nenhum cupom ainda. Rode um ciclo em Conta.'
export const EMPTY_FILTERED_TEXT = 'Nenhum cupom com esses filtros.'
export const EMPTY_PAGE_TEXT = 'Esta página não existe.'

export type EmptyAction = 'first-page' | 'account' | 'clear-filters'

export const EMPTY_ACTION_LABEL: Record<EmptyAction, string> = {
  'first-page': 'Voltar à primeira página',
  account: 'Ir para Conta',
  'clear-filters': 'Limpar filtros',
}

export interface EmptyInput {
  shown: number
  total: number
  filtered: boolean
  overall: number
}

export function emptyState({ shown, total, filtered, overall }: EmptyInput): { text: string; action: EmptyAction } | null {
  if (shown > 0) return null
  if (total > 0) return { text: EMPTY_PAGE_TEXT, action: 'first-page' }
  if (filtered && overall > 0) return { text: EMPTY_FILTERED_TEXT, action: 'clear-filters' }
  return { text: EMPTY_TABLE_TEXT, action: 'account' }
}
