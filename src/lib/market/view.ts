import { PERCENT_BASE, SECOND_MS } from '../constants'
import { formatAgo, formatCount, formatDayMonthTime } from '../format'
import { HOLD_PREFIX } from '../hold-view'
import { AMAZON_QUEUED_TEXT, AMAZON_SEARCHED_LABEL, SITE_LABEL } from '../labels'
import type { AmazonProgress, CompareResponse, CrawlerState, CrawlerStatus, KabumProgress, MarketCoverage, MarketStatus, Retailer, WaitingReason } from './types'

export const LESS_THAN_ONE_PERCENT = 'menos de 1%'
export const RUNNING_PREFIX = 'Rodando'
export const BLOCKED_PREFIX = 'Bloqueado'
export const STOPPED_TEXT = 'Parado'
export const WAITING_FALLBACK_TEXT = 'Aguardando'
export const NO_PAGE_YET_TEXT = 'Nenhuma página ainda'
export const BESTSELLERS_NEVER_TEXT = 'Mais vendidos: ainda não lidos'

export const WAITING_TEXT: Record<WaitingReason, string> = {
  next_pass: 'Aguardando a próxima passagem',
  daily_budget: 'Limite do dia atingido',
  ml_busy: 'Aguardando o Mercado Livre terminar',
  queue_empty: 'Fila vazia',
}

const ALERT_STATES: readonly CrawlerState[] = ['held', 'blocked', 'stopped']
const FIRST_DEPARTMENT = 1
const FIRST_PAGE = 1

function runningText(status: CrawlerStatus): string {
  return `${RUNNING_PREFIX}: 1 página a cada ${formatCount(status.intervalMs / SECOND_MS)} s`
}

function heldText(status: CrawlerStatus): string {
  return status.holdText ? `${HOLD_PREFIX}: ${status.holdText}` : HOLD_PREFIX
}

function blockedText(status: CrawlerStatus): string {
  const until = status.blockedUntil ? ` até ${formatDayMonthTime(status.blockedUntil)}` : ''
  const reason = status.lastError ? ` (${status.lastError})` : ''
  return `${BLOCKED_PREFIX}${until}${reason}`
}

function nextPassAt(status: CrawlerStatus): Date | null {
  if (status.waitingFor !== 'next_pass' || status.progress.site !== 'kabum') return null
  return status.progress.nextPassAt
}

function waitingText(status: CrawlerStatus): string {
  if (status.waitingFor === null) return WAITING_FALLBACK_TEXT
  const text = WAITING_TEXT[status.waitingFor]
  const at = nextPassAt(status)
  return at ? `${text} (${formatDayMonthTime(at)})` : text
}

const STATE_TEXT: Record<CrawlerState, (status: CrawlerStatus) => string> = {
  running: runningText,
  held: heldText,
  blocked: blockedText,
  waiting: waitingText,
  stopped: () => STOPPED_TEXT,
}

export function crawlerStateText(status: CrawlerStatus): string {
  return STATE_TEXT[status.state](status)
}

export function crawlerAlert(state: CrawlerState): boolean {
  return ALERT_STATES.includes(state)
}

export function marketCoverageText(coverage: MarketCoverage): string | null {
  if (coverage.total <= 0) return null
  const share = (coverage.matched / coverage.total) * PERCENT_BASE
  const shown = share > 0 && share < 1 ? LESS_THAN_ONE_PERCENT : `${Math.floor(share)}%`
  return `Com preço de mercado: ${shown} das ofertas com ${coverage.minPercent}%+ OFF`
}

export function pagesTodayText(status: Pick<CrawlerStatus, 'pagesToday' | 'dailyBudget'>): string {
  const budget = status.dailyBudget === null ? '' : ` de ${formatCount(status.dailyBudget)}`
  return `Páginas hoje: ${formatCount(status.pagesToday)}${budget}`
}

export function catalogText(validOffers: number): string {
  return `Ofertas no catálogo: ${formatCount(validOffers)}`
}

export function kabumProgressText(progress: KabumProgress): string | null {
  if (progress.department === null || progress.departmentIndex >= progress.departmentCount || progress.page < FIRST_PAGE) return null
  const index = formatCount(progress.departmentIndex + FIRST_DEPARTMENT)
  return `Departamento ${index} de ${formatCount(progress.departmentCount)} (${progress.department}), página ${formatCount(progress.page)}`
}

export function amazonSearchText(progress: AmazonProgress): string {
  const done = progress.searchedKeys === 1 ? 'feita' : 'feitas'
  return `Buscas: ${formatCount(progress.searchedKeys)} ${done}, ${formatCount(progress.dueKeys)} na fila`
}

export function bestsellersText(progress: AmazonProgress, now: Date): string {
  if (progress.bestsellersAt === null) return BESTSELLERS_NEVER_TEXT
  return `Mais vendidos: lidos ${formatAgo(progress.bestsellersAt, now)}`
}

export function lastPageText(lastPageAt: Date | null, now: Date): string {
  return lastPageAt ? `Última página ${formatAgo(lastPageAt, now)}` : NO_PAGE_YET_TEXT
}

function progressLines(progress: KabumProgress | AmazonProgress, now: Date): string[] {
  if (progress.site === 'amazon') return [amazonSearchText(progress), bestsellersText(progress, now)]
  const line = kabumProgressText(progress)
  return line ? [line] : []
}

export interface CrawlerPanel {
  site: Retailer
  label: string
  state: string
  alert: boolean
  lines: string[]
}

export interface MarketPanel {
  sites: CrawlerPanel[]
  coverage: string | null
}

export function crawlerPanel(status: CrawlerStatus, now: Date): CrawlerPanel {
  const site = status.progress.site
  return {
    site,
    label: SITE_LABEL[site],
    state: crawlerStateText(status),
    alert: crawlerAlert(status.state),
    lines: [
      pagesTodayText(status),
      catalogText(status.validOffers),
      ...progressLines(status.progress, now),
      lastPageText(status.lastPageAt, now),
    ],
  }
}

export function marketPanel(status: MarketStatus, now: Date): MarketPanel {
  return {
    sites: [crawlerPanel(status.kabum, now), crawlerPanel(status.amazon, now)],
    coverage: marketCoverageText(status.coverage),
  }
}

export function compareNote(result: CompareResponse, now: Date): string | null {
  if (result.amazonQueued) return AMAZON_QUEUED_TEXT
  if (result.status !== 'no_match' || result.amazonSearchedAt === null) return null
  return `${AMAZON_SEARCHED_LABEL} ${formatAgo(new Date(result.amazonSearchedAt), now)}`
}
