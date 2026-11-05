import type { BadgeTone } from './badge-tone'
import type { CyclePhase } from './domain'

export const ACTIVITY_VIEW: Record<CyclePhase, { badge: BadgeTone; label: string; detail: string }> = {
  idle: { badge: 'badge-muted', label: 'Parado', detail: 'Nenhuma execução em andamento.' },
  queued: {
    badge: 'badge-saved',
    label: 'Na fila',
    detail: 'Aguardando a execução, a janela de login ou a de verificação em andamento terminar para começar.',
  },
  running: {
    badge: 'badge-saved',
    label: 'Em andamento',
    detail: 'Lendo o Mercado Livre em uma janela oculta. Pode levar vários minutos.',
  },
}
