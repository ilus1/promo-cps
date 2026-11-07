import { TRIVIAL_SAVING_CENTS, WATCH_LOW_WINDOW_DAYS } from './constants'
import { CYCLE_COUNT, type CycleCountKey } from './cycle-counts'
import type {
  CouponListStatus, CouponScope, CouponSort, FilterableKind, LoginDisplayState, LoginState, RunKind, RunRowStatus, RunStatus, VerifyState,
} from './domain'
import type { EanSource, MatchKind, WatchAlertKind, WatchRetailer } from './watch/types'
import { capitalized, formatCents, formatCount } from './format'

export const APP_NAME = 'Promo CPS'
export const ML_ACCOUNT_LABEL = 'Mercado Livre'
export const NO_VALUE = '-'
export const NO_EXPIRY_TEXT = 'sem validade'
export const YES_TEXT = 'sim'
export const NO_TEXT = 'não'

export const COUPON_STATUS_LABEL: Record<CouponListStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  ended: 'Encerrado',
}

export const COUPON_SCOPE_LABEL: Record<CouponScope, string> = {
  ml: ML_ACCOUNT_LABEL,
  store: 'Loja',
}

export const COUPON_KIND_LABEL: Record<FilterableKind, string> = {
  percent: 'Percentual',
  fixed: 'Valor fixo',
}

export const DISCOUNT_AT_MINIMUM_LABEL = 'Desconto na compra mínima'
export const MINIMUM_MAX_LABEL = 'Compra mínima até'
export const LIMIT_MIN_LABEL = 'Limite a partir de'
export const DISCOUNT_MIN_LABEL = 'Desconto mínimo'

export const COUPON_SORT_LABEL: Record<CouponSort, string> = {
  desconto: `Maior ${DISCOUNT_AT_MINIMUM_LABEL.toLowerCase()}`,
  economia: 'Maior economia máxima',
  minimo: 'Menor compra mínima',
  limite: 'Maior limite',
  vence: 'Vence primeiro',
}

export const TRIVIAL_SAVING_NOTE = `Cupons que economizam menos de ${formatCents(TRIVIAL_SAVING_CENTS)} aparecem no fim.`
export const UNCAPPED_TEXT = 'sem limite'

export const LOGIN_STATE_LABEL: Record<LoginState, string> = {
  idle: 'Não iniciado',
  queued: 'Abrindo',
  waiting: 'Aguardando',
  logged_in: 'Conectado',
  unconfirmed: 'Não confirmado',
  refused: 'Recusado pelo Mercado Livre',
  timed_out: 'Não concluído',
  failed: 'Falhou',
}

export const APP_UNREACHABLE_TEXT = 'Sem resposta do app'

export const VERIFY_STATE_LABEL: Record<VerifyState, string> = {
  idle: 'Não iniciada',
  queued: 'Abrindo',
  waiting: 'Aguardando',
  cleared: 'Resolvida',
  closed: 'Janela fechada',
  timed_out: 'Tempo esgotado',
  failed: 'Falhou',
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  ok: 'ok',
  partial: 'parcial',
  failed: 'falhou',
  session_expired: 'sessão expirada',
  blocked: 'bloqueado',
}

export const RUN_ROW_STATUS_LABEL: Record<RunRowStatus, string> = {
  ...RUN_STATUS_LABEL,
  logged_in: 'conectado',
  unconfirmed: 'não confirmado',
  refused: 'recusado',
  timed_out: 'não concluído',
}

export const RUN_KIND_LABEL: Record<RunKind, string> = {
  cycle: 'Ciclo',
  search: 'Busca',
  login: 'Login',
}

export const LOGIN_DISPLAY_LABEL: Record<LoginDisplayState, string> = {
  ...LOGIN_STATE_LABEL,
  session_expired: 'Sessão expirada',
  session_active: 'Sessão ativa',
}

export const RUN_RUNNING_TEXT = 'em andamento'

export const SKIPPED_ENTRIES_LABEL = 'entradas ignoradas'
export const SKIPPED_ENTRY_LABEL = 'entrada ignorada'

export function skippedEntriesText(count: number): string {
  return `${formatCount(count)} ${count === 1 ? SKIPPED_ENTRY_LABEL : SKIPPED_ENTRIES_LABEL}`
}

export const CYCLE_COUNT_LABELS: ReadonlyArray<readonly [CycleCountKey, string]> = [
  [CYCLE_COUNT.totalCoupons, 'cupons no ML'],
  [CYCLE_COUNT.seen, 'cupons lidos'],
  [CYCLE_COUNT.fullHarvest, 'leitura completa'],
  [CYCLE_COUNT.failedPages, 'páginas com falha'],
  [CYCLE_COUNT.inserted, 'novos'],
  [CYCLE_COUNT.unparsed, 'não reconhecidos'],
  [CYCLE_COUNT.skipped, SKIPPED_ENTRIES_LABEL],
  [CYCLE_COUNT.activated, 'ativados'],
  [CYCLE_COUNT.activationFailed, 'ativações falhas'],
  [CYCLE_COUNT.activationSkipped, 'ativações adiadas'],
  [CYCLE_COUNT.ended, 'encerrados'],
  [CYCLE_COUNT.endingRefused, 'encerramentos recusados'],
  [CYCLE_COUNT.discoveryPages, 'páginas de descoberta'],
  [CYCLE_COUNT.discoveryFailed, 'descobertas com falha'],
  [CYCLE_COUNT.discoveryEmpty, 'listagens vazias'],
  [CYCLE_COUNT.discoveredItems, 'itens'],
]

export const WATCH_COUNT_LABELS: ReadonlyArray<readonly [CycleCountKey, string]> = [
  [CYCLE_COUNT.watchProducts, 'produtos monitorados'],
  [CYCLE_COUNT.watchMatched, 'anúncios do ML encontrados'],
  [CYCLE_COUNT.watchFailed, 'falhas no monitoramento'],
  [CYCLE_COUNT.watchPages, 'páginas do monitoramento'],
  [CYCLE_COUNT.watchEmpty, 'buscas do monitoramento sem resultados'],
  [CYCLE_COUNT.watchCards, 'cards lidos no monitoramento'],
  [CYCLE_COUNT.watchDropped, 'cards descartados no monitoramento'],
  [CYCLE_COUNT.watchSkipped, 'produtos sem busca no ML'],
]

export const BUSCA_COUNT_LABELS: ReadonlyArray<readonly [CycleCountKey, string]> = [
  [CYCLE_COUNT.buscaReads, 'buscas lidas'],
  [CYCLE_COUNT.buscaPages, 'páginas de buscas'],
  [CYCLE_COUNT.buscaItems, 'ofertas das buscas'],
  [CYCLE_COUNT.buscaFailed, 'buscas com falha'],
  [CYCLE_COUNT.buscaDropped, 'cards descartados nas buscas'],
  [CYCLE_COUNT.buscaEmpty, 'buscas sem resultados'],
]

export const OPENS_IN_NEW_TAB_TEXT = '(abre em nova aba)'

export const BUSCAPE_LABEL = 'Buscapé'
export const AMAZON_LABEL = 'Amazon'
export const KABUM_LABEL = 'Kabum'
export const AMERICANAS_LABEL = 'Americanas'
export const WATCH_STORE_LABEL: Record<WatchRetailer, string> = {
  ml: ML_ACCOUNT_LABEL, amazon: AMAZON_LABEL, kabum: KABUM_LABEL, americanas: AMERICANAS_LABEL, buscape: BUSCAPE_LABEL,
}
export const MATCH_KIND_LABEL: Record<MatchKind, string> = { barcode: 'código de barras', auto: 'automático', link: 'link' }
export const EAN_SOURCE_LABEL: Record<EanSource, string> = { manual: 'digitado', link: 'do link', americanas: 'da Americanas' }
export const WATCH_STORE_OF_LABEL: Record<WatchRetailer, string> = {
  ml: `do ${ML_ACCOUNT_LABEL}`, amazon: `da ${AMAZON_LABEL}`, kabum: `da ${KABUM_LABEL}`, americanas: `da ${AMERICANAS_LABEL}`, buscape: `do ${BUSCAPE_LABEL}`,
}
export const WATCH_STORE_IN_LABEL: Record<WatchRetailer, string> = {
  ml: `no ${ML_ACCOUNT_LABEL}`, amazon: `na ${AMAZON_LABEL}`, kabum: `na ${KABUM_LABEL}`, americanas: `na ${AMERICANAS_LABEL}`, buscape: `no ${BUSCAPE_LABEL}`,
}
export const LOW_WINDOW_TEXT = `menor preço em ${WATCH_LOW_WINDOW_DAYS} dias`
export const WATCH_ALERT_KIND_LABEL: Record<WatchAlertKind, string> = { target: 'preço alvo', low_30d: LOW_WINDOW_TEXT, drop: 'queda de preço' }
export const PRODUCTS_LABEL = 'Produtos'
export const AUTO_CHECKS_OFF_TEXT = 'verificações automáticas desligadas (AUTO_RUN=off)'
export const AUTO_CHECKS_OFF_LABEL = capitalized(AUTO_CHECKS_OFF_TEXT)
export const BACK_TO_PRODUCTS_LABEL = `Voltar para ${PRODUCTS_LABEL}`
export const MONITOR_PANEL_LABEL = 'Monitoramento'
