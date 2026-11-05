import type { AutoRunStatus } from '@/ingestion/auto-run'
import type { BadgeTone } from './badge-tone'
import { PLAN_FAILED_TEXT } from './domain'
import { formatDateTime, relativeTime } from './format'

export const AUTO_RUN_OFF_TEXT = 'Execução automática desligada'
export const AUTO_RUN_RUNNING_TEXT = 'Executando agora'
export const AUTO_RUN_UNSCHEDULED_TEXT = 'Nenhuma execução agendada'

export interface AutoRunView {
  tone: BadgeTone
  label: string
  detail: string
}

export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function autoRunView(status: AutoRunStatus, now: Date): AutoRunView {
  if (!status.enabled) return { tone: 'badge-muted', label: 'Desligada', detail: AUTO_RUN_OFF_TEXT }
  if (status.running) return { tone: 'badge-new', label: 'Executando', detail: AUTO_RUN_RUNNING_TEXT }
  if (status.pause !== null) return { tone: 'badge-warn', label: status.pause === PLAN_FAILED_TEXT ? 'Com falha' : 'Pausada', detail: capitalized(status.pause) }
  if (status.nextRunAt === null) return { tone: 'badge-muted', label: 'Ligada', detail: AUTO_RUN_UNSCHEDULED_TEXT }
  return {
    tone: 'badge-saved',
    label: 'Ligada',
    detail: `Próxima execução: ${formatDateTime(status.nextRunAt)} (${relativeTime(status.nextRunAt, now)})`,
  }
}
