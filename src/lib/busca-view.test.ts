import { describe, expect, it } from 'vitest'
import { buscaNameOf, createFailure, followHref, firstInvalidField, lastRunView, validateBuscaDraft } from './busca-view'
import {
  BUSCA_CREATE_FAILED_TEXT, BUSCA_DUPLICATE_TEXT, BUSCA_NAME_REQUIRED_TEXT, BUSCA_URL_REQUIRED_TEXT,
  buscaNameRangeText, BUSCA_NO_RESULTS_TEXT,
} from './labels'
import { EMPTY_SEARCH_TEXT, INVALID_ML_URL } from './ml-url'
import { BUSCA_NAME_MAX, DUPLICATE_BUSCA } from './busca-rules'

const SEARCH_URL = 'https://lista.mercadolivre.com.br/ssd-1tb'
const now = new Date('2026-11-02T12:00:00Z')

describe('validateBuscaDraft', () => {
  it('accepts a name and a Mercado Livre URL', () => {
    expect(validateBuscaDraft({ name: 'SSD', url: SEARCH_URL })).toEqual({})
  })

  it('treats whitespace as empty', () => {
    expect(validateBuscaDraft({ name: '   ', url: '  ' })).toEqual({
      name: BUSCA_NAME_REQUIRED_TEXT, url: BUSCA_URL_REQUIRED_TEXT,
    })
  })

  it('rejects a name longer than the maximum after trimming', () => {
    expect(validateBuscaDraft({ name: 'a'.repeat(BUSCA_NAME_MAX), url: SEARCH_URL })).toEqual({})
    expect(validateBuscaDraft({ name: 'a'.repeat(BUSCA_NAME_MAX + 1), url: SEARCH_URL })).toEqual({
      name: buscaNameRangeText(BUSCA_NAME_MAX),
    })
  })

  it('rejects a URL that is not a Mercado Livre search or product', () => {
    expect(validateBuscaDraft({ name: 'x', url: 'https://example.com/a' })).toEqual({ url: INVALID_ML_URL })
  })

  it('accepts a typed term, defaulting the name to it', () => {
    expect(validateBuscaDraft({ name: '', url: 'fone bluetooth' })).toEqual({})
    expect(buscaNameOf({ name: '', url: ' fone  bluetooth ' })).toBe('fone bluetooth')
    expect(buscaNameOf({ name: ' Meu fone ', url: 'fone' })).toBe('Meu fone')
  })

  it('keeps the name required for a host pasted without a scheme', () => {
    expect(validateBuscaDraft({ name: '', url: 'lista.mercadolivre.com.br/ssd' })).toEqual({ name: BUSCA_NAME_REQUIRED_TEXT })
  })

  it('keeps the name required for a pasted URL', () => {
    expect(validateBuscaDraft({ name: '', url: SEARCH_URL })).toEqual({ name: BUSCA_NAME_REQUIRED_TEXT })
    expect(buscaNameOf({ name: '', url: SEARCH_URL })).toBe('')
  })

  it('rejects a term with no letters or numbers', () => {
    expect(validateBuscaDraft({ name: 'x', url: '!!! ??' })).toEqual({ url: EMPTY_SEARCH_TEXT })
    expect(validateBuscaDraft({ name: '', url: '!!!' })).toEqual({ url: EMPTY_SEARCH_TEXT })
  })
})

describe('firstInvalidField', () => {
  it('follows the form order and ignores form-level errors', () => {
    expect(firstInvalidField({ url: 'a', name: 'b' })).toBe('name')
    expect(firstInvalidField({ url: 'a' })).toBe('url')
    expect(firstInvalidField({ form: 'a' })).toBeNull()
  })
})

describe('createFailure', () => {
  it('maps a duplicate to the URL field', () => {
    expect(createFailure(409, { error: DUPLICATE_BUSCA })).toEqual({ url: BUSCA_DUPLICATE_TEXT })
  })

  it('maps validation field errors to their fields', () => {
    const body = { error: 'invalid_request', details: { fieldErrors: { name: ['x'], url: [INVALID_ML_URL] } } }
    expect(createFailure(400, body)).toEqual({ name: buscaNameRangeText(BUSCA_NAME_MAX), url: INVALID_ML_URL })
  })

  it.each([
    [500, { error: 'internal_error' }],
    [403, { error: 'forbidden_origin' }],
    [409, { error: 'other' }],
    [400, { error: 'invalid_request', details: { fieldErrors: {} } }],
    [400, null],
  ])('falls back to a form error for %s', (status, body) => {
    expect(createFailure(status, body)).toEqual({ form: BUSCA_CREATE_FAILED_TEXT })
  })
})

describe('lastRunView', () => {
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000)

  it('is null before any run or for an unknown status', () => {
    expect(lastRunView({ lastStatus: null, lastRunAt: null }, now)).toBeNull()
    expect(lastRunView({ lastStatus: 'weird', lastRunAt: now }, now)).toBeNull()
  })

  it('shows tone, label and the last read', () => {
    expect(lastRunView({ lastStatus: 'ok', lastRunAt: hoursAgo(2) }, now)).toEqual({
      tone: 'badge-new', label: 'ok', text: 'Última leitura há 2 h',
    })
  })

  it('has no text for a finished run without a read time', () => {
    expect(lastRunView({ lastStatus: 'failed', lastRunAt: null }, now)?.text).toBeNull()
  })

  it('says a stop interrupted the last attempt and when the last read was', () => {
    expect(lastRunView({ lastStatus: 'session_expired', lastRunAt: hoursAgo(5) }, now)).toEqual({
      tone: 'badge-warn', label: 'sessão expirada', text: 'Última tentativa interrompida; última leitura há 5 h',
    })
    expect(lastRunView({ lastStatus: 'blocked', lastRunAt: null }, now)?.text)
      .toBe('Última tentativa interrompida; ainda sem leitura')
  })
})

describe('followHref', () => {
  it('opens Buscas with the term prefilled, encoded', () => {
    expect(followHref('fone')).toBe('/buscas?termo=fone')
    expect(followHref('fone & café')).toBe('/buscas?termo=fone%20%26%20caf%C3%A9')
  })
})

describe('lastRunView with no results', () => {
  const now = new Date('2026-11-03T12:00:00Z')
  const base = { lastStatus: 'ok', lastRunAt: new Date('2026-11-03T11:00:00Z') }

  it('says there were no results when the last read was ok with 0 items', () => {
    expect(lastRunView({ ...base, lastItems: 0 }, now)?.text).toContain(BUSCA_NO_RESULTS_TEXT)
  })

  it('says nothing for items, an unknown count or a failed read', () => {
    expect(lastRunView({ ...base, lastItems: 3 }, now)?.text).not.toContain(BUSCA_NO_RESULTS_TEXT)
    expect(lastRunView({ ...base, lastItems: null }, now)?.text).not.toContain(BUSCA_NO_RESULTS_TEXT)
    expect(lastRunView({ ...base, lastStatus: 'failed', lastItems: 0 }, now)?.text).not.toContain(BUSCA_NO_RESULTS_TEXT)
  })
})
