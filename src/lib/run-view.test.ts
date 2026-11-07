import { describe, expect, it } from 'vitest'
import { formatCount } from './format'
import { liveRunIds, RUN_ERROR_MAX_CHARS, runCountItems, runDurationMs, runErrorView, runShowsPages, runStatusText, runTone, suggestsVerification } from './run-view'

const now = new Date('2026-11-02T12:00:00Z')

describe('runStatusText and runTone', () => {
  it.each([
    ['ok', 'ok', 'badge-new'],
    ['logged_in', 'conectado', 'badge-new'],
    ['partial', 'parcial', 'badge-saved'],
    ['unconfirmed', 'não confirmado', 'badge-saved'],
    ['failed', 'falhou', 'badge-warn'],
    ['blocked', 'bloqueado', 'badge-warn'],
    ['session_expired', 'sessão expirada', 'badge-warn'],
    ['refused', 'recusado', 'badge-warn'],
    ['timed_out', 'não concluído', 'badge-warn'],
  ] as const)('%s', (status, text, tone) => {
    expect(runStatusText({ status }, false)).toBe(text)
    expect(runTone({ status }, false)).toBe(tone)
    expect(runStatusText({ status }, true)).toBe(text)
  })

  it('an unfinished run is em andamento only while live, otherwise interrompido', () => {
    expect(runStatusText({ status: null }, true)).toBe('em andamento')
    expect(runTone({ status: null }, true)).toBe('badge-saved')
    expect(runStatusText({ status: null }, false)).toBe('interrompido')
    expect(runTone({ status: null }, false)).toBe('badge-muted')
  })
})

describe('liveRunIds', () => {
  const runs = [
    { id: 'c2', kind: 'cycle', status: null },
    { id: 'l1', kind: 'login', status: null },
    { id: 'c1', kind: 'cycle', status: null },
  ] as const

  it('marks only the newest unfinished run of an active kind', () => {
    expect([...liveRunIds(runs, new Set(['cycle']))]).toEqual(['c2'])
    expect([...liveRunIds(runs, new Set(['cycle', 'login']))]).toEqual(['c2', 'l1'])
  })

  it('marks nothing when no kind is active, or when the newest run is finished', () => {
    expect(liveRunIds(runs, new Set()).size).toBe(0)
    expect(liveRunIds([{ id: 'a', kind: 'cycle', status: 'ok' }, { id: 'b', kind: 'cycle', status: null }], new Set(['cycle'])).size).toBe(0)
    expect(liveRunIds([], new Set(['cycle'])).size).toBe(0)
  })
})

describe('runShowsPages', () => {
  it('hides pages for login runs only', () => {
    expect(runShowsPages({ kind: 'login' })).toBe(false)
    expect(runShowsPages({ kind: 'cycle' })).toBe(true)
    expect(runShowsPages({ kind: 'search' })).toBe(true)
  })
})

describe('runDurationMs for an orphan row', () => {
  it('shows no duration for a run recorded as interrupted by a restart', () => {
    const start = new Date('2026-11-03T01:00:00Z')
    expect(runDurationMs({ startedAt: start, finishedAt: new Date('2026-11-03T09:00:00Z'), counts: { orphan: 1 } })).toBeNull()
  })
})

describe('runDurationMs', () => {
  it('is null while unfinished', () => {
    expect(runDurationMs({ startedAt: now, finishedAt: null })).toBeNull()
  })

  it('is the elapsed time, zero included', () => {
    expect(runDurationMs({ startedAt: now, finishedAt: new Date(now.getTime() + 5000) })).toBe(5000)
    expect(runDurationMs({ startedAt: now, finishedAt: now })).toBe(0)
  })
})

describe('runCountItems', () => {
  it('lists the main cycle counts in order, keeping zeros and skipping absent keys', () => {
    expect(runCountItems({ kind: 'cycle', counts: { seen: 1931, ended: 0, activated: 4, unparsed: 2, activationFailed: 1, discoveredItems: 90, other: 7 } }))
      .toEqual([
        { label: 'cupons lidos', value: formatCount(1931) },
        { label: 'não reconhecidos', value: '2' },
        { label: 'ativados', value: '4' },
        { label: 'ativações falhas', value: '1' },
        { label: 'encerrados', value: '0' },
        { label: 'itens', value: '90' },
      ])
  })

  it('labels the recorded harvest, activation and discovery counts, with the full reading as sim or não', () => {
    const counts = {
      totalCoupons: 2000, seen: 1931, fullHarvest: 1, failedPages: 2, activationSkipped: 3, discoveryPages: 40, discoveryFailed: 1,
    }
    expect(runCountItems({ kind: 'cycle', counts })).toEqual([
      { label: 'cupons no ML', value: formatCount(2000) },
      { label: 'cupons lidos', value: formatCount(1931) },
      { label: 'leitura completa', value: 'sim' },
      { label: 'páginas com falha', value: '2' },
      { label: 'ativações adiadas', value: '3' },
      { label: 'páginas de descoberta', value: '40' },
      { label: 'descobertas com falha', value: '1' },
    ])
    expect(runCountItems({ kind: 'cycle', counts: { fullHarvest: 0 } })).toEqual([{ label: 'leitura completa', value: 'não' }])
  })

  it('labels the watched-product counts of a new cycle after the harvest and activation counts', () => {
    expect(runCountItems({ kind: 'cycle', counts: { watchFailed: 1, seen: 1931, watchProducts: 4, watchMatched: 3 } })).toEqual([
      { label: 'cupons lidos', value: formatCount(1931) },
      { label: 'produtos monitorados', value: '4' },
      { label: 'anúncios do ML encontrados', value: '3' },
      { label: 'falhas no monitoramento', value: '1' },
    ])
  })

  it('is empty for an empty counts object and for non-cycle runs', () => {
    expect(runCountItems({ kind: 'cycle', counts: {} })).toEqual([])
    expect(runCountItems({ kind: 'login', counts: { seen: 3, buscaReads: 1 } })).toEqual([])
  })

  const BUSCA_COUNTS = { buscaReads: 2, buscaPages: 3, buscaItems: 90, buscaFailed: 0, buscaDropped: 1 }
  const BUSCA_ITEMS = [
    { label: 'buscas lidas', value: '2' },
    { label: 'páginas de buscas', value: '3' },
    { label: 'ofertas das buscas', value: '90' },
    { label: 'buscas com falha', value: '0' },
    { label: 'cards descartados nas buscas', value: '1' },
  ]

  it('labels the Busca counts of a search run without the pages its row already shows', () => {
    expect(runCountItems({ kind: 'search', counts: { ...BUSCA_COUNTS, seen: 5 } }))
      .toEqual(BUSCA_ITEMS.filter((item) => item.label !== 'páginas de buscas'))
  })

  it('labels the Busca counts inside a cycle run after the cycle counts', () => {
    expect(runCountItems({ kind: 'cycle', counts: { seen: 5, ...BUSCA_COUNTS } })).toEqual([
      { label: 'cupons lidos', value: '5' },
      ...BUSCA_ITEMS,
    ])
  })
})

describe('suggestsVerification', () => {
  it.each([
    [{ status: 'blocked', error: 'Mercado Livre bloqueou o acesso (https://www.mercadolivre.com.br/captcha/wall/logged)' }, true],
    [{ status: 'blocked', error: 'Mercado Livre bloqueou o acesso (https://www.mercadolivre.com.br/gz/account-verification/x)' }, true],
    [{ status: 'blocked', error: 'o captcha apareceu' }, true],
    [{ status: 'blocked', error: 'Mercado Livre bloqueou o acesso (https://lista.mercadolivre.com.br/x)' }, false],
    [{ status: 'blocked', error: null }, false],
    [{ status: 'failed', error: 'captcha' }, false],
    [null, false],
  ] as const)('%j -> %s', (run, expected) => {
    expect(suggestsVerification(run)).toBe(expected)
  })
})

describe('runErrorView', () => {
  it('shows a short one-line error as it is, with nothing to expand', () => {
    expect(runErrorView('deadlock detected (40P01)')).toEqual({ short: 'deadlock detected (40P01)', full: null })
  })

  it('cuts a long line to the limit, ellipsis included, and keeps the whole text to expand', () => {
    const error = `Failed query: insert into "items" ${'($1, $2, $3), '.repeat(100)}`
    const view = runErrorView(error)
    expect(view?.short.length).toBeLessThanOrEqual(RUN_ERROR_MAX_CHARS)
    expect(view?.short.endsWith('...')).toBe(true)
    expect(error.trim().startsWith(view?.short.slice(0, -3) ?? '')).toBe(true)
    expect(view?.full).toBe(error.trim())
  })

  it('a line exactly at the limit is not cut', () => {
    const error = 'x'.repeat(RUN_ERROR_MAX_CHARS)
    expect(runErrorView(error)).toEqual({ short: error, full: null })
  })

  it('shows only the first line of a multi-line error and keeps every line to expand', () => {
    const error = 'Failed query: insert into "items"\nparams: 1,2,3\r\ncause: deadlock'
    expect(runErrorView(error)).toEqual({ short: 'Failed query: insert into "items"', full: error })
  })

  it('has nothing to show for a missing, empty or blank error', () => {
    expect(runErrorView(null)).toBeNull()
    expect(runErrorView('')).toBeNull()
    expect(runErrorView('  \n ')).toBeNull()
  })
})
