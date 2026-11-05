import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_NOT_FOUND, HTTP_UNPROCESSABLE } from '@/lib/http-status'
import {
  ALERT_BUSCA_GONE_TEXT, ALERT_CREATE_FAILED_TEXT, ALERT_DELETE_FAILED_TEXT, ALERT_DUPLICATE_TEXT, ALERT_NAME_REQUIRED_TEXT,
  APP_UNREACHABLE_TEXT, BUSCA_DELETE_FAILED_TEXT, BUSCA_GONE_TEXT, BUSCA_UPDATE_FAILED_TEXT, COMPARE_FAILED_TEXT, COMPARE_GONE_TEXT,
} from '@/lib/labels'
import { failureText, HOLD_CHANGE_FAILED_TEXT } from '@/lib/hold-view'
import type { BulkSeenRequest } from '@/lib/bulk-seen'
import { buscaNameOf, createFailure, type BuscaDraft, type BuscaFormErrors } from '@/lib/busca-view'
import type { CycleActivity, ItemStatus, LoginStatus, MlStatus, VerifyStatus } from '@/lib/domain'
import type { CompareResponse } from '@/lib/market/types'

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

async function postConfirmed<T>(
  path: string, failure: string, check: (res: Response, failure: string) => void | Promise<void> = ensureOk,
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(CONFIRM_BODY),
  })
  await check(res, failure)
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

const ITEM_STATUS_FAILED = 'Falha ao atualizar a oferta'

export async function requestItemStatus(id: string, status: ItemStatus): Promise<void> {
  const res = await fetch(`/api/items/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status }),
  })
  await ensureOk(res, ITEM_STATUS_FAILED)
}

const BULK_SEEN_FAILED = 'Falha ao marcar as ofertas como vistas'

export async function requestBulkSeen(target: BulkSeenRequest): Promise<number> {
  const res = await fetch('/api/items/seen', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(target),
  })
  await ensureOk(res, BULK_SEEN_FAILED)
  return (await res.json()).marked
}

export class BuscaGoneError extends Error {
  constructor() {
    super(BUSCA_GONE_TEXT)
    this.name = 'BuscaGoneError'
  }
}

export class BuscaRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuscaRequestError'
  }
}

const BUSCAS_PATH = '/api/searches'
const BUSCA_RUN_FAILED = 'Falha ao iniciar a execução da Busca'

function ensureBuscaOk(res: Response, failure: string): void {
  if (res.ok) return
  throw res.status === HTTP_NOT_FOUND ? new BuscaGoneError() : new BuscaRequestError(failure)
}

export function buscaErrorText(e: unknown): string {
  return e instanceof BuscaRequestError ? e.message : APP_UNREACHABLE_TEXT
}

export async function createBusca(draft: BuscaDraft): Promise<BuscaFormErrors | null> {
  const res = await fetch(BUSCAS_PATH, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ name: buscaNameOf(draft), url: draft.url.trim() }),
  })
  if (res.ok) return null
  return createFailure(res.status, await res.json().catch(() => null))
}

export async function updateBusca(id: string, patch: { enabled?: boolean; runEveryHours?: number }): Promise<void> {
  const res = await fetch(`${BUSCAS_PATH}/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch),
  })
  ensureBuscaOk(res, BUSCA_UPDATE_FAILED_TEXT)
}

export async function deleteBusca(id: string): Promise<void> {
  const res = await fetch(`${BUSCAS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  ensureBuscaOk(res, BUSCA_DELETE_FAILED_TEXT)
}

async function ensureBuscaRunOk(res: Response, failure: string): Promise<void> {
  if (res.status === HTTP_CONFLICT) {
    const error = (await res.json().catch(() => null))?.error
    if (error) throw new BuscaRequestError(error)
  }
  ensureBuscaOk(res, failure)
}

export function requestBuscaRun(id: string): Promise<CycleActivity> {
  return postConfirmed(`${BUSCAS_PATH}/${encodeURIComponent(id)}/run`, BUSCA_RUN_FAILED, ensureBuscaRunOk)
}

const ALERTS_PATH = '/api/alerts'

export class AlertRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AlertRequestError'
  }
}

export function alertErrorText(e: unknown): string {
  return e instanceof AlertRequestError ? e.message : APP_UNREACHABLE_TEXT
}

const ALERT_CREATE_ERRORS: Record<number, string> = {
  [HTTP_BAD_REQUEST]: ALERT_NAME_REQUIRED_TEXT,
  [HTTP_CONFLICT]: ALERT_DUPLICATE_TEXT,
  [HTTP_UNPROCESSABLE]: ALERT_BUSCA_GONE_TEXT,
}

export async function saveAlert(name: string, query: string): Promise<void> {
  const res = await fetch(ALERTS_PATH, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, query }),
  })
  if (!res.ok) throw new AlertRequestError(ALERT_CREATE_ERRORS[res.status] ?? ALERT_CREATE_FAILED_TEXT)
}

export async function removeAlert(id: string): Promise<void> {
  const res = await fetch(`${ALERTS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== HTTP_NOT_FOUND) throw new AlertRequestError(ALERT_DELETE_FAILED_TEXT)
}

const PRIORITY_PATH = '/api/coupons/priority'
const PRIORITY_FAILED = 'Falha ao priorizar os cupons'

export type PriorityResult = { prioritized: number; cycleNextRunAt: string | null; pause: string | null; running: boolean }

export class PriorityRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PriorityRequestError'
  }
}

export function priorityErrorText(e: unknown): string {
  return e instanceof PriorityRequestError ? e.message : APP_UNREACHABLE_TEXT
}

export async function requestPriority(query: string): Promise<PriorityResult> {
  const res = await fetch(PRIORITY_PATH, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ query }) })
  if (!res.ok) throw new PriorityRequestError(PRIORITY_FAILED)
  return res.json()
}

export class CompareRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompareRequestError'
  }
}

export function compareErrorText(e: unknown): string {
  return e instanceof CompareRequestError ? e.message : APP_UNREACHABLE_TEXT
}

export async function requestCompare(id: string): Promise<CompareResponse> {
  const res = await fetch(`/api/items/${encodeURIComponent(id)}/compare`, { method: 'POST' })
  if (res.status === HTTP_NOT_FOUND) throw new CompareRequestError(COMPARE_GONE_TEXT)
  if (!res.ok) throw new CompareRequestError(COMPARE_FAILED_TEXT)
  return res.json()
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
