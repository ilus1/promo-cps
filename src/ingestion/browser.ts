import type { BrowserContext, Page } from 'playwright'
import { env } from '@/env'
import { RUN_DEADLINE_MS } from '@/lib/constants'
import { closeWithin, killProfileBrowser } from './browser-close'
import { launchChrome } from './browser-launch'
import { RunStop } from './errors'
import { startXvfb } from './xvfb'

export const BROWSER_MODES = ['hidden', 'visible'] as const
export type BrowserMode = (typeof BROWSER_MODES)[number]

const PROFILE_IN_USE = /ProcessSingleton|already in use|existing browser session|SingletonLock/i

export type BrowserTask<T> = (page: Page, context: BrowserContext) => Promise<T>

export async function runOnFirstPage<T>(context: BrowserContext, fn: BrowserTask<T>): Promise<T> {
  const page = context.pages()[0] ?? await context.newPage()
  return fn(page, context)
}

async function withinDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RunStop('failed', 'A execução passou do tempo limite')), RUN_DEADLINE_MS)
  })
  work.catch(() => undefined)
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
  }
}

export async function withMlBrowser<T>(mode: BrowserMode, fn: BrowserTask<T>): Promise<T> {
  const xvfb = mode === 'hidden' ? await startXvfb() : null
  let context: BrowserContext
  try {
    context = await launchChrome(env().ML_PROFILE_DIR, xvfb)
  } catch (e) {
    await xvfb?.stop()
    const message = e instanceof Error ? e.message : String(e)
    throw new RunStop('failed', PROFILE_IN_USE.test(message)
      ? 'O perfil do navegador já está em uso'
      : `O Google Chrome não pôde ser iniciado: ${message}`, { cause: e })
  }
  try {
    return await withinDeadline(runOnFirstPage(context, fn))
  } finally {
    await closeWithin({ close: () => context.close(), kill: async () => void await killProfileBrowser(env().ML_PROFILE_DIR) })
    await xvfb?.stop()
  }
}
