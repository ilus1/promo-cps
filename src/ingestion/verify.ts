import { setTimeout as sleep } from 'node:timers/promises'
import type { Page, Response as BrowserResponse } from 'playwright'
import { discoveryTargets } from '@/db/coupons'
import { VERIFY_TIMEOUT_MS } from '@/lib/constants'
import { isVerifyInProgress, type VerifyState, type VerifyStatus } from '@/lib/domain'
import { closedOutcome, verifyPhase, verifyTarget, type VerifyPhase } from '@/lib/ml-verify'
import { withMlBrowser } from './browser'
import { firstLine, redactQueries } from './errors'
import { mlHoldCheck } from './request-hold'
import { serialized } from './run-chain'

declare global {
  var __promoVerify: VerifyStatus | undefined
}

export type VerifyObserver = { crashed: boolean; status: number | null; stop: () => void }

export const VERIFY_CRASHED_ERROR = 'O navegador travou durante a verificação'

const VERIFY_GOTO_TIMEOUT_MS = 30 * 1000
const VERIFY_POLL_MS = 1000
const VERIFY_SETTLE_MS = 3000

export function verifyStatus(): VerifyStatus {
  return globalThis.__promoVerify ?? { state: 'idle', error: null }
}

function setVerify(state: VerifyState, error: string | null = null) {
  globalThis.__promoVerify = { state, error: error === null ? null : redactQueries(error) }
}

export function observeVerify(page: Page): VerifyObserver {
  const onResponse = (response: BrowserResponse) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      observer.status = response.status()
    }
  }
  const onCrash = () => { observer.crashed = true }
  const observer: VerifyObserver = {
    crashed: false,
    status: null,
    stop: () => {
      page.off('response', onResponse)
      page.off('crash', onCrash)
    },
  }
  page.on('response', onResponse)
  page.once('crash', onCrash)
  return observer
}

export async function watchVerify(page: Page, deadline: number, observer: VerifyObserver): Promise<VerifyState> {
  let last: string | null = null
  let lastPhase: VerifyPhase | null = null
  while (Date.now() < deadline) {
    if (observer.crashed) throw new Error(VERIFY_CRASHED_ERROR)
    if (page.isClosed()) return closedOutcome(lastPhase)
    const href = page.url()
    if (href !== last) {
      last = href
      if (URL.canParse(href)) console.info('[verify]', new URL(href).pathname)
    }
    lastPhase = verifyPhase(href, observer.status)
    if (lastPhase === 'cleared') {
      await sleep(VERIFY_SETTLE_MS)
      if (observer.crashed) throw new Error(VERIFY_CRASHED_ERROR)
      if (page.isClosed()) return closedOutcome(lastPhase)
      lastPhase = verifyPhase(page.url(), observer.status)
      if (lastPhase === 'cleared') return 'cleared'
    }
    await sleep(VERIFY_POLL_MS)
  }
  return 'timed_out'
}

export function startVerify(): void {
  if (isVerifyInProgress(verifyStatus().state)) return
  setVerify('queued')
  void serialized(async () => {
    const hold = await mlHoldCheck()
    if (hold) {
      setVerify('failed', hold.text)
      return
    }
    const target = verifyTarget(await discoveryTargets(1, new Date()))
    await withMlBrowser('visible', async (page) => {
      setVerify('waiting')
      const observer = observeVerify(page)
      try {
        const response = await page.goto(target, { waitUntil: 'commit', timeout: VERIFY_GOTO_TIMEOUT_MS }).catch((e) => {
          if (!page.isClosed()) console.info('[verify] goto', firstLine(e))
          return null
        })
        if (response) observer.status = response.status()
        setVerify(await watchVerify(page, Date.now() + VERIFY_TIMEOUT_MS, observer))
      } finally {
        observer.stop()
      }
    })
  }).catch((e) => {
    setVerify('failed', firstLine(e))
  })
}
