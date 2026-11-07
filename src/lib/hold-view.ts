import { HTTP_CONFLICT } from './http-status'
import { MONITOR_PANEL_LABEL } from './labels'
import type { HoldState } from './request-hold'

export const HOLD_PREFIX = 'Em espera'
export const VPN_CHIP_TEXT = `${HOLD_PREFIX}: VPN`
export const PAUSED_CHIP_TEXT = 'Pausado'
export const PRICE_PAUSED_CHIP_TEXT = 'Monitoramento pausado'
export const VPN_TOGGLE_NOTE = 'em espera pela VPN'
export const REQUESTS_PAUSED_TOGGLE_NOTE = 'em espera: requisições pausadas'
export const VPN_UNKNOWN_TOGGLE_NOTE = 'em espera: VPN não verificada'
export const VPN_UNKNOWN_CHIP_TEXT = `${HOLD_PREFIX}: VPN não verificada`
export const VPN_UNCHECKABLE_TEXT = `${HOLD_PREFIX}: não foi possível verificar a VPN. Tentando de novo.`
export const REQUESTS_LABEL = 'Requisições'
export const HOLD_CHANGE_FAILED_TEXT = 'Não foi possível alterar a pausa.'

export function holdBanner(state: HoldState): string | null {
  if (state.hold?.kind === 'vpn') {
    const name = state.vpn.name ? ` (${state.vpn.name})` : ''
    return `${HOLD_PREFIX}: VPN da empresa conectada${name}. Tudo continua ao desconectar.`
  }
  if (state.hold?.kind === 'vpn_unknown') return VPN_UNCHECKABLE_TEXT
  if (state.hold?.kind === 'manual') return `${HOLD_PREFIX}: requisições pausadas manualmente.`
  if (state.hold?.kind === 'price_manual') return `${HOLD_PREFIX}: monitoramento pausado manualmente.`
  return null
}

export function holdChipText(state: HoldState): string | null {
  if (state.hold?.kind === 'vpn') return VPN_CHIP_TEXT
  if (state.hold?.kind === 'vpn_unknown') return VPN_UNKNOWN_CHIP_TEXT
  if (state.hold?.kind === 'price_manual') return PRICE_PAUSED_CHIP_TEXT
  if (state.hold) return PAUSED_CHIP_TEXT
  return null
}

export interface HoldToggleView {
  state: string
  action: string
}

function toggleState(label: string, paused: boolean, words: readonly [string, string], heldBy: string | null): string {
  const [active, pausedWord] = words
  const note = heldBy && !paused ? ` (${heldBy})` : ''
  return `${label}: ${paused ? pausedWord : active}${note}`
}

export function vpnToggleNote(state: HoldState): string | null {
  if (state.hold?.kind === 'vpn') return VPN_TOGGLE_NOTE
  if (state.hold?.kind === 'vpn_unknown') return VPN_UNKNOWN_TOGGLE_NOTE
  return null
}

export function priceToggleNote(state: HoldState): string | null {
  return vpnToggleNote(state) ?? (state.requestsPaused ? REQUESTS_PAUSED_TOGGLE_NOTE : null)
}

export function requestsToggle(paused: boolean, heldBy: string | null = null): HoldToggleView {
  return {
    state: toggleState(REQUESTS_LABEL, paused, ['ativas', 'pausadas'], heldBy),
    action: paused ? 'Retomar requisições' : 'Pausar requisições',
  }
}

export function priceChecksToggle(paused: boolean, heldBy: string | null = null): HoldToggleView {
  return {
    state: toggleState(MONITOR_PANEL_LABEL, paused, ['ativo', 'pausado'], heldBy),
    action: paused ? 'Retomar monitoramento' : 'Pausar monitoramento',
  }
}

export function failureText(failure: string, status: number, error: string | undefined): string {
  if (!error) return failure
  return status === HTTP_CONFLICT ? error : `${failure} (${error})`
}
