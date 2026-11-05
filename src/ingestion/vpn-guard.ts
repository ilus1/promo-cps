import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { env } from '@/env'
import { FORTICLIENT_BIN, VPN_CACHE_MS, VPN_CHECK_TIMEOUT_MS, VPN_CLEAR_CACHE_MS } from '@/lib/constants'
import { vpnHolds } from '@/lib/request-hold'
import { holdsRequests, parseVpnStatus, type VpnState, type VpnStatus } from '@/lib/vpn-status'
import { firstLine } from './errors'

const exec = promisify(execFile)
const LOG_TAG = '[vpn-guard]'
const MISSING_COMMAND = 'ENOENT'
const STATUS_ARGS = ['vpn', 'status']
const KILL_SIGNAL = 'SIGKILL'
const TIMED_OUT = 'o comando forticlient não respondeu a tempo'
const UNRECOGNISED = 'saída do forticlient sem linha Status'

export interface VpnCheck { held: boolean; state: VpnState; name: string | null }

export interface VpnDeps {
  run: () => Promise<string>
  now: () => number
  holdNames: () => readonly string[]
  logError: (line: string) => void
  timeoutMs?: number
}

declare global {
  var __promoVpnCache: { at: number; ttlMs: number | null; check: Promise<VpnCheck> } | undefined
  var __promoVpnErrorLogged: boolean | undefined
}

const liveDeps: VpnDeps = {
  run: async () => (await exec(FORTICLIENT_BIN, STATUS_ARGS, { timeout: VPN_CHECK_TIMEOUT_MS, killSignal: KILL_SIGNAL })).stdout,
  now: Date.now,
  holdNames: () => env().VPN_HOLD_NAMES,
  logError: (line) => console.error(LOG_TAG, line),
  timeoutMs: VPN_CHECK_TIMEOUT_MS,
}

function checked(state: VpnState, name: string | null): VpnCheck {
  return { held: vpnHolds(state), state, name }
}

function failClosed(deps: VpnDeps, state: 'error' | 'unknown', reason: string): VpnCheck {
  if (!globalThis.__promoVpnErrorLogged) deps.logError(reason)
  globalThis.__promoVpnErrorLogged = true
  return checked(state, null)
}

function judged(deps: VpnDeps, status: VpnStatus): VpnCheck {
  if (!status.known) return failClosed(deps, 'unknown', UNRECOGNISED)
  globalThis.__promoVpnErrorLogged = false
  return checked(holdsRequests(status, deps.holdNames()) ? 'connected' : 'clear', status.name)
}

function withTimeout(work: Promise<string>, ms: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMED_OUT)), ms)
    timer.unref()
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

async function check(deps: VpnDeps): Promise<VpnCheck> {
  try {
    return judged(deps, parseVpnStatus(await withTimeout(deps.run(), deps.timeoutMs ?? VPN_CHECK_TIMEOUT_MS)))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === MISSING_COMMAND) return checked('off', null)
    const stdout = (e as { stdout?: unknown }).stdout
    const status = typeof stdout === 'string' ? parseVpnStatus(stdout) : null
    if (status?.known) return judged(deps, status)
    return failClosed(deps, 'error', firstLine(e))
  }
}

export function vpnCheck(deps: VpnDeps = liveDeps): Promise<VpnCheck> {
  const cached = globalThis.__promoVpnCache
  if (cached && deps.now() - cached.at < (cached.ttlMs ?? VPN_CACHE_MS)) return cached.check
  const entry = { at: deps.now(), ttlMs: null as number | null, check: check(deps) }
  void entry.check.then((result) => { entry.ttlMs = result.held ? VPN_CACHE_MS : VPN_CLEAR_CACHE_MS })
  globalThis.__promoVpnCache = entry
  return entry.check
}

export async function vpnConnected(deps: VpnDeps = liveDeps): Promise<boolean> {
  return (await vpnCheck(deps)).held
}
