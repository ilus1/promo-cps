import { HTTP_NOT_FOUND } from '@/lib/http-status'
import { APP_UNREACHABLE_TEXT } from '@/lib/labels'
import { failureText, HOLD_CHANGE_FAILED_TEXT } from '@/lib/hold-view'
import type { CycleActivity, LoginStatus, MlStatus, VerifyStatus } from '@/lib/domain'
import {
  conflictText, LISTING_GONE_TEXT, LISTING_REMOVE_FAILED_TEXT, WATCH_GONE_TEXT, WATCH_REFRESH_FAILED_TEXT, WATCH_SAVE_FAILED_TEXT,
  WATCH_STOP_FAILED_TEXT, watchCreateFailure, type SettingsPatch, type WatchFormErrors, type WatchRequest,
} from '@/lib/watch/view'

const JSON_HEADERS = { 'content-type': 'application/json' }
const CONFIRM_BODY = { confirm: true }
const LOGIN_REQUEST_FAILED = 'Falha ao abrir a janela de login'
const VERIFY_REQUEST_FAILED = 'Falha ao abrir a janela de verificação'
const RUN_REQUEST_FAILED = 'Falha ao iniciar a execução'
const STATUS_REQUEST_FAILED = 'Falha ao consultar o Mercado Livre'

async function ensureOk(res: Response, failure: string): Promise<void> {
  if (res.ok) return
  const error = (await res.json().catch(() => null))?.error
  throw new Error(failureText(failure, res.status, error))
}

async function postConfirmed<T>(path: string, failure: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(CONFIRM_BODY),
  })
  await ensureOk(res, failure)
  return res.json()
}

export function requestMlLogin(): Promise<LoginStatus> {
  return postConfirmed('/api/ml/login', LOGIN_REQUEST_FAILED)
}

export function requestMlVerify(): Promise<VerifyStatus> {
  return postConfirmed('/api/ml/verify', VERIFY_REQUEST_FAILED)
}

export function requestRun(): Promise<CycleActivity> {
  return postConfirmed('/api/run', RUN_REQUEST_FAILED)
}

export async function fetchMlStatus(): Promise<MlStatus> {
  const res = await fetch('/api/ml/status')
  await ensureOk(res, STATUS_REQUEST_FAILED)
  return res.json()
}

export class WatchGoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WatchGoneError'
  }
}

export class WatchRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WatchRequestError'
  }
}

export function watchErrorText(e: unknown): string {
  return e instanceof WatchRequestError || e instanceof WatchGoneError ? e.message : APP_UNREACHABLE_TEXT
}

const WATCH_PATH = '/api/watch'
const LISTINGS_PATH = `${WATCH_PATH}/listings`

function productPath(id: string): string {
  return `${WATCH_PATH}/${encodeURIComponent(id)}`
}

async function ensureWatchOk(res: Response, failure: string, gone: string = WATCH_GONE_TEXT): Promise<void> {
  if (res.ok) return
  if (res.status === HTTP_NOT_FOUND) throw new WatchGoneError(gone)
  throw new WatchRequestError(conflictText(res.status, await res.json().catch(() => null)) ?? failure)
}

export type WatchCreateResult = { ok: true; id: string | null; started: boolean } | { ok: false; errors: WatchFormErrors }

export async function createWatch(request: WatchRequest): Promise<WatchCreateResult> {
  const res = await fetch(WATCH_PATH, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(request) })
  const body = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, errors: watchCreateFailure(res.status, body) }
  return { ok: true, id: typeof body?.id === 'string' ? body.id : null, started: body?.started !== false }
}

export async function saveWatchSettings(id: string, patch: SettingsPatch): Promise<void> {
  const res = await fetch(productPath(id), { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
  await ensureWatchOk(res, WATCH_SAVE_FAILED_TEXT)
}

export async function stopWatching(id: string): Promise<void> {
  const res = await fetch(productPath(id), { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ active: false }) })
  await ensureWatchOk(res, WATCH_STOP_FAILED_TEXT)
}

export async function requestWatchRefresh(id: string): Promise<void> {
  const res = await fetch(`${productPath(id)}/refresh`, { method: 'POST' })
  await ensureWatchOk(res, WATCH_REFRESH_FAILED_TEXT)
}

export async function removeWatchListing(id: string): Promise<void> {
  const res = await fetch(`${LISTINGS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await ensureWatchOk(res, LISTING_REMOVE_FAILED_TEXT, LISTING_GONE_TEXT)
}

export class HoldRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HoldRequestError'
  }
}

export function holdErrorText(e: unknown): string {
  return e instanceof HoldRequestError ? e.message : APP_UNREACHABLE_TEXT
}

export async function requestHoldChange(change: { requestsPaused?: boolean; priceChecksPaused?: boolean }): Promise<void> {
  const res = await fetch('/api/hold', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(change) })
  if (!res.ok) throw new HoldRequestError(HOLD_CHANGE_FAILED_TEXT)
}
