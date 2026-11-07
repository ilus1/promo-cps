import { describe, expect, it } from 'vitest'
import { PORT_TAKEN_ERROR, PROFILE_DIR_NOT_ABSOLUTE_ERROR, parseEnv } from './env'

const base = { DATABASE_URL: 'postgresql://x', ML_PROFILE_DIR: '/tmp/p' }

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv(base)).toMatchObject({
      PORT: 8510, AUTO_RUN: 'on', RUN_EVERY_HOURS: 3, PAGE_DELAY_MS: 1500,
      ACTIVATE_PER_RUN: 20,
    })
  })
  it('ignores the removed discovery budget left in an old .env', () => {
    expect(parseEnv({ ...base, DISCOVERY_PAGES_PER_RUN: '300' })).not.toHaveProperty('DISCOVERY_PAGES_PER_RUN')
  })
  it('holds on ca-DC-ipsec-vpn by default and parses a list', () => {
    expect(parseEnv(base).VPN_HOLD_NAMES).toEqual(['ca-DC-ipsec-vpn'])
    expect(parseEnv({ ...base, VPN_HOLD_NAMES: 'a-vpn, B-VPN' }).VPN_HOLD_NAMES).toEqual(['a-vpn', 'B-VPN'])
  })
  it('allows activation off with 0', () => {
    expect(parseEnv({ ...base, ACTIVATE_PER_RUN: '0' }).ACTIVATE_PER_RUN).toBe(0)
  })
  it('applies the default to an empty activation limit', () => {
    expect(parseEnv({ ...base, ACTIVATE_PER_RUN: '' }).ACTIVATE_PER_RUN).toBe(20)
  })
  it('applies the default to a blank page delay', () => {
    expect(parseEnv({ ...base, PAGE_DELAY_MS: '  ' }).PAGE_DELAY_MS).toBe(1500)
  })
  it('rejects a cycle interval under one hour', () => {
    expect(() => parseEnv({ ...base, RUN_EVERY_HOURS: '0.5' })).toThrow()
  })
  it('accepts a one-hour cycle interval', () => {
    expect(parseEnv({ ...base, RUN_EVERY_HOURS: '1' }).RUN_EVERY_HOURS).toBe(1)
  })
  it('rejects port 8500', () => {
    expect(() => parseEnv({ ...base, PORT: '8500' })).toThrow(PORT_TAKEN_ERROR)
  })
  it('rejects a missing profile dir', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://x' })).toThrow()
  })
  it('rejects a profile dir starting with a tilde', () => {
    expect(() => parseEnv({ ...base, ML_PROFILE_DIR: '~/x' })).toThrow(PROFILE_DIR_NOT_ABSOLUTE_ERROR)
  })
  it('rejects a relative profile dir', () => {
    expect(() => parseEnv({ ...base, ML_PROFILE_DIR: 'rel/x' })).toThrow(PROFILE_DIR_NOT_ABSOLUTE_ERROR)
  })
})
