import { readHoldSettings, type HoldSettings } from '@/db/app-settings'
import { holdOf, mlHoldOf, type HoldState, type RequestHold } from '@/lib/request-hold'
import type { VpnState } from '@/lib/vpn-status'
import { firstLine } from './errors'
import { vpnCheck } from './vpn-guard'

declare global {
  var __promoHoldSettingsErrorLogged: boolean | undefined
}

const LOG_TAG = '[request-hold]'
const NO_SETTINGS: HoldSettings = { requestsPaused: false, priceChecksPaused: false }

export interface HoldDeps {
  vpn: () => Promise<VpnState>
  settings: (now: Date) => Promise<HoldSettings>
  logError: (line: string) => void
}

const liveDeps: HoldDeps = {
  vpn: async () => (await vpnCheck()).state,
  settings: (now) => readHoldSettings(now.getTime()),
  logError: (line) => console.error(LOG_TAG, line),
}

export async function requestHold(now: Date, deps: HoldDeps = liveDeps): Promise<RequestHold | null> {
  const settings = await deps.settings(now).then(
    (read) => {
      globalThis.__promoHoldSettingsErrorLogged = false
      return read
    },
    (e: unknown) => {
      if (!globalThis.__promoHoldSettingsErrorLogged) deps.logError(`settings unreadable: ${firstLine(e)}`)
      globalThis.__promoHoldSettingsErrorLogged = true
      return NO_SETTINGS
    },
  )
  return holdOf({ vpn: await deps.vpn(), ...settings })
}

export async function mlRequestHold(now: Date, deps: HoldDeps = liveDeps): Promise<RequestHold | null> {
  return mlHoldOf(await requestHold(now, deps))
}

export function mlHoldCheck(): Promise<RequestHold | null> {
  return mlRequestHold(new Date())
}

export async function holdState(now: Date): Promise<HoldState> {
  const [vpn, settings] = await Promise.all([vpnCheck(), readHoldSettings(now.getTime())])
  return {
    hold: holdOf({ vpn: vpn.state, ...settings }),
    vpn: { state: vpn.state, name: vpn.name },
    requestsPaused: settings.requestsPaused,
    priceChecksPaused: settings.priceChecksPaused,
  }
}
