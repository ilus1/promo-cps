import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from '../constants'
import { formatDayMonthTime } from '../format'
import type { AmazonProgress, CrawlerStatus, KabumProgress, MarketStatus } from './types'
import {
  BESTSELLERS_NEVER_TEXT, compareNote, crawlerAlert, crawlerPanel, crawlerStateText, kabumProgressText, LESS_THAN_ONE_PERCENT, marketCoverageText, marketPanel, NO_PAGE_YET_TEXT,
  STOPPED_TEXT, WAITING_FALLBACK_TEXT,
} from './view'

const NOW = new Date('2026-11-06T18:00:00Z')
const BLOCKED_UNTIL = new Date('2026-11-06T17:30:00Z')
const NEXT_PASS = new Date('2026-11-06T22:40:00Z')

const kabumProgress = (over: Partial<KabumProgress> = {}): KabumProgress => ({
  site: 'kabum', department: 'hardware', departmentIndex: 2, departmentCount: 26, page: 12,
  passStartedAt: new Date('2026-11-06T10:00:00Z'), nextPassAt: NEXT_PASS, ...over,
})

const amazonProgress = (over: Partial<AmazonProgress> = {}): AmazonProgress => ({
  site: 'amazon', searchedKeys: 1234, dueKeys: 567, bestsellersAt: new Date(NOW.getTime() - 5 * HOUR_MS), ...over,
})

const kabum = (over: Partial<CrawlerStatus> = {}): CrawlerStatus => ({
  state: 'running', holdText: null, waitingFor: null, blockedUntil: null, lastError: null,
  pagesToday: 312, dailyBudget: null, intervalMs: 10 * SECOND_MS, lastPageAt: new Date(NOW.getTime() - 3 * MINUTE_MS),
  validOffers: 45678, progress: kabumProgress(), ...over,
})

const amazon = (over: Partial<CrawlerStatus> = {}): CrawlerStatus => ({
  ...kabum(), pagesToday: 140, dailyBudget: 1000, intervalMs: 30 * SECOND_MS, validOffers: 2100, progress: amazonProgress(), ...over,
})

describe('crawlerStateText', () => {
  it('running shows the pace in seconds', () => {
    expect(crawlerStateText(kabum())).toBe('Rodando: 1 página a cada 10 s')
    expect(crawlerStateText(amazon())).toBe('Rodando: 1 página a cada 30 s')
  })

  it('held shows the hold reason, or only the prefix without one', () => {
    expect(crawlerStateText(kabum({ state: 'held', holdText: 'VPN conectada' }))).toBe('Em espera: VPN conectada')
    expect(crawlerStateText(kabum({ state: 'held' }))).toBe('Em espera')
  })

  it('blocked shows the end of the block and the last error', () => {
    const until = formatDayMonthTime(BLOCKED_UNTIL)
    expect(crawlerStateText(amazon({ state: 'blocked', blockedUntil: BLOCKED_UNTIL, lastError: 'HTTP 503' }))).toBe(`Bloqueado até ${until} (HTTP 503)`)
    expect(crawlerStateText(amazon({ state: 'blocked', blockedUntil: BLOCKED_UNTIL }))).toBe(`Bloqueado até ${until}`)
    expect(crawlerStateText(amazon({ state: 'blocked' }))).toBe('Bloqueado')
  })

  it('the block end is read in Sao Paulo time, with the day', () => {
    expect(crawlerStateText(kabum({ state: 'blocked', blockedUntil: BLOCKED_UNTIL }))).toBe('Bloqueado até 06/11 14:30')
  })

  it('waiting for the next Kabum pass shows when it starts', () => {
    expect(crawlerStateText(kabum({ state: 'waiting', waitingFor: 'next_pass' }))).toBe('Aguardando a próxima passagem (06/11 19:40)')
    expect(crawlerStateText(kabum({ state: 'waiting', waitingFor: 'next_pass', progress: kabumProgress({ nextPassAt: null }) })))
      .toBe('Aguardando a próxima passagem')
  })

  it('each other waiting reason has its own text', () => {
    expect(crawlerStateText(amazon({ state: 'waiting', waitingFor: 'daily_budget' }))).toBe('Limite do dia atingido')
    expect(crawlerStateText(amazon({ state: 'waiting', waitingFor: 'ml_busy' }))).toBe('Aguardando o Mercado Livre terminar')
    expect(crawlerStateText(amazon({ state: 'waiting', waitingFor: 'queue_empty' }))).toBe('Fila vazia')
    expect(crawlerStateText(amazon({ state: 'waiting', waitingFor: null }))).toBe(WAITING_FALLBACK_TEXT)
  })

  it('a next pass time is never shown for another waiting reason', () => {
    expect(crawlerStateText(kabum({ state: 'waiting', waitingFor: 'queue_empty' }))).toBe('Fila vazia')
  })

  it('stopped reads Parado', () => {
    expect(crawlerStateText(kabum({ state: 'stopped' }))).toBe(STOPPED_TEXT)
    expect(STOPPED_TEXT).toBe('Parado')
  })
})

describe('crawlerAlert', () => {
  it('marks held, blocked and stopped, never running or waiting', () => {
    expect(crawlerAlert('held')).toBe(true)
    expect(crawlerAlert('blocked')).toBe(true)
    expect(crawlerAlert('stopped')).toBe(true)
    expect(crawlerAlert('running')).toBe(false)
    expect(crawlerAlert('waiting')).toBe(false)
  })
})

describe('marketCoverageText', () => {
  it('floors the share to a whole percent and names the threshold', () => {
    expect(marketCoverageText({ matched: 1, total: 3, minPercent: 30 })).toBe('Com preço de mercado: 33% das ofertas com 30%+ OFF')
    expect(marketCoverageText({ matched: 2, total: 3, minPercent: 30 })).toBe('Com preço de mercado: 66% das ofertas com 30%+ OFF')
    expect(marketCoverageText({ matched: 3, total: 3, minPercent: 30 })).toBe('Com preço de mercado: 100% das ofertas com 30%+ OFF')
  })

  it('never shows 100% before every offer has a price, and says less than 1% for a tiny share', () => {
    expect(marketCoverageText({ matched: 999, total: 1000, minPercent: 30 })).toContain(': 99%')
    expect(marketCoverageText({ matched: 1, total: 1000, minPercent: 30 })).toBe(`Com preço de mercado: ${LESS_THAN_ONE_PERCENT} das ofertas com 30%+ OFF`)
    expect(marketCoverageText({ matched: 0, total: 1000, minPercent: 30 })).toContain(': 0%')
  })

  it('has no line without target offers', () => {
    expect(marketCoverageText({ matched: 0, total: 0, minPercent: 30 })).toBeNull()
  })
})

describe('crawlerPanel', () => {
  it('Kabum: state, pages today without a budget, catalog, pass progress and last page', () => {
    expect(crawlerPanel(kabum(), NOW)).toEqual({
      site: 'kabum',
      label: 'Kabum',
      state: 'Rodando: 1 página a cada 10 s',
      alert: false,
      lines: [
        'Páginas hoje: 312',
        'Ofertas no catálogo: 45.678',
        'Departamento 3 de 26 (hardware), página 12',
        'Última página há 3 min',
      ],
    })
  })

  it('Kabum between passes has no department line', () => {
    const panel = crawlerPanel(kabum({ state: 'waiting', waitingFor: 'next_pass', progress: kabumProgress({ department: null }) }), NOW)
    expect(panel.lines.some((line) => line.startsWith('Departamento'))).toBe(false)
    expect(crawlerPanel(kabum({ progress: kabumProgress({ departmentCount: 0 }) }), NOW).lines).toHaveLength(3)
  })

  it('the department line needs a department inside the list and a first page', () => {
    expect(kabumProgressText(kabumProgress())).toBe('Departamento 3 de 26 (hardware), página 12')
    expect(kabumProgressText(kabumProgress({ departmentIndex: 25 }))).toBe('Departamento 26 de 26 (hardware), página 12')
    expect(kabumProgressText(kabumProgress({ department: null }))).toBeNull()
    expect(kabumProgressText(kabumProgress({ departmentIndex: 26 }))).toBeNull()
    expect(kabumProgressText(kabumProgress({ departmentIndex: 0, departmentCount: 0 }))).toBeNull()
    expect(kabumProgressText(kabumProgress({ page: 0 }))).toBeNull()
  })

  it('Amazon: pages against the daily budget, searches done and queued, best sellers and last page', () => {
    expect(crawlerPanel(amazon(), NOW)).toEqual({
      site: 'amazon',
      label: 'Amazon',
      state: 'Rodando: 1 página a cada 30 s',
      alert: false,
      lines: [
        'Páginas hoje: 140 de 1.000',
        'Ofertas no catálogo: 2.100',
        'Buscas: 1.234 feitas, 567 na fila',
        'Mais vendidos: lidos há 5 h',
        'Última página há 3 min',
      ],
    })
  })

  it('agrees one search in number and says when best sellers or pages were never read', () => {
    const panel = crawlerPanel(amazon({ lastPageAt: null, progress: amazonProgress({ searchedKeys: 1, dueKeys: 0, bestsellersAt: null }) }), NOW)
    expect(panel.lines).toContain('Buscas: 1 feita, 0 na fila')
    expect(panel.lines).toContain(BESTSELLERS_NEVER_TEXT)
    expect(panel.lines.at(-1)).toBe(NO_PAGE_YET_TEXT)
  })

  it('a held crawler is an alert and keeps its progress lines', () => {
    const panel = crawlerPanel(amazon({ state: 'held', holdText: 'VPN conectada' }), NOW)
    expect(panel.state).toBe('Em espera: VPN conectada')
    expect(panel.alert).toBe(true)
    expect(panel.lines).toHaveLength(5)
  })
})

describe('marketPanel', () => {
  it('has one block per site, Kabum first, and the coverage line', () => {
    const status: MarketStatus = { kabum: kabum(), amazon: amazon(), coverage: { matched: 1, total: 4, minPercent: 30 } }
    const panel = marketPanel(status, NOW)
    expect(panel.sites.map((site) => site.label)).toEqual(['Kabum', 'Amazon'])
    expect(panel.coverage).toBe('Com preço de mercado: 25% das ofertas com 30%+ OFF')
  })

  it('has no coverage line without target offers', () => {
    const status: MarketStatus = { kabum: kabum(), amazon: amazon(), coverage: { matched: 0, total: 0, minPercent: 30 } }
    expect(marketPanel(status, NOW).coverage).toBeNull()
  })
})

describe('compareNote', () => {
  const searchedAt = new Date(NOW.getTime() - 2 * DAY_MS).toISOString()

  it('a queued key reads busca na Amazon na fila, whatever the result', () => {
    expect(compareNote({ status: 'no_match', amazonQueued: true, amazonSearchedAt: null }, NOW)).toBe('busca na Amazon na fila')
    expect(compareNote({ status: 'matched', amazonQueued: true, amazonSearchedAt: searchedAt }, NOW)).toBe('busca na Amazon na fila')
  })

  it('a no_match key searched recently says when Amazon searched it', () => {
    expect(compareNote({ status: 'no_match', amazonQueued: false, amazonSearchedAt: searchedAt }, NOW)).toBe('Amazon buscada há 2 d')
    const minutesAgo = new Date(NOW.getTime() - 40 * MINUTE_MS).toISOString()
    expect(compareNote({ status: 'no_match', amazonQueued: false, amazonSearchedAt: minutesAgo }, NOW)).toBe('Amazon buscada há 40 min')
  })

  it('adds nothing when the key was never searched or the item matched', () => {
    expect(compareNote({ status: 'no_match', amazonQueued: false, amazonSearchedAt: null }, NOW)).toBeNull()
    expect(compareNote({ status: 'matched', amazonQueued: false, amazonSearchedAt: searchedAt }, NOW)).toBeNull()
  })
})
