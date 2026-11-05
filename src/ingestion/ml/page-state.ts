import { setTimeout as sleep } from 'node:timers/promises'
import type { Page } from 'playwright'
import { env } from '@/env'
import { BLOCKED_STATUSES, classifyLocation } from '@/lib/ml-session'
import { isRecord } from '@/lib/records'
import { isRunStop, RunStop, stopFor } from '../errors'

export type PageProps = Record<string, unknown>
export interface LoadedPage {
  finalUrl: string
  pageProps: PageProps
}

const STATE_READY = 'Boolean(window._n && window._n.ctx && window._n.ctx.r && window._n.ctx.r.appProps && window._n.ctx.r.appProps.pageProps)'
const NAV_TIMEOUT_MS = 45000
const STATE_POLL_MS = 250
const PAGE_PROPS_MISSING = 'pageProps ausente'

export function throwIfStopped(url: string) {
  const outcome = classifyLocation(url)
  if (outcome !== 'ok') throw stopFor(outcome, url)
}

export function throwIfClosed(page: Page, cause: unknown) {
  if (page.isClosed()) throw new RunStop('failed', 'O navegador fechou durante a execução', { cause })
}

async function readSerializedState(page: Page): Promise<string | undefined> {
  await page.waitForFunction(STATE_READY, undefined, { timeout: NAV_TIMEOUT_MS, polling: STATE_POLL_MS })
  return page.evaluate(() => {
    const w = window as unknown as { _n: { ctx: { r: { appProps: { pageProps: unknown } } } } }
    return JSON.stringify(w._n.ctx.r.appProps.pageProps)
  })
}

export async function loadPageProps(page: Page, url: string): Promise<LoadedPage> {
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
    throwIfStopped(page.url())
    if (response && BLOCKED_STATUSES.includes(response.status())) throw stopFor('blocked', url)
    const serialized = await readSerializedState(page)
    const finalUrl = page.url()
    throwIfStopped(finalUrl)
    const pageProps: unknown = serialized ? JSON.parse(serialized) : null
    if (!isRecord(pageProps)) throw new Error(PAGE_PROPS_MISSING)
    return { finalUrl, pageProps }
  } catch (e) {
    if (!isRunStop(e)) throwIfStopped(page.url())
    throw e
  } finally {
    await sleep(env().PAGE_DELAY_MS)
  }
}

export async function loadWithRetry(page: Page, url: string) {
  try {
    return await loadPageProps(page, url)
  } catch (e) {
    if (isRunStop(e)) throw e
    throwIfClosed(page, e)
    return loadPageProps(page, url).catch((retryError: unknown) => {
      throwIfClosed(page, retryError)
      throw retryError
    })
  }
}
