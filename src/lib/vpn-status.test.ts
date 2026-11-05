import { describe, expect, test } from 'vitest'
import { holdsRequests, parseHoldNames, parseVpnStatus } from './vpn-status'

const CONNECTED = `Status: Connected
  VPN name: CA-DC-IPSEC-VPN
  Username: someone@example.com
  IP: 172.16.88.38
  Sent bytes: 1383172
  Recv bytes: 12693766
  Duration: 01:05:01
`

describe('parseVpnStatus', () => {
  test('connected with the VPN name', () => {
    expect(parseVpnStatus(CONNECTED)).toEqual({ known: true, connected: true, name: 'CA-DC-IPSEC-VPN' })
  })

  test('disconnected has no name', () => {
    expect(parseVpnStatus('Status: Disconnected\n')).toEqual({ known: true, connected: false, name: null })
  })

  test('another VPN name is still parsed', () => {
    expect(parseVpnStatus('Status: Connected\n  VPN name: Home-Lab\n')).toEqual({ known: true, connected: true, name: 'Home-Lab' })
  })

  test('the status word is case-insensitive and tolerates CRLF', () => {
    expect(parseVpnStatus('Status: CONNECTED\r\n  VPN name: X\r\n')).toEqual({ known: true, connected: true, name: 'X' })
  })

  test('connecting and similar states are not connected', () => {
    expect(parseVpnStatus('Status: Connecting\n  VPN name: CA-DC-IPSEC-VPN\n').connected).toBe(false)
    expect(parseVpnStatus('Status: Not Connected\n').connected).toBe(false)
  })

  test.each(['', '   \n', 'garbage', 'Error: daemon not running', 'Connected'])('output %j has no recognisable Status line', (output) => {
    expect(parseVpnStatus(output)).toEqual({ known: false, connected: false, name: null })
  })
})

describe('holdsRequests', () => {
  const names = ['ca-DC-ipsec-vpn']

  test('a connected listed VPN holds, whatever the case', () => {
    expect(holdsRequests({ known: true, connected: true, name: 'CA-DC-IPSEC-VPN' }, names)).toBe(true)
  })

  test('another VPN does not hold', () => {
    expect(holdsRequests({ known: true, connected: true, name: 'Home-Lab' }, names)).toBe(false)
  })

  test('disconnected does not hold, even with a listed name', () => {
    expect(holdsRequests({ known: true, connected: false, name: 'CA-DC-IPSEC-VPN' }, names)).toBe(false)
  })

  test('connected without a name holds, failing closed', () => {
    expect(holdsRequests({ known: true, connected: true, name: null }, names)).toBe(true)
  })

  test('an empty list holds nothing', () => {
    expect(holdsRequests({ known: true, connected: true, name: 'CA-DC-IPSEC-VPN' }, [])).toBe(false)
  })
})

test('hold names are split on commas, trimmed, without blanks', () => {
  expect(parseHoldNames(' a-vpn , B-VPN,, ')).toEqual(['a-vpn', 'B-VPN'])
  expect(parseHoldNames('')).toEqual([])
})
