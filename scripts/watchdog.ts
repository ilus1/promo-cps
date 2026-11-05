import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { SECOND_MS } from '@/lib/constants'
import type { HealthReport } from '@/lib/health-view'
import { HTTP_OK } from '@/lib/http-status'
import { APP_NAME } from '@/lib/labels'
import { notifyBody } from '@/lib/notify-text'
import {
  PROBLEM_IDS, WATCHDOG_TIMEOUT_MS, watchdogDecision, watchdogState,
  type ProblemId, type WatchdogInput, type WatchdogNotification, type WatchdogState,
} from '@/lib/watchdog-rules'

const run = promisify(execFile)

const NOTIFY_SEND = 'notify-send'
const NOTIFY_TIMEOUT_MS = 10 * SECOND_MS
const HEALTH_PATH = '/api/health'
const DEFAULT_PROMO_URL = 'http://127.0.0.1:8510'
const STATE_DIR_NAME = 'promo-cps'
const STATE_FILE_NAME = 'watchdog.json'
const LOG_TAG = '[watchdog]'

function stateFile(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state')
  return join(base, STATE_DIR_NAME, STATE_FILE_NAME)
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isHealthReport(value: unknown): value is HealthReport {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.runEveryHours === 'number' && typeof v.schedulerEnabled === 'boolean' && typeof v.serverStartedAt === 'string' && 'lastCycle' in v && 'pause' in v
}

async function fetchHealth(): Promise<WatchdogInput> {
  const base = process.env.PROMO_URL || DEFAULT_PROMO_URL
  try {
    const res = await fetch(`${base}${HEALTH_PATH}`, { signal: AbortSignal.timeout(WATCHDOG_TIMEOUT_MS) })
    if (res.status !== HTTP_OK) {
      console.error(LOG_TAG, `health check answered ${res.status}`)
      return 'unreachable'
    }
    const body: unknown = await res.json()
    return isHealthReport(body) ? body : 'unreachable'
  } catch (e) {
    console.error(LOG_TAG, 'health check failed:', message(e))
    return 'unreachable'
  }
}

async function readState(file: string): Promise<WatchdogState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const state: WatchdogState = {}
    for (const id of PROBLEM_IDS) {
      const value = (parsed as Record<string, unknown>)[id]
      if (typeof value === 'string') state[id] = value
    }
    const holdSeenAt = (parsed as Record<string, unknown>).holdSeenAt
    if (typeof holdSeenAt === 'string') state.holdSeenAt = holdSeenAt
    return state
  } catch {
    return {}
  }
}

async function writeState(file: string, state: WatchdogState): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tmp, file)
}

async function send(n: WatchdogNotification): Promise<boolean> {
  try {
    await run(NOTIFY_SEND, [`--app-name=${APP_NAME}`, '--', n.title, notifyBody(n.body)], { timeout: NOTIFY_TIMEOUT_MS })
    return true
  } catch (e) {
    console.error(LOG_TAG, `${NOTIFY_SEND} failed for ${n.id}:`, message(e))
    return false
  }
}

async function main(): Promise<void> {
  const file = stateFile()
  const now = new Date()
  const previous = await readState(file)
  const decision = watchdogDecision(await fetchHealth(), now, previous)
  const sent: ProblemId[] = []
  for (const n of decision.notifications) {
    if (await send(n)) sent.push(n.id)
  }
  await writeState(file, watchdogState(previous, decision, sent, now))
  console.log(LOG_TAG, `active: ${decision.active.join(', ') || 'none'}; notified: ${sent.join(', ') || 'none'}`)
}

main().catch((e) => {
  console.error(LOG_TAG, message(e))
  process.exitCode = 1
})
