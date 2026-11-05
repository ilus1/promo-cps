import { describe, expect, it } from 'vitest'
import { isLocalRequest } from './local-origin'

const PORT = 8510
const LOCALHOST = `localhost:${PORT}`
const LOOPBACK_ORIGIN = `http://127.0.0.1:${PORT}`
const EVIL_HOST = 'evil.com'
const EVIL_ORIGIN = `https://${EVIL_HOST}`

const req = (method: string, headers: Record<string, string>) =>
  new Request(`${LOOPBACK_ORIGIN}/api/x`, { method, headers })

describe('isLocalRequest', () => {
  it('allows GET from anywhere', () => {
    expect(isLocalRequest(req('GET', { origin: EVIL_ORIGIN }), PORT)).toBe(true)
  })
  it.each([LOOPBACK_ORIGIN, `http://${LOCALHOST}`])('allows POST from %s', (origin) => {
    expect(isLocalRequest(req('POST', { origin }), PORT)).toBe(true)
  })
  it.each(['POST', 'PUT', 'DELETE'])('rejects %s from another site', (method) => {
    expect(isLocalRequest(req(method, { origin: EVIL_ORIGIN }), PORT)).toBe(false)
  })
  it('rejects POST with a null Origin', () => {
    expect(isLocalRequest(req('POST', { origin: 'null' }), PORT)).toBe(false)
  })
  it('rejects POST from another local port', () => {
    expect(isLocalRequest(req('POST', { origin: 'http://localhost:3000' }), PORT)).toBe(false)
  })
  it('falls back to Host when Origin is absent', () => {
    expect(isLocalRequest(req('POST', { host: LOCALHOST }), PORT)).toBe(true)
    expect(isLocalRequest(req('POST', { host: EVIL_HOST }), PORT)).toBe(false)
  })
  it('decides by Host and ignores X-Forwarded-Host', () => {
    expect(isLocalRequest(req('POST', { host: LOCALHOST, 'x-forwarded-host': EVIL_HOST }), PORT)).toBe(true)
    expect(isLocalRequest(req('POST', { host: EVIL_HOST, 'x-forwarded-host': LOCALHOST }), PORT)).toBe(false)
  })
})
