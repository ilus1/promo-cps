import { setTimeout as sleep } from 'node:timers/promises'
import type { Frame, Page, Request as BrowserRequest } from 'playwright'
import { LOGIN_TIMEOUT_MS, ML_LOGIN_URL } from '@/lib/constants'
import { finishRun, startRun } from '@/db/runs'
import type { Run } from '@/db/schema'
import { isLoginInProgress, isLoginOutcome, type LoginState, type LoginStatus } from '@/lib/domain'
import { classifyLocation } from '@/lib/ml-session'
import { withMlBrowser } from './browser'
import { firstLine, redactQueries } from './errors'
import { replanAutoRun } from './auto-run'
import { mlHoldCheck } from './request-hold'
import { serialized } from './run-chain'

declare global {
  var __promoLogin: LoginStatus | undefined
}

export type Landing = 'coupons' | 'home'
export type LoginObserver = { refused: boolean; crashed: boolean; stop: () => void }

export const BROWSER_CRASHED_ERROR = 'O navegador travou durante o login'
export const LOGIN_BLOCK_MARKER = 'no-feasible-authenticators'

const LOGIN_RECORD_TAG = '[login] record'
const LOGIN_POLL_MS = 1000
const SETTLED_POLLS = 3
const HOME_SETTLED_POLLS = 5
const HOME_PATH = '/'
const LOGIN_TARGET = new URL(ML_LOGIN_URL)

export function loginStatus(): LoginStatus {
  return globalThis.__promoLogin ?? { state: 'idle', error: null }
}

function setLogin(state: LoginState, error: string | null = null): LoginStatus {
  const status = { state, error: error === null ? null : redactQueries(error) }
  globalThis.__promoLogin = status
  return status
}

function hasBlockMarker(href: string): boolean {
  return URL.canParse(href) && new URL(href).pathname.includes(LOGIN_BLOCK_MARKER)
}

export function landing(href: string): Landing | null {
  const url = new URL(href)
  if (url.origin !== LOGIN_TARGET.origin || classifyLocation(href) !== 'ok') return null
  if (url.pathname === LOGIN_TARGET.pathname || url.pathname.startsWith(`${LOGIN_TARGET.pathname}/`)) return 'coupons'
  if (url.pathname === HOME_PATH) return 'home'
  return null
}

export function observeLogin(page: Page): LoginObserver {
  const onRequest = (request: BrowserRequest) => {
    if (request.isNavigationRequest() && hasBlockMarker(request.url()) && request.frame() === page.mainFrame()) {
      observer.refused = true
    }
  }
  const onNavigated = (frame: Frame) => {
    if (frame === page.mainFrame() && hasBlockMarker(frame.url())) observer.refused = true
  }
  const onCrash = () => { observer.crashed = true }
  const observer: LoginObserver = {
    refused: false,
    crashed: false,
    stop: () => {
      page.off('request', onRequest)
      page.off('framenavigated', onNavigated)
      page.off('crash', onCrash)
    },
  }
  page.on('request', onRequest)
  page.on('framenavigated', onNavigated)
  page.once('crash', onCrash)
  return observer
}

export async function watchLogin(page: Page, deadline: number, observer: LoginObserver): Promise<LoginState> {
  let last: string | null = null
  let settled = 0
  while (Date.now() < deadline) {
    if (observer.refused) return 'refused'
    if (observer.crashed) throw new Error(BROWSER_CRASHED_ERROR)
    if (page.isClosed()) return 'timed_out'
    const href = page.url()
    if (href === last) {
      settled += 1
    } else {
      last = href
      settled = 0
      console.info('[login]', new URL(href).pathname)
    }
    if (hasBlockMarker(href)) return 'refused'
    const where = landing(href)
    if (where === 'coupons' && settled >= SETTLED_POLLS) return 'logged_in'
    if (where === 'home' && settled >= HOME_SETTLED_POLLS) return 'unconfirmed'
    await sleep(LOGIN_POLL_MS)
  }
  return observer.refused ? 'refused' : 'timed_out'
}

async function openLoginRun(): Promise<Run | null> {
  return startRun('login').catch((e) => {
    console.error(LOGIN_RECORD_TAG, redactQueries(firstLine(e)))
    return null
  })
}

async function closeLoginRun(run: Run | null, outcome: LoginStatus): Promise<void> {
  if (!run) return
  await finishRun(run.id, {
    status: isLoginOutcome(outcome.state) ? outcome.state : 'failed',
    pages: 0,
    counts: {},
    error: outcome.error ?? undefined,
  }).catch((e) => console.error(LOGIN_RECORD_TAG, redactQueries(firstLine(e))))
}

export function startLogin(): void {
  if (isLoginInProgress(loginStatus().state)) return
  setLogin('queued')
  void serialized(async () => {
    const hold = await mlHoldCheck()
    if (hold) {
      setLogin('failed', hold.text)
      return
    }
    const run = await openLoginRun()
    let outcome: LoginStatus = { state: 'failed', error: null }
    try {
      await withMlBrowser('visible', async (page) => {
        setLogin('waiting')
        const observer = observeLogin(page)
        try {
          await page.goto(ML_LOGIN_URL).catch((e) => {
            if (!observer.refused && !page.isClosed()) throw e
          })
          outcome = setLogin(await watchLogin(page, Date.now() + LOGIN_TIMEOUT_MS, observer))
        } finally {
          observer.stop()
        }
      })
    } catch (e) {
      outcome = setLogin('failed', firstLine(e))
    } finally {
      await closeLoginRun(run, outcome)
      replanAutoRun()
    }
  }).catch((e) => {
    setLogin('failed', firstLine(e))
  })
}
