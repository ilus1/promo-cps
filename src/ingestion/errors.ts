import { CYCLE_COUNT } from '@/lib/cycle-counts'
import type { RunStatus } from '@/lib/domain'
import type { PageOutcome } from '@/lib/ml-session'
import type { RequestHold } from '@/lib/request-hold'

const RUN_STOP = 'RunStop'

export class RunStop extends Error {
  readonly counts: Record<string, number>

  constructor(
    readonly status: Exclude<RunStatus, 'ok'>,
    message: string,
    options?: ErrorOptions & { counts?: Record<string, number> },
  ) {
    super(message, options)
    this.counts = options?.counts ?? {}
    this.name = RUN_STOP
  }
}

export function isRunStop(e: unknown): e is RunStop {
  return e instanceof Error && e.name === RUN_STOP
}

export function holdStop(hold: RequestHold): RunStop {
  return new RunStop('partial', hold.reason, { counts: { [CYCLE_COUNT.held]: 1 } })
}

export function isHeldCounts(counts: Record<string, number> | undefined): boolean {
  return counts?.[CYCLE_COUNT.held] === 1
}

export function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0]
}

type ErrorCause = { message: string; code?: unknown }

function causeOf(e: unknown): ErrorCause | null {
  if (!(e instanceof Error) || isRunStop(e)) return null
  const cause: unknown = e.cause
  if (cause instanceof Error) return cause
  if (typeof cause !== 'object' || cause === null) return null
  const { message, code } = cause as { message?: unknown; code?: unknown }
  return typeof message === 'string' ? { message, code } : null
}

export function errorText(e: unknown): string {
  const cause = causeOf(e)
  const causeLine = cause?.message.split('\n')[0] ?? ''
  if (!cause || causeLine.trim() === '') return firstLine(e)
  const code = typeof cause.code === 'string' ? ` (${cause.code})` : ''
  return `${causeLine}${code}`
}

export function stopFor(outcome: Exclude<PageOutcome, 'ok'>, url: string): RunStop {
  switch (outcome) {
    case 'session_expired':
      return new RunStop('session_expired', `Sessão do Mercado Livre expirada (${url})`)
    case 'blocked':
      return new RunStop('blocked', `Mercado Livre bloqueou o acesso (${url})`)
    default: {
      const unhandled: never = outcome
      throw new Error(`Desfecho de página desconhecido: ${String(unhandled)}`)
    }
  }
}

const URL_WITH_QUERY = /(https?:\/\/[^\s?#)'"]*)[?#][^\s)'"]*/g

export function redactQueries(text: string): string {
  return text.replace(URL_WITH_QUERY, '$1')
}
