import type { VpnState } from './vpn-status'

export const HOLD_KINDS = ['vpn', 'vpn_unknown', 'manual', 'price_manual'] as const
export type HoldKind = (typeof HOLD_KINDS)[number]

export interface RequestHold { kind: HoldKind; text: string; reason: string }

export const VPN_HOLD_TEXT = 'VPN da empresa conectada: desconecte para rodar'
export const VPN_UNKNOWN_HOLD_TEXT = 'Não foi possível verificar a VPN: tentando de novo'
export const MANUAL_HOLD_TEXT = 'Requisições pausadas manualmente: retome em Conta para rodar'
export const PRICE_MANUAL_HOLD_TEXT = 'Monitoramento pausado manualmente: retome em Conta'

const HOLDS: Record<HoldKind, RequestHold> = {
  vpn: { kind: 'vpn', text: VPN_HOLD_TEXT, reason: 'VPN conectada' },
  vpn_unknown: { kind: 'vpn_unknown', text: VPN_UNKNOWN_HOLD_TEXT, reason: 'VPN não verificada' },
  manual: { kind: 'manual', text: MANUAL_HOLD_TEXT, reason: 'pausado manualmente' },
  price_manual: { kind: 'price_manual', text: PRICE_MANUAL_HOLD_TEXT, reason: 'monitoramento pausado manualmente' },
}

const VPN_HOLD: Record<VpnState, HoldKind | null> = {
  off: null,
  clear: null,
  connected: 'vpn',
  error: 'vpn_unknown',
  unknown: 'vpn_unknown',
}

export function vpnHolds(state: VpnState): boolean {
  return VPN_HOLD[state] !== null
}

export interface HoldInputs { vpn: VpnState; requestsPaused: boolean; priceChecksPaused: boolean }

export function holdOf({ vpn, requestsPaused, priceChecksPaused }: HoldInputs): RequestHold | null {
  const vpnKind = VPN_HOLD[vpn]
  if (vpnKind) return HOLDS[vpnKind]
  if (requestsPaused) return HOLDS.manual
  if (priceChecksPaused) return HOLDS.price_manual
  return null
}

export function mlHoldOf(hold: RequestHold | null): RequestHold | null {
  return hold?.kind === 'price_manual' ? null : hold
}

export interface HoldState {
  hold: RequestHold | null
  vpn: { state: VpnState; name: string | null }
  requestsPaused: boolean
  priceChecksPaused: boolean
}
