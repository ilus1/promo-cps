import type { BrowserContext } from 'playwright'
import { ENV_KEYS } from '@/env'
import { withoutKeys, type EnvMap } from './browser-env'
import { SCREEN, type VirtualDisplay } from './xvfb'

const FORCE_X11 = '--ozone-platform=x11'
const SYSTEM_CHROME = 'chrome'
const BROWSER_LOCALE = 'pt-BR'
const AUTOMATION_SWITCH = '--enable-automation'
const NO_AUTOMATION_FLAG = '--disable-blink-features=AutomationControlled'

function displayOptions(xvfb: VirtualDisplay | null): { env: EnvMap; args: string[] } {
  const inherited = withoutKeys(process.env, ENV_KEYS)
  if (!xvfb) return { env: inherited, args: [NO_AUTOMATION_FLAG] }
  const onXvfb: EnvMap = { ...inherited, DISPLAY: xvfb.display }
  delete onXvfb.WAYLAND_DISPLAY
  return { env: onXvfb, args: [NO_AUTOMATION_FLAG, FORCE_X11] }
}

export async function launchChrome(profileDir: string, xvfb: VirtualDisplay | null): Promise<BrowserContext> {
  const { chromium } = await import('playwright')
  return chromium.launchPersistentContext(profileDir, {
    channel: SYSTEM_CHROME,
    headless: false,
    locale: BROWSER_LOCALE,
    viewport: SCREEN,
    ignoreDefaultArgs: [AUTOMATION_SWITCH],
    ...displayOptions(xvfb),
  })
}
