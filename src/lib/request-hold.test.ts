import { expect, test } from 'vitest'
import { holdOf, mlHoldOf, vpnHolds, MANUAL_HOLD_TEXT, PRICE_MANUAL_HOLD_TEXT, VPN_HOLD_TEXT, VPN_UNKNOWN_HOLD_TEXT } from './request-hold'

const off = { vpn: 'clear' as const, requestsPaused: false, priceChecksPaused: false }

test('no hold when nothing is on', () => {
  expect(holdOf(off)).toBeNull()
})

test('each source gives its own kind, text and short reason', () => {
  expect(holdOf({ ...off, vpn: 'connected' })).toEqual({ kind: 'vpn', text: VPN_HOLD_TEXT, reason: 'VPN conectada' })
  expect(holdOf({ ...off, requestsPaused: true })).toEqual({ kind: 'manual', text: MANUAL_HOLD_TEXT, reason: 'pausado manualmente' })
  expect(holdOf({ ...off, priceChecksPaused: true })?.text).toBe(PRICE_MANUAL_HOLD_TEXT)
})

test('the VPN outranks the manual pauses and the full pause outranks the price pause', () => {
  expect(holdOf({ vpn: 'connected', requestsPaused: true, priceChecksPaused: true })?.kind).toBe('vpn')
  expect(holdOf({ vpn: 'clear', requestsPaused: true, priceChecksPaused: true })?.kind).toBe('manual')
})

test('the price-only pause does not hold Mercado Livre requests', () => {
  expect(mlHoldOf(holdOf({ ...off, priceChecksPaused: true }))).toBeNull()
  expect(mlHoldOf(holdOf({ ...off, requestsPaused: true }))?.kind).toBe('manual')
  expect(mlHoldOf(holdOf({ ...off, vpn: 'connected' }))?.kind).toBe('vpn')
  expect(mlHoldOf(null)).toBeNull()
})

test('a failed VPN check is its own hold and not a connected VPN', () => {
  expect(holdOf({ ...off, vpn: 'error' })).toEqual({
    kind: 'vpn_unknown', text: VPN_UNKNOWN_HOLD_TEXT, reason: 'VPN não verificada',
  })
  expect(VPN_UNKNOWN_HOLD_TEXT).toBe('Não foi possível verificar a VPN: tentando de novo')
})

test('an unverified VPN still holds Mercado Livre requests, and ranks below a connected one and above the manual pauses', () => {
  expect(mlHoldOf(holdOf({ ...off, vpn: 'error' }))?.kind).toBe('vpn_unknown')
  expect(holdOf({ vpn: 'error', requestsPaused: true, priceChecksPaused: true })?.kind).toBe('vpn_unknown')
})

test('the VPN being off, or clear, holds nothing', () => {
  expect(holdOf({ ...off, vpn: 'off' })).toBeNull()
})

test('an unrecognised VPN output is held as unverified too', () => {
  expect(holdOf({ ...off, vpn: 'unknown' })?.kind).toBe('vpn_unknown')
})

test.each([
  ['off', false], ['clear', false], ['connected', true], ['error', true], ['unknown', true],
] as const)('vpn state %s holds: %s, and the hold agrees with it', (state, holds) => {
  expect(vpnHolds(state)).toBe(holds)
  expect(holdOf({ ...off, vpn: state }) !== null).toBe(holds)
})

test('the unknown VPN output state gives the unverified hold', () => {
  expect(holdOf({ ...off, vpn: 'unknown' })).toMatchObject({ kind: 'vpn_unknown', reason: 'VPN não verificada' })
})
