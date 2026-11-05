import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { env } from '@/env'
import { AMAZON_PAGE_TIMEOUT_MS, AMAZON_SESSION_DEADLINE_MS } from '@/lib/constants'
import { runOnFirstPage } from '../browser'
import { closeWithin, killProfileBrowser } from '../browser-close'
import { launchChrome } from '../browser-launch'
import { errorText } from '../errors'
import { startXvfb } from '../xvfb'
import type { FetchedPage } from './crawl-page'

const AMAZON_PROFILE_NAME = 'amazon-profile'
const NO_RESPONSE_STATUS = 0
const SCROLL_STEP_PX = 900
const SCROLL_MAX_STEPS = 15
const SCROLL_PAUSE_MS = 400
const SCROLL_SETTLE_MS = 1500
const SESSION_EXPIRED = 'a sessão da Amazon passou do tempo limite'
const SHARED_PROFILE = 'o perfil da Amazon seria o perfil do ML'

export type PageLoader = (url: string, scroll: boolean) => Promise<FetchedPage>

export interface AmazonSession { load: PageLoader; isOpen: () => boolean }

export function amazonProfileDir(mlProfileDir: string = env().ML_PROFILE_DIR): string {
  const profileDir = path.join(path.dirname(mlProfileDir), AMAZON_PROFILE_NAME)
  if (path.resolve(profileDir) === path.resolve(mlProfileDir)) throw new Error(SHARED_PROFILE)
  return profileDir
}

async function withinSessionDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(SESSION_EXPIRED)), AMAZON_SESSION_DEADLINE_MS)
  })
  work.catch(() => undefined)
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
  }
}

export async function withAmazonBrowser<T>(fn: (page: Page, isOpen: () => boolean) => Promise<T>): Promise<T> {
  const profileDir = amazonProfileDir()
  await mkdir(profileDir, { recursive: true })
  const xvfb = await startXvfb()
  let context: BrowserContext
  try {
    context = await launchChrome(profileDir, xvfb)
  } catch (e) {
    await xvfb.stop()
    throw e
  }
  let open = true
  try {
    return await withinSessionDeadline(runOnFirstPage(context, (page) => fn(page, () => open && !page.isClosed())))
  } finally {
    open = false
    await closeWithin({ close: () => context.close(), kill: async () => void await killProfileBrowser(profileDir) })
    await xvfb.stop()
  }
}

async function scrollToBottom(page: Page): Promise<void> {
  for (let step = 0; step < SCROLL_MAX_STEPS; step += 1) {
    await page.mouse.wheel(0, SCROLL_STEP_PX)
    await page.waitForTimeout(SCROLL_PAUSE_MS)
    const atBottom = await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight)
    if (atBottom) break
  }
  await page.waitForTimeout(SCROLL_SETTLE_MS)
}

export function amazonPageLoader(page: Page): PageLoader {
  return async (url, scroll) => {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: AMAZON_PAGE_TIMEOUT_MS })
      if (scroll) await scrollToBottom(page)
      return { status: response?.status() ?? NO_RESPONSE_STATUS, html: await page.content() }
    } catch (e) {
      if (page.isClosed()) throw e
      return { status: NO_RESPONSE_STATUS, html: '', reason: errorText(e) }
    }
  }
}

export function amazonSession(page: Page, isOpen: () => boolean): AmazonSession {
  return { load: amazonPageLoader(page), isOpen }
}
