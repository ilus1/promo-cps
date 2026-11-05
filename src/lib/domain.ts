import { CYCLE_COUNT } from './cycle-counts'

export const ITEM_STATUSES = ['NOT_SEEN', 'SAVED', 'SEEN'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]
export const STATUS_NOT_SEEN = ITEM_STATUSES[0]
export const STATUS_SAVED = ITEM_STATUSES[1]
export const STATUS_SEEN = ITEM_STATUSES[2]
export const ALERT_STATUSES = [STATUS_NOT_SEEN, STATUS_SAVED] as const

export const BASES = ['none', 'pix', 'coupon', 'pix_coupon', 'other'] as const
export type Basis = (typeof BASES)[number]

export const COUPON_KINDS = ['percent', 'fixed', 'unparsed'] as const
export type CouponKind = (typeof COUPON_KINDS)[number]

export type FilterableKind = Exclude<CouponKind, 'unparsed'>

export const COUPON_SCOPES = ['ml', 'store'] as const
export type CouponScope = (typeof COUPON_SCOPES)[number]

export const COUPON_LIST_STATUSES = ['active', 'inactive', 'ended'] as const
export type CouponListStatus = (typeof COUPON_LIST_STATUSES)[number]

export const COUPON_SORTS = ['desconto', 'economia', 'minimo', 'limite', 'ofertas', 'vence'] as const
export type CouponSort = (typeof COUPON_SORTS)[number]
export const DEFAULT_COUPON_SORT: CouponSort = COUPON_SORTS[0]

export const SOURCE_TYPES = ['coupon', 'search'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]
export const SOURCE_COUPON = SOURCE_TYPES[0]
export const SOURCE_SEARCH = SOURCE_TYPES[1]

export const BUSCA_KINDS = ['search', 'product'] as const
export type BuscaKind = (typeof BUSCA_KINDS)[number]

export const RUN_KINDS = ['cycle', 'search', 'login'] as const
export type RunKind = (typeof RUN_KINDS)[number]

export const BLOCKED_STATUS = 'blocked'

export const PRICE_CHECK_STATUSES = ['matched', 'no_match', 'failed', 'blocked'] as const
export type PriceCheckStatus = (typeof PRICE_CHECK_STATUSES)[number]
export const MATCH_CONFIDENCES = ['high', 'medium'] as const
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number]

export const LOAD_FAILURE_TEXT = 'Páginas do Mercado Livre não carregaram (rede ou leitor)'
export const RUN_INTERRUPTED_TEXT = 'interrompido'
export const ORPHAN_RUN_TEXT = `${RUN_INTERRUPTED_TEXT}: o servidor reiniciou durante a execução`

export function isHeldRun(run: { status: string | null; counts?: Record<string, number> | null }): boolean {
  return run.status === BLOCKED_STATUS || (run.status === 'failed' && run.counts?.[CYCLE_COUNT.loadBreaker] === 1)
}

export const SESSION_EXPIRED_STATUS = 'session_expired'

export const RUN_STATUSES = ['ok', 'partial', 'failed', SESSION_EXPIRED_STATUS, BLOCKED_STATUS] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_ROW_STATUSES = [...RUN_STATUSES, 'logged_in', 'unconfirmed', 'refused', 'timed_out'] as const
export type RunRowStatus = (typeof RUN_ROW_STATUSES)[number]

export const STOP_STATUSES = [SESSION_EXPIRED_STATUS, BLOCKED_STATUS] as const satisfies readonly RunStatus[]

export function isStopStatus(status: string | null): boolean {
  return STOP_STATUSES.some((s) => s === status)
}

export function isRunStatus(status: string | null): status is RunStatus {
  return RUN_STATUSES.some((s) => s === status)
}

export const SESSION_EXPIRED_DISPLAY = SESSION_EXPIRED_STATUS
export const SESSION_ACTIVE_DISPLAY = 'session_active'

export const LOGIN_OUTCOMES = ['logged_in', 'unconfirmed', 'refused', 'timed_out', 'failed'] as const satisfies readonly RunRowStatus[]
export type LoginOutcome = (typeof LOGIN_OUTCOMES)[number]

export function isLoginOutcome(state: string | null): state is LoginOutcome {
  return LOGIN_OUTCOMES.some((o) => o === state)
}

export const LOGIN_STATES = ['idle', 'queued', 'waiting', 'logged_in', 'unconfirmed', 'refused', 'timed_out', 'failed'] as const
export type LoginState = (typeof LOGIN_STATES)[number]
export type LoginStatus = { state: LoginState; error: string | null }
export type LoginDisplayState = LoginState | typeof SESSION_EXPIRED_DISPLAY | typeof SESSION_ACTIVE_DISPLAY
export type LoginDisplay = { state: LoginDisplayState; error: string | null }

const IN_PROGRESS_STATES = ['queued', 'waiting'] as const satisfies readonly Extract<LoginState, VerifyState>[]

export function isLoginInProgress(state: LoginDisplayState): boolean {
  return IN_PROGRESS_STATES.some((s) => s === state)
}

export const VERIFY_STATES = ['idle', 'queued', 'waiting', 'cleared', 'closed', 'timed_out', 'failed'] as const
export type VerifyState = (typeof VERIFY_STATES)[number]
export type VerifyStatus = { state: VerifyState; error: string | null }
export const CYCLE_PHASES = ['idle', 'queued', 'running'] as const
export type CyclePhase = (typeof CYCLE_PHASES)[number]
export type CycleActivity = { phase: CyclePhase }
export type LastRunStatus = {
  status: RunRowStatus | null
  startedAt: string
  finishedAt: string | null
  error: string | null
}
export type MlStatus = LoginStatus & {
  verify: VerifyStatus
  cycle: CycleActivity
  buscas: Record<string, CycleActivity>
  lastRun: LastRunStatus | null
}

export function isVerifyInProgress(state: VerifyState): boolean {
  return IN_PROGRESS_STATES.some((s) => s === state)
}

export type ActivationOutcome = { ok: true } | { ok: false; error: string }

export const SESSION_EXPIRED_TEXT = 'sessão do Mercado Livre expirada'
export const LOGIN_REFUSED_TEXT = 'login recusado pelo Mercado Livre'
export const FIRST_CYCLE_TEXT = 'Rode o primeiro ciclo com Rodar agora para ligar a execução automática'
export const PLAN_FAILED_TEXT = 'Falha ao planejar; tentando de novo'
