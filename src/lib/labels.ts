import { TRIVIAL_SAVING_CENTS } from './constants'
import { CYCLE_COUNT, type CycleCountKey } from './cycle-counts'
import type {
  BuscaKind, CouponListStatus, CouponScope, CouponSort, FilterableKind, ItemStatus, LoginDisplayState, LoginState, RunKind, RunRowStatus, RunStatus, VerifyState,
} from './domain'
import type { DealSort } from './deal-query'
import type { Retailer } from './market/types'
import { formatCents, formatCount } from './format'

export const APP_NAME = 'Promo CPS'
export const DELETE_LABEL = 'Excluir'
export const ML_ACCOUNT_LABEL = 'Mercado Livre'
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
export const SAVING_MIN_LABEL = 'Economia mínima'
export const SAVING_PERCENT_FILTER_LABEL = `${SAVING_MIN_LABEL} (%)`
export const SAVING_REAIS_FILTER_LABEL = `${SAVING_MIN_LABEL} (R$)`
export const SAVING_TOTAL_LABEL = 'Economia total'
export const PRICE_DROPPED_SINCE_SEEN_LABEL = 'Preço caiu desde que você viu'
export const COUPON_PRICE_LABEL = 'Preço com cupom'
export const COUPON_PART_LABEL = 'Cupom'
export const SELLER_DISCOUNT_LABEL = 'desconto do vendedor'
export const ESTIMATED_TEXT = 'estimado'
const HINT_IN_LISTING_SUFFIX = ' no anúncio'
export const HINT_LINE_LABEL = `${COUPON_PART_LABEL}${HINT_IN_LISTING_SUFFIX}`
export const HINT_PRICE_LINE_LABEL = `${COUPON_PRICE_LABEL}${HINT_IN_LISTING_SUFFIX}`
export const BELOW_MINIMUM_TEXT = 'abaixo do pedido mínimo'
export const HINT_UNKNOWN_TERMS_TEXT = 'condições não informadas'
export const DEAL_SORT_LABEL: Record<DealSort, string> = {
  desconto: 'Maior desconto do ML',
  queda: 'Maior queda real',
  preco: 'Menor preço',
  recentes: 'Mais recentes',
  economia: `Maior ${SAVING_TOTAL_LABEL.toLowerCase()} (%)`,
  economiaReais: `Maior ${SAVING_TOTAL_LABEL.toLowerCase()} (R$)`,
  economiaCupom: 'Maior economia do cupom (R$)',
  economiaReal: 'Maior economia real (R$)',
}

export const COUPON_SORT_LABEL: Record<CouponSort, string> = {
  desconto: `Maior ${DISCOUNT_AT_MINIMUM_LABEL.toLowerCase()}`,
  economia: 'Maior economia máxima',
  minimo: 'Menor compra mínima',
  limite: 'Maior limite',
  ofertas: 'Mais ofertas ligadas',
  vence: 'Vence primeiro',
}

export const TRIVIAL_SAVING_NOTE = `Cupons que economizam menos de ${formatCents(TRIVIAL_SAVING_CENTS)} aparecem no fim.`
export const UNCAPPED_TEXT = 'sem limite'
export const OFFERS_OF_SET_LABEL = 'Ver ofertas destes cupons'

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

export const ITEM_TAB_LABEL: Record<ItemStatus, string> = {
  NOT_SEEN: 'Novos',
  SAVED: 'Salvos',
  SEEN: 'Vistos',
}

export const CYCLE_BANNER_TEXT = {
  session_expired: 'A sessão do Mercado Livre expirou no último ciclo. Entre de novo em Conta para continuar.',
  blocked: 'O Mercado Livre bloqueou o acesso no último ciclo. Veja os detalhes em Conta.',
  failed: 'O último ciclo falhou. Veja os detalhes em Conta.',
} as const satisfies Partial<Record<RunStatus, string>>

export const BUSCA_KIND_LABEL: Record<BuscaKind, string> = {
  search: 'Busca',
  product: 'Produto',
}

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

export const BUSCA_COUNT_LABELS: ReadonlyArray<readonly [CycleCountKey, string]> = [
  [CYCLE_COUNT.buscaReads, 'buscas lidas'],
  [CYCLE_COUNT.buscaPages, 'páginas de buscas'],
  [CYCLE_COUNT.buscaItems, 'ofertas das buscas'],
  [CYCLE_COUNT.buscaFailed, 'buscas com falha'],
  [CYCLE_COUNT.buscaDropped, 'cards descartados nas buscas'],
  [CYCLE_COUNT.buscaEmpty, 'buscas sem resultados'],
]

export const OPENS_IN_NEW_TAB_TEXT = '(abre em nova aba)'
export const BUSCA_NO_RESULTS_TEXT = 'nenhum resultado no ML'
export const BUSCA_LAST_READ_TEXT = 'Última leitura'
export const BUSCA_NO_READ_TEXT = 'ainda sem leitura'
export const BUSCA_STOPPED_TEXT = 'Última tentativa interrompida'
export const BUSCA_NAME_REQUIRED_TEXT = 'Informe um nome para a Busca.'
export const BUSCA_URL_REQUIRED_TEXT = 'Informe a URL.'
export const BUSCA_DUPLICATE_TEXT = 'Esta URL ou termo já está cadastrado em outra Busca.'
export const BUSCA_CREATE_FAILED_TEXT = 'Não foi possível criar a Busca.'
export const BUSCA_UPDATE_FAILED_TEXT = 'Não foi possível salvar a alteração.'
export const BUSCA_DELETE_FAILED_TEXT = 'Não foi possível excluir a Busca.'
export const BUSCA_GONE_TEXT = 'Esta Busca não existe mais. A lista foi atualizada.'
export const BUSCA_NEVER_RUN_TEXT = 'Ainda não executada.'
export const BUSCA_URL_HELP_TEXT = 'Cole a URL de uma busca do Mercado Livre com seus filtros, ou de um produto. Também dá para digitar só o termo, como "fone bluetooth"; o nome fica igual ao termo se você não preencher.'
export const buscaFollowText = (q: string) => `Seguir '${q}' no ML`
export const BUSCA_TERM_PARAM = 'termo'

export function buscaNameRangeText(max: number): string {
  return `O nome deve ter de 1 a ${max} caracteres.`
}

export const ALERT_ACTIVE_TEXT = 'Alerta ativo'
export const ALERT_ADD_TEXT = 'Alertar'
export const ALERT_NAME_LABEL = 'Nome do alerta'
export const ALERT_NAME_REQUIRED_TEXT = 'Informe um nome para o alerta.'
export const ALERT_DUPLICATE_TEXT = 'Já existe um alerta com estes filtros.'
export const ALERT_CREATE_FAILED_TEXT = 'Não foi possível salvar o alerta.'
export const ALERT_DELETE_FAILED_TEXT = 'Não foi possível excluir o alerta.'
export const ALERT_HELP_TEXT = 'Receba uma notificação no desktop quando surgirem ofertas novas ou mais baratas com estes filtros.'
export const ALERTS_EMPTY_TEXT = 'Nenhum alerta salvo. Em Ofertas, escolha os filtros e use Alertar para ser avisado de ofertas novas.'
export const ALERTS_EMPTY_ACTION_TEXT = 'Ir para Ofertas'
export const ALERT_BUSCA_GONE_TEXT = 'Esta Busca não existe mais.'
export const ALERT_BUSCA_REMOVED_TEXT = 'A Busca deste alerta foi removida: o alerta não dispara mais.'
export const ALERT_NO_FILTERS_TEXT = 'Todas as ofertas'
export const ALERT_SORT_NOTE = 'A ordenação não é salva no alerta.'

export const SELLER_LABEL = 'Vendido por'
export const NO_LINKED_OFFERS_TEXT = 'nenhuma oferta lida ainda'
export const COUPON_PREVIEWS_LABEL = 'Produtos do cupom'

export const INFLATED_BADGE_LABEL = 'Desconto inflado'
export const OUTSIDE_ML_LABEL = 'Fora do ML'
export const REAL_SAVING_LABEL = 'Economia real'
export const NO_REAL_SAVING_LABEL = 'Sem economia real'
export const POSSIBLE_EQUIVALENT_LABEL = 'Possível equivalente fora do ML'
export const CHEAPER_SIBLING_LABEL = 'Mais barato em outro anúncio'
export const NEVER_PRACTICED_LABEL = "preço 'de' nunca praticado"
export const COMPARE_LINKS_LABEL = 'Comparar'
export const COMPARE_NOW_LABEL = 'Comparar agora'
export const COMPARE_BUSY_LABEL = 'Comparando...'
export const COMPARE_FAILED_TEXT = 'Não foi possível comparar agora.'
export const COMPARE_GONE_TEXT = 'Esta oferta não existe mais.'
export const SHOW_INFLATED_LABEL = 'Mostrar ocultos'
export const PRICE_COMPARE_PANEL_LABEL = 'Comparação de preços'
export const BUSCAPE_LABEL = 'Buscapé'
export const GOOGLE_SHOPPING_LABEL = 'Google Shopping'
export const AMAZON_LABEL = 'Amazon'
export const MAGALU_LABEL = 'Magalu'
export const KABUM_LABEL = 'Kabum'
export const SITE_LABEL: Record<Retailer, string> = { kabum: KABUM_LABEL, amazon: AMAZON_LABEL }
export const NO_EQUIVALENT_TEXT = `sem equivalente na ${KABUM_LABEL} ou ${AMAZON_LABEL}`
export const AMAZON_QUEUED_TEXT = `busca na ${AMAZON_LABEL} na fila`
export const AMAZON_SEARCHED_LABEL = `${AMAZON_LABEL} buscada`
export const ONLY_VERIFIED_LABEL = 'Só verificados'
