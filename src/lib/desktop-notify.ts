import { spawn } from 'node:child_process'
import type { Run } from '@/db/schema'
import { isRunStatus, SESSION_EXPIRED_TEXT, type RunKind, type RunStatus } from './domain'
import { APP_NAME } from './labels'
import { notifyBody } from './notify-text'
import { ROUTES } from './routes'
import { appBaseUrl } from './app-url'
import { HEALTH_PREFIX, HEALTH_TEXT, healthCodes } from './cycle-health'
import { CYCLE_COUNT } from './cycle-counts'

const DEFAULT_ACTION = 'default'
const NOTIFY_SEND = 'notify-send'
const XDG_OPEN = 'xdg-open'

export const STDERR_TAIL_CHARS = 500
const REFUSED_URL_TEXT = 'refused a url outside the app'

export interface DesktopNotification { title: string; body: string; url: string }

const SESSION_PROBLEMS: Partial<Record<RunStatus, string>> = {
  session_expired: SESSION_EXPIRED_TEXT,
  blocked: 'acesso bloqueado pelo Mercado Livre',
}

const FAILURES: Partial<Record<RunKind, string>> = {
  cycle: 'o ciclo falhou',
  search: 'a busca falhou',
}

function runProblem({ kind, status }: Pick<Run, 'kind' | 'status'>): string | undefined {
  if (!isRunStatus(status)) return undefined
  if (status === 'failed') return FAILURES[kind]
  return SESSION_PROBLEMS[status]
}

export function sessionNotification(
  run: Pick<Run, 'kind' | 'status' | 'error'>,
  baseUrl: string,
): DesktopNotification | null {
  const problem = runProblem(run)
  if (!problem) return null
  return { title: `${APP_NAME}: ${problem}`, body: run.error ?? '', url: `${baseUrl}${ROUTES.account}` }
}

export function healthNotification(run: Pick<Run, 'kind' | 'counts'>, baseUrl: string): DesktopNotification | null {
  if (run.kind !== 'cycle' || run.counts[CYCLE_COUNT.healthNotify] !== 1) return null
  const codes = healthCodes(run.counts[CYCLE_COUNT.health])
  if (codes.length === 0) return null
  return {
    title: `${APP_NAME}: ${HEALTH_PREFIX}`,
    body: codes.map((code) => HEALTH_TEXT[code]).join('\n'),
    url: `${baseUrl}${ROUTES.account}`,
  }
}

export function notifySendArgs(n: DesktopNotification): string[] {
  return [
    `--app-name=${APP_NAME}`, `--action=${DEFAULT_ACTION}=Abrir`, '--wait',
    '--', n.title, notifyBody(n.body),
  ]
}

function logFailure(command: string, e: unknown): void {
  console.error(`[notify] ${command} failed:`, e instanceof Error ? e.message : String(e))
}

function openUrl(url: string): void {
  if (!url.startsWith(`${appBaseUrl()}/`)) {
    logFailure(XDG_OPEN, REFUSED_URL_TEXT)
    return
  }
  try {
    const open = spawn(XDG_OPEN, [url], { detached: true, stdio: 'ignore' })
    open.on('error', (e) => logFailure(XDG_OPEN, e))
    open.unref()
  } catch (e) {
    logFailure(XDG_OPEN, e)
  }
}

export function sendDesktopNotification(n: DesktopNotification): void {
  try {
    const child = spawn(NOTIFY_SEND, notifySendArgs(n), { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderrTail = ''
    child.on('error', (e) => logFailure(NOTIFY_SEND, e))
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS)
    })
    child.on('close', (code: number | null) => {
      if (code === null || code <= 0) return
      const detail = stderrTail.trim()
      logFailure(NOTIFY_SEND, detail ? `exit ${code}: ${detail}` : `exit ${code}`)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().trim() === DEFAULT_ACTION) openUrl(n.url)
    })
  } catch (e) {
    logFailure(NOTIFY_SEND, e)
  }
}
