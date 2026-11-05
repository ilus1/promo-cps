import type { PriorityResult } from './api'
import { formatDateTime, relativeTime } from './format'

export const PRIORITY_NONE_TEXT = 'Nenhum cupom com link de ofertas para priorizar neste filtro.'
export const PRIORITY_UNSCHEDULED_TEXT = 'sem execução agendada'
export const PRIORITY_BUTTON_LABEL = 'Priorizar no próximo ciclo'
export const PRIORITY_BUSY_LABEL = 'Priorizando...'
export const PRIORITY_BADGE_LABEL = 'Prioridade'
export const PRIORITY_CURRENT_TEXT = 'o ciclo em andamento ou o próximo'

function whenText(result: PriorityResult, now: Date): string | null {
  if (result.pause !== null) return result.pause
  if (result.cycleNextRunAt === null) return PRIORITY_UNSCHEDULED_TEXT
  const at = new Date(result.cycleNextRunAt)
  if (result.running || at.getTime() <= now.getTime()) return null
  return `${relativeTime(at, now)}, ${formatDateTime(at)}`
}

export function priorityMessage(result: PriorityResult, now: Date): string {
  if (result.prioritized === 0) return PRIORITY_NONE_TEXT
  const [noun, pronoun] = result.prioritized === 1 ? ['cupom priorizado', 'ele'] : ['cupons priorizados', 'eles']
  const when = whenText(result, now)
  const cycle = when === null ? PRIORITY_CURRENT_TEXT : 'o próximo ciclo'
  const suffix = when === null ? '' : ` (${when})`
  return `${result.prioritized} ${noun}; ${cycle} começa por ${pronoun}${suffix}`
}
