import { describe, expect, it } from 'vitest'
import { failureText, holdBanner, priceToggleNote, vpnToggleNote, holdChipText, priceChecksToggle, requestsToggle, VPN_UNCHECKABLE_TEXT } from './hold-view'
import { holdOf, type HoldState } from './request-hold'
import type { VpnState } from './vpn-status'

type Over = Partial<{ requestsPaused: boolean; priceChecksPaused: boolean }> & { vpn?: VpnState; name?: string | null }

const state = (over: Over = {}): HoldState => {
  const vpn = over.vpn ?? 'clear'
  const inputs = { vpn, requestsPaused: over.requestsPaused ?? false, priceChecksPaused: over.priceChecksPaused ?? false }
  return { hold: holdOf(inputs), vpn: { state: vpn, name: over.name ?? null }, requestsPaused: inputs.requestsPaused, priceChecksPaused: inputs.priceChecksPaused }
}

describe('holdBanner', () => {
  it('is empty without a hold', () => {
    expect(holdBanner(state())).toBeNull()
  })

  it('names the VPN when it holds', () => {
    expect(holdBanner(state({ vpn: 'connected', name: 'CA-DC-IPSEC-VPN' })))
      .toBe('Em espera: VPN da empresa conectada (CA-DC-IPSEC-VPN). Tudo continua ao desconectar.')
    expect(holdBanner(state({ vpn: 'connected' }))).toBe('Em espera: VPN da empresa conectada. Tudo continua ao desconectar.')
  })

  it('the VPN beats a manual pause', () => {
    expect(holdBanner(state({ vpn: 'connected', requestsPaused: true, name: 'X' }))).toContain('VPN da empresa conectada (X)')
  })

  it('says the VPN could not be checked, from the real error shape (hold vpn_unknown, vpn error)', () => {
    const unknown = state({ vpn: 'error' })
    expect(unknown.hold?.kind).toBe('vpn_unknown')
    expect(unknown.vpn.state).toBe('error')
    expect(holdBanner(unknown)).toBe(VPN_UNCHECKABLE_TEXT)
  })

  it('names the manual holds', () => {
    expect(holdBanner(state({ requestsPaused: true }))).toBe('Em espera: requisições pausadas manualmente.')
    expect(holdBanner(state({ priceChecksPaused: true }))).toBe('Em espera: monitoramento pausado manualmente.')
  })
})

describe('holdChipText', () => {
  it('is VPN for the VPN hold, Pausado for a manual one, and nothing otherwise', () => {
    expect(holdChipText(state({ vpn: 'connected' }))).toBe('Em espera: VPN')
    expect(holdChipText(state({ requestsPaused: true }))).toBe('Pausado')
    expect(holdChipText(state({ priceChecksPaused: true }))).toBe('Monitoramento pausado')
    expect(holdChipText(state({ vpn: 'error' }))).toBe('Em espera: VPN não verificada')
    expect(holdChipText(state())).toBeNull()
  })
})

describe('vpnToggleNote', () => {
  it('names the VPN holds only', () => {
    expect(vpnToggleNote(state({ vpn: 'connected' }))).toBe('em espera pela VPN')
    expect(vpnToggleNote(state({ vpn: 'error' }))).toBe('em espera: VPN não verificada')
    expect(vpnToggleNote(state({ requestsPaused: true }))).toBeNull()
  })
})

describe('priceToggleNote', () => {
  it('notes the VPN hold, or the manual pause of all requests, which also holds the worker', () => {
    expect(priceToggleNote(state({ vpn: 'connected' }))).toBe('em espera pela VPN')
    expect(priceToggleNote(state({ requestsPaused: true }))).toBe('em espera: requisições pausadas')
    expect(priceChecksToggle(false, priceToggleNote(state({ requestsPaused: true }))).state)
      .toBe('Monitoramento: ativo (em espera: requisições pausadas)')
  })

  it('has no note when nothing holds the worker, and the price pause alone is not a note', () => {
    expect(priceToggleNote(state())).toBeNull()
    expect(priceToggleNote(state({ priceChecksPaused: true }))).toBeNull()
  })
})

describe('toggles', () => {
  it('note the VPN hold on an active toggle only', () => {
    expect(requestsToggle(false, 'em espera pela VPN').state).toBe('Requisições: ativas (em espera pela VPN)')
    expect(priceChecksToggle(false, 'em espera pela VPN').state).toBe('Monitoramento: ativo (em espera pela VPN)')
    expect(requestsToggle(true, 'em espera pela VPN').state).toBe('Requisições: pausadas')
  })

  it('flip the action with the state', () => {
    expect(requestsToggle(false)).toEqual({ state: 'Requisições: ativas', action: 'Pausar requisições' })
    expect(requestsToggle(true)).toEqual({ state: 'Requisições: pausadas', action: 'Retomar requisições' })
    expect(priceChecksToggle(false)).toEqual({ state: 'Monitoramento: ativo', action: 'Pausar monitoramento' })
    expect(priceChecksToggle(true)).toEqual({ state: 'Monitoramento: pausado', action: 'Retomar monitoramento' })
  })
})

describe('failureText', () => {
  const failure = 'Falha ao iniciar a execução'

  it('shows a 409 refusal as the server worded it, without the failure prefix', () => {
    expect(failureText(failure, 409, 'Em espera: VPN da empresa conectada')).toBe('Em espera: VPN da empresa conectada')
  })

  it('keeps the failure with the server error for other statuses', () => {
    expect(failureText(failure, 500, 'internal_error')).toBe(`${failure} (internal_error)`)
  })

  it('is the failure alone without a server error', () => {
    expect(failureText(failure, 409, undefined)).toBe(failure)
    expect(failureText(failure, 500, undefined)).toBe(failure)
  })
})
