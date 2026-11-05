import { beforeEach, expect, test, vi } from 'vitest'
import { VPN_CACHE_MS, VPN_CLEAR_CACHE_MS } from '@/lib/constants'
import { vpnCheck, vpnConnected, type VpnDeps } from './vpn-guard'

vi.mock('@/env', () => ({ env: () => ({ VPN_HOLD_NAMES: ['ca-DC-ipsec-vpn'] }) }))

const CONNECTED = 'Status: Connected\n  VPN name: CA-DC-IPSEC-VPN\n  IP: 172.16.88.38\n'
let clock = 1_000_000

function deps(run: VpnDeps['run'], timeoutMs?: number) {
  const logs: string[] = []
  const d: VpnDeps = { run: vi.fn(run), now: () => clock, holdNames: () => ['ca-DC-ipsec-vpn'], logError: (l) => logs.push(l), timeoutMs }
  return { d, logs }
}

const errorWith = (code: string | undefined, message = 'boom') => Object.assign(new Error(message), { code })

beforeEach(() => {
  globalThis.__promoVpnCache = undefined
  globalThis.__promoVpnErrorLogged = undefined
  clock = 1_000_000
})

test('a connected listed VPN holds', async () => {
  const { d } = deps(async () => CONNECTED)
  expect(await vpnCheck(d)).toEqual({ held: true, state: 'connected', name: 'CA-DC-IPSEC-VPN' })
})

test('disconnected and another VPN do not hold', async () => {
  expect((await vpnCheck(deps(async () => 'Status: Disconnected\n').d)).held).toBe(false)
  globalThis.__promoVpnCache = undefined
  const other = await vpnCheck(deps(async () => 'Status: Connected\n  VPN name: Home\n').d)
  expect(other).toEqual({ held: false, state: 'clear', name: 'Home' })
})

test.each(['nonsense', '', '   \n', 'Error: daemon not running'])('output %j has no Status line: unknown, held, logged once', async (output) => {
  const { d, logs } = deps(async () => output)
  expect(await vpnCheck(d)).toEqual({ held: true, state: 'unknown', name: null })
  clock += VPN_CACHE_MS
  await vpnCheck(d)
  expect(logs).toEqual(['saída do forticlient sem linha Status'])
})

test('connected with no VPN name holds', async () => {
  expect(await vpnCheck(deps(async () => 'Status: Connected\n  IP: 1.2.3.4\n').d)).toEqual({ held: true, state: 'connected', name: null })
})

test('a non-zero exit with a readable Status line is judged by that output', async () => {
  const exit = Object.assign(new Error('Command failed'), { code: 1, stdout: 'Status: Disconnected\n' })
  expect((await vpnCheck(deps(async () => { throw exit }).d)).state).toBe('clear')
  globalThis.__promoVpnCache = undefined
  const connected = Object.assign(new Error('Command failed'), { code: 1, stdout: CONNECTED })
  expect((await vpnCheck(deps(async () => { throw connected }).d)).state).toBe('connected')
})

test('a non-zero exit without a Status line is an error and holds', async () => {
  const exit = Object.assign(new Error('Command failed\nboom'), { code: 2, stdout: 'garbage' })
  const { d, logs } = deps(async () => { throw exit })
  expect(await vpnCheck(d)).toEqual({ held: true, state: 'error', name: null })
  expect(logs).toEqual(['Command failed'])
})

test('a command that never settles times out as an error and holds', async () => {
  const { d, logs } = deps(() => new Promise<string>(() => undefined), 20)
  expect(await vpnCheck(d)).toEqual({ held: true, state: 'error', name: null })
  expect(logs).toEqual(['o comando forticlient não respondeu a tempo'])
})

test('a clear result is cached for the short window and a held result for the long one', async () => {
  const clear = deps(async () => 'Status: Disconnected')
  await vpnCheck(clear.d)
  clock += VPN_CLEAR_CACHE_MS - 1
  await vpnCheck(clear.d)
  expect(clear.d.run).toHaveBeenCalledTimes(1)
  clock += 1
  await vpnCheck(clear.d)
  expect(clear.d.run).toHaveBeenCalledTimes(2)
  globalThis.__promoVpnCache = undefined
  const held = deps(async () => CONNECTED)
  await vpnCheck(held.d)
  clock += VPN_CLEAR_CACHE_MS
  await vpnCheck(held.d)
  expect(held.d.run).toHaveBeenCalledTimes(1)
})

test('a missing command turns the guard off, without logging', async () => {
  const { d, logs } = deps(async () => { throw errorWith('ENOENT') })
  expect(await vpnCheck(d)).toEqual({ held: false, state: 'off', name: null })
  expect(logs).toEqual([])
})

test('a timeout or other error holds, and is logged once across checks', async () => {
  const { d, logs } = deps(async () => { throw errorWith(undefined, 'Command failed\nstderr') })
  expect(await vpnConnected(d)).toBe(true)
  clock += VPN_CACHE_MS
  expect((await vpnCheck(d)).state).toBe('error')
  expect(logs).toEqual(['Command failed'])
})

test('after a good check an error is logged again', async () => {
  let fail = true
  const { d, logs } = deps(async () => {
    if (fail) throw errorWith('ETIMEDOUT', 'timed out')
    return 'Status: Disconnected'
  })
  await vpnCheck(d)
  clock += VPN_CACHE_MS
  fail = false
  await vpnCheck(d)
  clock += VPN_CACHE_MS
  fail = true
  await vpnCheck(d)
  expect(logs).toEqual(['timed out', 'timed out'])
})

test('the result is cached for the cache window and refreshed after it', async () => {
  const { d } = deps(async () => CONNECTED)
  await vpnCheck(d)
  clock += VPN_CACHE_MS - 1
  await vpnCheck(d)
  expect(d.run).toHaveBeenCalledTimes(1)
  clock += 1
  await vpnCheck(d)
  expect(d.run).toHaveBeenCalledTimes(2)
})

test('concurrent checks share one command', async () => {
  const { d } = deps(async () => CONNECTED)
  await Promise.all([vpnCheck(d), vpnCheck(d), vpnCheck(d)])
  expect(d.run).toHaveBeenCalledTimes(1)
})
