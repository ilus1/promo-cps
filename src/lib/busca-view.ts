import type { Search } from '@/db/schema'
import type { BadgeTone } from './badge-tone'
import { BUSCA_NAME_MAX, DUPLICATE_BUSCA } from './busca-rules'
import { isRunStatus, isStopStatus } from './domain'
import { formatAgo } from './format'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT } from './http-status'
import {
  BUSCA_CREATE_FAILED_TEXT, BUSCA_DUPLICATE_TEXT, BUSCA_LAST_READ_TEXT, BUSCA_NAME_REQUIRED_TEXT, BUSCA_NO_READ_TEXT, BUSCA_NO_RESULTS_TEXT,
  BUSCA_STOPPED_TEXT, BUSCA_URL_REQUIRED_TEXT,
  buscaNameRangeText, BUSCA_TERM_PARAM, RUN_STATUS_LABEL,
} from './labels'
import { ROUTES } from './routes'
import { classifyBuscaInput, isUrlInput } from './ml-url'
import { runTone } from './run-view'
import { normalizeSearchText } from './text-search'

export type BuscaDraft = { name: string; url: string }
export type BuscaField = keyof BuscaDraft
export type BuscaFormErrors = Partial<Record<BuscaField | 'form', string>>

export const BUSCA_FIELD_ORDER: readonly BuscaField[] = ['name', 'url']

export function buscaNameOf(draft: BuscaDraft): string {
  const name = draft.name.trim()
  const typed = draft.url.trim()
  if (name || isUrlInput(typed)) return name
  return normalizeSearchText(typed)
}

export function followHref(term: string): string {
  return `${ROUTES.searches}?${BUSCA_TERM_PARAM}=${encodeURIComponent(term)}`
}

export function validateBuscaDraft(draft: BuscaDraft): BuscaFormErrors {
  const errors: BuscaFormErrors = {}
  const name = buscaNameOf(draft)
  const url = draft.url.trim()
  if (!name) errors.name = BUSCA_NAME_REQUIRED_TEXT
  else if (name.length > BUSCA_NAME_MAX) errors.name = buscaNameRangeText(BUSCA_NAME_MAX)
  if (!url) errors.url = BUSCA_URL_REQUIRED_TEXT
  else {
    const classified = classifyBuscaInput(url)
    if ('error' in classified) errors.url = classified.error
  }
  return errors
}

export function firstInvalidField(errors: BuscaFormErrors): BuscaField | null {
  return BUSCA_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null
}

type FailureBody = { error?: unknown; details?: { fieldErrors?: Record<string, unknown> } } | null

export function createFailure(status: number, body: FailureBody): BuscaFormErrors {
  if (status === HTTP_CONFLICT && body?.error === DUPLICATE_BUSCA) return { url: BUSCA_DUPLICATE_TEXT }
  const fields = status === HTTP_BAD_REQUEST ? body?.details?.fieldErrors : undefined
  const errors: BuscaFormErrors = {}
  if (fields?.name) errors.name = buscaNameRangeText(BUSCA_NAME_MAX)
  if (Array.isArray(fields?.url) && typeof fields.url[0] === 'string') errors.url = fields.url[0]
  return firstInvalidField(errors) ? errors : { form: BUSCA_CREATE_FAILED_TEXT }
}

export type LastRunView = { tone: BadgeTone; label: string; text: string | null }

export function lastRunView(search: Pick<Search, 'lastStatus' | 'lastRunAt'> & Partial<Pick<Search, 'lastItems'>>, now: Date): LastRunView | null {
  if (!isRunStatus(search.lastStatus)) return null
  const ago = search.lastRunAt ? formatAgo(search.lastRunAt, now) : null
  const lastRead = ago ? `${BUSCA_LAST_READ_TEXT} ${ago}` : null
  const stopped = `${BUSCA_STOPPED_TEXT}; ${lastRead ? lastRead.toLowerCase() : BUSCA_NO_READ_TEXT}`
  const read = isStopStatus(search.lastStatus) ? stopped : lastRead
  const noResults = search.lastStatus === 'ok' && search.lastItems === 0
  const text = noResults ? [read, BUSCA_NO_RESULTS_TEXT].filter(Boolean).join('; ') : read
  return { tone: runTone({ status: search.lastStatus }, false), label: RUN_STATUS_LABEL[search.lastStatus], text }
}
