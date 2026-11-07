import { CENTS_PER_REAL, WATCH_LOW_WINDOW_DAYS } from '../constants'
import { capitalized, formatAgo, formatCents, formatCount, formatDayMonthTime, relativeTime } from '../format'
import { HOLD_PREFIX } from '../hold-view'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT } from '../http-status'
import {
  AUTO_CHECKS_OFF_TEXT, EAN_SOURCE_LABEL, LOW_WINDOW_TEXT, MATCH_KIND_LABEL, NO_VALUE, WATCH_ALERT_KIND_LABEL, WATCH_STORE_IN_LABEL, WATCH_STORE_LABEL, WATCH_STORE_OF_LABEL,
} from '../labels'
import { validEan } from './ean'
import {
  NAME_TOO_LONG_TEXT, nameOrLinkIssue, UNKNOWN_LINK_TEXT, URL_LIKE, WATCH_DROP_MAX, WATCH_DROP_MIN,
} from './input-rules'
import { parseProductLink } from './links'
import {
  ML_RETAILER, type WatchLastAlert, type WatchListingView, type WatchProductView, type WatchRetailer, type WatchSourceState,
  type WatchSourceStatus, type WatchStatus, type WatchWaitingReason,
} from './types'

export const NOT_CHECKED_TEXT = 'Ainda não verificado'
export const NO_LISTINGS_TEXT = 'Nenhum anúncio encontrado ainda'
export const NO_STORE_FOUND_TEXT = 'Nenhuma loja encontrou este produto na última busca.'
export const NO_MATCH_TEXT = `${NO_STORE_FOUND_TEXT} Adicione-o de novo com um nome mais completo (modelo e cor) ou com o código de barras, ou use "Buscar agora" mais tarde.`
export const NO_TRACKED_LISTINGS_TEXT = 'Nenhum anúncio acompanhado.'
export const NO_PRODUCTS_TEXT = 'Nenhum produto monitorado'
export const PENDING_NAME_TEXT = 'Buscando o nome do produto...'
export const NAME_UNREAD_TEXT = 'Não foi possível ler o nome do produto pelo link. Adicione-o de novo pelo nome.'
export const UNKNOWN_STORE_TITLE = 'Produto'
export const NO_PRICE_TEXT = 'Sem preço disponível agora'
export const AT_LOW_TEXT = `No menor preço dos últimos ${WATCH_LOW_WINDOW_DAYS} dias`
export const OUT_OF_STOCK_LABEL = 'Sem estoque'
export const BEST_PRICE_LABEL = 'Menor preço'
export const WITH_COUPON_TEXT = 'com cupom'
export const NAME_OR_LINK_REQUIRED_TEXT = 'Digite o nome ou cole o link do produto.'
export const CHECK_NAME_OR_LINK_TEXT = 'Confira o nome ou o link do produto.'
export const INVALID_EAN_TEXT = 'Código de barras inválido: confira os dígitos.'
export const INVALID_PRICE_TEXT = 'Digite um preço em reais, como 1299,90.'
export const WATCH_CREATE_FAILED_TEXT = 'Não foi possível adicionar o produto.'
export const WATCH_SAVE_FAILED_TEXT = 'Não foi possível salvar os alertas.'
export const WATCH_REFRESH_FAILED_TEXT = 'Não foi possível iniciar a busca.'
export const WATCH_STOP_FAILED_TEXT = 'Não foi possível parar de monitorar.'
export const WATCH_GONE_TEXT = 'Este produto não existe mais.'
export const LISTING_REMOVE_FAILED_TEXT = 'Não foi possível remover o anúncio.'
export const LISTING_GONE_TEXT = 'Este anúncio já tinha sido removido. A lista foi atualizada.'
export const WATCH_STOPPED_TEXT = 'Produto retirado da lista. Você não recebe mais alertas dele.'
export const WATCH_ADDED_TEXT = 'Produto adicionado. A busca nas lojas começa em instantes.'
export const WATCH_ADDED_IDLE_TEXT = `Produto salvo, mas sem busca por enquanto: ${AUTO_CHECKS_OFF_TEXT}.`
export const WATCH_SAVED_TEXT = 'Alertas salvos.'
export const WATCH_REFRESH_QUEUED_TEXT = 'Busca agendada. Recarregue a página daqui a alguns minutos para ver os preços novos.'
export const LISTING_REMOVED_TEXT = 'Anúncio removido. Ele não será buscado de novo.'
export const PRODUCTS_EMPTY_TEXT = 'Nenhum produto monitorado ainda. Adicione acima o nome de um produto ou o link dele no Mercado Livre, na Amazon, na Kabum, na Americanas ou no Buscapé.'
export const NAME_OR_LINK_HELP_TEXT = 'Por exemplo "Fone JBL Tune 520BT Preto", ou o link do produto no Mercado Livre, na Amazon, na Kabum, na Americanas ou no Buscapé. Inclua a cor se ela importar: sem ela, cada loja pode mostrar uma cor diferente.'
export const EAN_HELP_TEXT = 'Opcional. O número sob o código de barras da caixa: com ele, o app acha o mesmo produto nas lojas com mais certeza.'
export const TARGET_HELP_TEXT = 'Opcional. Você recebe um alerta quando o menor preço chegar a este valor.'
export const LISTINGS_HELP_TEXT = 'Um anúncio por loja. Se algum não for o mesmo produto, remova-o: ele não será buscado de novo.'
export const STALE_PRICE_TEXT = 'O preço mostrado é de uma verificação anterior.'
export const PRODUCTS_LIST_TITLE = 'Produtos monitorados'
export const INVALID_DROP_TEXT = `Digite uma queda entre ${WATCH_DROP_MIN}% e ${WATCH_DROP_MAX}%.`
export const DROP_HELP_TEXT = `De ${WATCH_DROP_MIN}% a ${WATCH_DROP_MAX}%. Você recebe um alerta quando o menor preço cair pelo menos isso em relação ao anterior.`

const ALLOWED_PROTOCOL = 'https:'
const ENDS_IN_PUNCTUATION = /[.!?]$/
const BUSCAPE: WatchRetailer = 'buscape'
const THOUSANDS_DOT = /\./g
const DECIMAL_COMMA = ','
const CURRENCY_PREFIX = /^R\$\s*/i
const COMMA_REAIS = /^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$/
const DOT_REAIS = /^\d+(?:\.\d{1,2})?$/
const WHOLE_NUMBER = /^\d+$/
const DRAFT_DECIMALS = 2

function buscapeMerchant(retailer: WatchRetailer, merchant: string | null): string | null {
  const name = merchant?.trim() ?? ''
  return retailer === BUSCAPE && name !== '' ? name : null
}

export function storeText(retailer: WatchRetailer, merchant: string | null): string {
  const name = buscapeMerchant(retailer, merchant)
  return name ? `${name} (via ${WATCH_STORE_LABEL[retailer]})` : WATCH_STORE_LABEL[retailer]
}

export function storeInText(retailer: WatchRetailer, merchant: string | null): string {
  const name = buscapeMerchant(retailer, merchant)
  return name ? `na ${name} (via ${WATCH_STORE_LABEL[retailer]})` : WATCH_STORE_IN_LABEL[retailer]
}

export function safeListingUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== ALLOWED_PROTOCOL || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export interface ProductHeading { title: string; pending: string | null; link: string | null }

function isLinkName(name: string): boolean {
  const text = name.trim()
  return parseProductLink(text) !== null || URL_LIKE.test(text)
}

export function productHeading(name: string, resolvedAt: Date | null): ProductHeading {
  const text = name.trim()
  const link = parseProductLink(text)
  const pending = resolvedAt ? NAME_UNREAD_TEXT : PENDING_NAME_TEXT
  if (link) return { title: `${UNKNOWN_STORE_TITLE} ${WATCH_STORE_OF_LABEL[link.retailer]}`, pending, link: safeListingUrl(link.url) }
  if (URL_LIKE.test(text)) return { title: UNKNOWN_STORE_TITLE, pending, link: safeListingUrl(text) }
  return { title: name, pending: null, link: null }
}

type CheckedListing = Pick<WatchListingView, 'checkedAt' | 'lastError'>

export function checkedText(listing: CheckedListing, now: Date): string {
  if (!listing.checkedAt) return NOT_CHECKED_TEXT
  const ago = formatAgo(listing.checkedAt, now)
  return listing.lastError ? `Última tentativa ${ago}` : `Verificado ${ago}`
}

function latestCheck(listings: readonly CheckedListing[], failed: boolean): CheckedListing | null {
  return listings.reduce<CheckedListing | null>((top, listing) => {
    if (!listing.checkedAt || (listing.lastError !== null) !== failed) return top
    return top?.checkedAt && top.checkedAt >= listing.checkedAt ? top : listing
  }, null)
}

export function productCheckedText(listings: readonly CheckedListing[], resolvedAt: Date | null, now: Date): string {
  const latest = latestCheck(listings, false) ?? latestCheck(listings, true)
  if (latest) return checkedText(latest, now)
  return resolvedAt ? `Buscado ${formatAgo(resolvedAt, now)}` : NOT_CHECKED_TEXT
}

export function emptyListingsText(product: Pick<WatchProductView, 'resolvedAt'>): string {
  return product.resolvedAt ? NO_TRACKED_LISTINGS_TEXT : NO_LISTINGS_TEXT
}

function noPriceText(product: WatchProductView): string {
  if (product.listings.length > 0) return NO_PRICE_TEXT
  if (!product.resolvedAt) return NO_LISTINGS_TEXT
  return isLinkName(product.name) ? NO_PRICE_TEXT : NO_MATCH_TEXT
}

export function productsCountLine(count: number, refreshHours: number): string {
  const products = count === 0 ? NO_PRODUCTS_TEXT : `${formatCount(count)} ${count === 1 ? 'produto monitorado' : 'produtos monitorados'}`
  return `${products}. Os preços são verificados a cada ${formatCount(refreshHours)} h.`
}

export function listingCountText(count: number): string | null {
  if (count === 0) return null
  return `${formatCount(count)} ${count === 1 ? 'anúncio acompanhado' : 'anúncios acompanhados'}`
}

export interface PriceNote { text: string; good: boolean }

export function lowNote(bestCents: number | null, low30dCents: number | null): PriceNote | null {
  if (low30dCents === null) return null
  if (bestCents === null) return { text: `${capitalized(LOW_WINDOW_TEXT)}: ${formatCents(low30dCents)}`, good: false }
  if (bestCents <= low30dCents) return { text: AT_LOW_TEXT, good: true }
  return { text: `${formatCents(bestCents - low30dCents)} acima do ${LOW_WINDOW_TEXT} (${formatCents(low30dCents)})`, good: false }
}

export function targetNote(bestCents: number | null, targetCents: number | null): PriceNote | null {
  if (targetCents === null) return null
  if (bestCents !== null && bestCents <= targetCents) return { text: `Preço alvo de ${formatCents(targetCents)} atingido`, good: true }
  const gap = bestCents === null ? '' : ` (faltam ${formatCents(bestCents - targetCents)})`
  return { text: `Preço alvo: ${formatCents(targetCents)}${gap}`, good: false }
}

export function alertsText(product: Pick<WatchProductView, 'targetPriceCents' | 'dropPercent'>): string {
  const target = product.targetPriceCents === null ? [] : [`preço alvo de ${formatCents(product.targetPriceCents)}`]
  return `Alertas: ${[...target, `novo ${LOW_WINDOW_TEXT}`, `queda de ${formatCount(product.dropPercent)}%`].join(', ')}`
}

export function eanText(product: Pick<WatchProductView, 'ean' | 'eanSource'>): string | null {
  if (!product.ean) return null
  const source = product.eanSource ? ` (${EAN_SOURCE_LABEL[product.eanSource]})` : ''
  return `Código de barras: ${product.ean}${source}`
}

export interface ProductSummary {
  price: string | null
  bestLine: string | null
  noPrice: string | null
  low: PriceNote | null
  target: PriceNote | null
  checked: string
  listings: string | null
}

function hasCoupon(listing: Pick<WatchListingView, 'priceCents' | 'finalCents'>): boolean {
  return listing.priceCents !== null && listing.finalCents !== null && listing.finalCents < listing.priceCents
}

function bestLine(product: WatchProductView): string | null {
  const best = product.best
  if (!best) return null
  const listing = product.listings.find((candidate) => candidate.id === best.listingId)
  const coupon = listing && hasCoupon(listing) ? `, ${WITH_COUPON_TEXT}` : ''
  return `${BEST_PRICE_LABEL}: ${storeText(best.retailer, best.merchant)}${coupon}`
}

export function productSummary(product: WatchProductView, now: Date): ProductSummary {
  const best = product.best
  const bestCents = best?.finalCents ?? null
  return {
    price: best ? formatCents(best.finalCents) : null,
    bestLine: bestLine(product),
    noPrice: best ? null : noPriceText(product),
    low: lowNote(bestCents, product.low30dCents),
    target: targetNote(bestCents, product.targetPriceCents),
    checked: productCheckedText(product.listings, product.resolvedAt, now),
    listings: listingCountText(product.listings.length),
  }
}

export interface ListingRow {
  id: string
  store: string
  removeConfirm: string
  title: string
  url: string | null
  price: string
  listPrice: string
  finalPrice: string
  match: string
  checked: string
  error: string | null
  outOfStock: boolean
  best: boolean
}

function centsOrNone(cents: number | null): string {
  return cents === null ? NO_VALUE : formatCents(cents)
}

function finalPriceText(listing: Pick<WatchListingView, 'priceCents' | 'finalCents'>): string {
  if (listing.finalCents === null) return NO_VALUE
  return hasCoupon(listing) ? `${formatCents(listing.finalCents)} ${WITH_COUPON_TEXT}` : formatCents(listing.finalCents)
}

function failureNote(listing: Pick<WatchListingView, 'lastError' | 'priceCents'>): string | null {
  if (!listing.lastError) return null
  const error = listing.lastError.trim()
  const failure = `Falha na última verificação: ${error}${ENDS_IN_PUNCTUATION.test(error) ? '' : '.'}`
  return listing.priceCents === null ? failure : `${failure} ${STALE_PRICE_TEXT}`
}

export function listingRow(listing: WatchListingView, bestListingId: string | null, now: Date): ListingRow {
  return {
    id: listing.id,
    store: storeText(listing.retailer, listing.merchant),
    removeConfirm: removeListingConfirmText(listing.retailer, listing.merchant),
    title: listing.title,
    url: safeListingUrl(listing.url),
    price: centsOrNone(listing.priceCents),
    listPrice: centsOrNone(listing.listPriceCents),
    finalPrice: finalPriceText(listing),
    match: MATCH_KIND_LABEL[listing.match],
    checked: checkedText(listing, now),
    error: failureNote(listing),
    outOfStock: listing.inStock === false,
    best: listing.id === bestListingId,
  }
}

function rowOrder(bestListingId: string | null) {
  return (a: WatchListingView, b: WatchListingView): number => {
    if (a.id === bestListingId) return -1
    if (b.id === bestListingId) return 1
    if (a.finalCents === null) return b.finalCents === null ? 0 : 1
    if (b.finalCents === null) return -1
    return a.finalCents - b.finalCents
  }
}

export function listingRows(product: WatchProductView, now: Date): ListingRow[] {
  const bestId = product.best?.listingId ?? null
  return [...product.listings].sort(rowOrder(bestId)).map((listing) => listingRow(listing, bestId, now))
}

function reaisText(raw: string): string | null {
  const text = raw.trim().replace(CURRENCY_PREFIX, '')
  if (!text.includes(DECIMAL_COMMA)) return DOT_REAIS.test(text) ? text : null
  return COMMA_REAIS.test(text) ? text.replace(THOUSANDS_DOT, '').replace(DECIMAL_COMMA, '.') : null
}

export function priceCents(raw: string): number | null {
  const plain = reaisText(raw)
  if (plain === null) return null
  const cents = Math.round(Number(plain) * CENTS_PER_REAL)
  return cents > 0 ? cents : null
}

export function centsDraft(cents: number | null): string {
  return cents === null ? '' : (cents / CENTS_PER_REAL).toFixed(DRAFT_DECIMALS).replace('.', DECIMAL_COMMA)
}

export function dropPercentOf(raw: string): number | null {
  const text = raw.trim()
  if (!WHOLE_NUMBER.test(text)) return null
  const percent = Number(text)
  return percent >= WATCH_DROP_MIN && percent <= WATCH_DROP_MAX ? percent : null
}

export type WatchDraft = { nameOrLink: string; ean: string; targetPrice: string }
export type WatchField = keyof WatchDraft
export type WatchFormErrors = Partial<Record<WatchField | 'form', string>>
export interface WatchRequest { nameOrLink: string; ean?: string; targetPriceCents?: number }

export const WATCH_FIELD_ORDER: readonly WatchField[] = ['nameOrLink', 'ean', 'targetPrice']

function nameOrLinkError(raw: string): string | null {
  const text = raw.trim()
  return text === '' ? NAME_OR_LINK_REQUIRED_TEXT : nameOrLinkIssue(text)
}

export function validateWatchDraft(draft: WatchDraft): WatchFormErrors {
  const errors: WatchFormErrors = {}
  const nameOrLink = nameOrLinkError(draft.nameOrLink)
  if (nameOrLink) errors.nameOrLink = nameOrLink
  if (draft.ean.trim() !== '' && validEan(draft.ean) === null) errors.ean = INVALID_EAN_TEXT
  if (draft.targetPrice.trim() !== '' && priceCents(draft.targetPrice) === null) errors.targetPrice = INVALID_PRICE_TEXT
  return errors
}

export function firstInvalidWatchField(errors: WatchFormErrors): WatchField | null {
  return WATCH_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null
}

export function watchRequestOf(draft: WatchDraft): WatchRequest {
  const ean = validEan(draft.ean)
  const target = priceCents(draft.targetPrice)
  return {
    nameOrLink: draft.nameOrLink.trim(),
    ...(ean === null ? {} : { ean }),
    ...(target === null ? {} : { targetPriceCents: target }),
  }
}

const REQUEST_FIELD: Record<string, WatchField> = { nameOrLink: 'nameOrLink', ean: 'ean', targetPriceCents: 'targetPrice' }
const FIELD_TEXT: Record<WatchField, string> = {
  nameOrLink: CHECK_NAME_OR_LINK_TEXT, ean: INVALID_EAN_TEXT, targetPrice: INVALID_PRICE_TEXT,
}
const SERVER_FIELD_TEXTS: ReadonlySet<string> = new Set([UNKNOWN_LINK_TEXT, NAME_TOO_LONG_TEXT])

type FailureBody = { error?: unknown; details?: { fieldErrors?: Record<string, unknown> } } | null

export function conflictText(status: number, body: FailureBody): string | null {
  const error = body?.error
  return status === HTTP_CONFLICT && typeof error === 'string' && error.trim() !== '' ? error : null
}

function serverFieldText(field: WatchField, messages: unknown): string {
  const first = Array.isArray(messages) ? messages[0] : null
  return typeof first === 'string' && SERVER_FIELD_TEXTS.has(first) ? first : FIELD_TEXT[field]
}

export function watchCreateFailure(status: number, body: FailureBody): WatchFormErrors {
  const fields = status === HTTP_BAD_REQUEST ? body?.details?.fieldErrors ?? {} : {}
  const errors: WatchFormErrors = {}
  for (const [key, messages] of Object.entries(fields)) {
    const field = REQUEST_FIELD[key]
    if (field) errors[field] = serverFieldText(field, messages)
  }
  return firstInvalidWatchField(errors) ? errors : { form: WATCH_CREATE_FAILED_TEXT }
}

export type SettingsDraft = { targetPrice: string; dropPercent: string }
export type SettingsField = keyof SettingsDraft
export type SettingsErrors = Partial<Record<SettingsField, string>>
export interface SettingsPatch { targetPriceCents: number | null; dropPercent: number }

export const SETTINGS_FIELD_ORDER: readonly SettingsField[] = ['targetPrice', 'dropPercent']

export function firstInvalidSettingsField(errors: SettingsErrors): SettingsField | null {
  return SETTINGS_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null
}

export function settingsDraftOf(product: Pick<WatchProductView, 'targetPriceCents' | 'dropPercent'>): SettingsDraft {
  return { targetPrice: centsDraft(product.targetPriceCents), dropPercent: String(product.dropPercent) }
}

export type SettingsResult = { patch: SettingsPatch; errors: null } | { patch: null; errors: SettingsErrors }

export function settingsResult(draft: SettingsDraft): SettingsResult {
  const typed = draft.targetPrice.trim() !== ''
  const target = typed ? priceCents(draft.targetPrice) : null
  const drop = dropPercentOf(draft.dropPercent)
  const errors: SettingsErrors = {}
  if (typed && target === null) errors.targetPrice = INVALID_PRICE_TEXT
  if (drop === null) errors.dropPercent = INVALID_DROP_TEXT
  if (drop === null || firstInvalidSettingsField(errors)) return { patch: null, errors }
  return { patch: { targetPriceCents: target, dropPercent: drop }, errors: null }
}

export function stopConfirmText(heading: ProductHeading): string {
  const product = heading.pending ? 'este produto' : `"${heading.title}"`
  return `Parar de monitorar ${product}? Ele sai da lista e você não recebe mais alertas dele.`
}

export function removeListingConfirmText(retailer: WatchRetailer, merchant: string | null): string {
  const name = buscapeMerchant(retailer, merchant)
  const store = name ? `${name}, via ${WATCH_STORE_LABEL[retailer]}` : WATCH_STORE_LABEL[retailer]
  return `Remover este anúncio (${store})? Ele não será buscado de novo.`
}

export const RUNNING_TEXT = 'Verificando agora'
export const BLOCKED_PREFIX = 'Bloqueado'
export const STOPPED_TEXT = `Parado: ${AUTO_CHECKS_OFF_TEXT}`
export const WAITING_FALLBACK_TEXT = 'Aguardando'
export const NO_REQUEST_YET_TEXT = 'Nenhuma requisição ainda'
export const NO_ALERT_YET_TEXT = 'Nenhum alerta enviado ainda'

export const WAITING_TEXT: Record<WatchWaitingReason, string> = {
  next_refresh: 'Aguardando a próxima verificação',
  ml_busy: 'Aguardando o Mercado Livre terminar',
  ml_cycle: 'Aguardando o próximo ciclo do Mercado Livre',
}

const ALERT_STATES: ReadonlySet<WatchSourceState> = new Set(['held', 'blocked', 'stopped'])

function heldText(source: WatchSourceStatus): string {
  return source.holdText ? `${HOLD_PREFIX}: ${source.holdText}` : HOLD_PREFIX
}

function blockedText(source: WatchSourceStatus): string {
  const until = source.blockedUntil ? ` até ${formatDayMonthTime(source.blockedUntil)}` : ''
  const reason = source.lastError ? ` (${source.lastError})` : ''
  return `${BLOCKED_PREFIX}${until}${reason}`
}

function waitingText(source: WatchSourceStatus): string {
  return source.waitingFor ? WAITING_TEXT[source.waitingFor] : WAITING_FALLBACK_TEXT
}

const STATE_TEXT: Record<WatchSourceState, (source: WatchSourceStatus) => string> = {
  running: () => RUNNING_TEXT,
  held: heldText,
  blocked: blockedText,
  waiting: waitingText,
  stopped: () => STOPPED_TEXT,
}

export function sourceStateText(source: WatchSourceStatus): string {
  return STATE_TEXT[source.state](source)
}

function lastRequestText(lastRequestAt: Date | null, now: Date): string {
  return lastRequestAt ? `Última requisição ${formatAgo(lastRequestAt, now)}` : NO_REQUEST_YET_TEXT
}

function sourceLines(source: WatchSourceStatus, now: Date): string[] {
  const listings = `Anúncios: ${formatCount(source.listings)}`
  const requests = source.retailer === ML_RETAILER ? [] : [`Requisições hoje: ${formatCount(source.requestsToday)}`]
  const next = source.nextRefreshAt ? [`Próxima verificação: ${relativeTime(source.nextRefreshAt, now)}`] : []
  const error = source.lastError && source.state !== 'blocked' ? [`Último erro: ${source.lastError}`] : []
  return [listings, ...requests, lastRequestText(source.lastRequestAt, now), ...next, ...error]
}

export function lastAlertText(alert: WatchLastAlert | null, now: Date): string {
  if (!alert) return NO_ALERT_YET_TEXT
  return `Último alerta ${formatAgo(alert.sentAt, now)}: ${alert.productName} por ${formatCents(alert.priceCents)} (${WATCH_ALERT_KIND_LABEL[alert.kind]})`
}

export interface SourcePanel { retailer: WatchRetailer; label: string; state: string; alert: boolean; lines: string[] }
export interface MonitorPanel { summary: string[]; sources: SourcePanel[] }

export function monitorPanel(status: WatchStatus, now: Date): MonitorPanel {
  return {
    summary: [`${PRODUCTS_LIST_TITLE}: ${formatCount(status.products)}`, lastAlertText(status.lastAlert, now)],
    sources: status.sources.map((source) => ({
      retailer: source.retailer,
      label: WATCH_STORE_LABEL[source.retailer],
      state: sourceStateText(source),
      alert: ALERT_STATES.has(source.state),
      lines: sourceLines(source, now),
    })),
  }
}
