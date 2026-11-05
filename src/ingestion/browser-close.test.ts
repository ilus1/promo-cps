import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeWithin, isProfileBrowser, killProfileBrowser, profileBrowserPids, type ProcessInfo, type ProcessReader } from './browser-close'

const TIMEOUT_MS = 1000

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('closeWithin', () => {
  it('returns true without killing when close finishes', async () => {
    const kill = vi.fn().mockResolvedValue(undefined)
    await expect(closeWithin({ close: () => Promise.resolve(), kill }, TIMEOUT_MS)).resolves.toBe(true)
    expect(kill).not.toHaveBeenCalled()
  })

  it('treats a close that rejects as finished', async () => {
    const kill = vi.fn().mockResolvedValue(undefined)
    await expect(closeWithin({ close: () => Promise.reject(new Error('gone')), kill }, TIMEOUT_MS)).resolves.toBe(true)
    expect(kill).not.toHaveBeenCalled()
  })

  it('kills the browser and logs when close hangs past the timeout', async () => {
    const kill = vi.fn().mockResolvedValue(undefined)
    const result = closeWithin({ close: () => new Promise<void>(() => undefined), kill }, TIMEOUT_MS)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await expect(result).resolves.toBe(false)
    expect(kill).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalled()
  })

  it('still resolves when the kill itself fails', async () => {
    const kill = vi.fn().mockRejectedValue(new Error('kill failed'))
    const result = closeWithin({ close: () => new Promise<void>(() => undefined), kill }, TIMEOUT_MS)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await expect(result).resolves.toBe(false)
  })
})

describe('profile browser matching', () => {
  const PROFILE = '/x/profile'
  const OWN = 1
  const chrome = (pid: number, dir: string, exe = '/opt/google/chrome/chrome'): ProcessInfo => ({
    pid, argv: ['/opt/google/chrome/chrome', `--user-data-dir=${dir}`, '--x'], exe,
  })
  const readerOf = (infos: ProcessInfo[]): ProcessReader => ({
    list: async () => infos.map((i) => i.pid),
    read: async (pid) => infos.find((i) => i.pid === pid) ?? null,
  })

  it('matches the exact profile dir only', async () => {
    const reader = readerOf([chrome(10, PROFILE), chrome(11, '/x/profile-old'), chrome(12, '/x/profile/sub')])
    expect(await profileBrowserPids(reader, PROFILE, OWN)).toEqual([10])
  })

  it('matches a chrome whose binary was replaced by an update', () => {
    expect(isProfileBrowser(chrome(40, PROFILE, '/opt/google/chrome/chrome (deleted)'), PROFILE, OWN)).toBe(true)
    expect(isProfileBrowser(chrome(41, PROFILE, '/opt/google/chrome/chrome-sandbox'), PROFILE, OWN)).toBe(false)
  })

  it('matches the browser process; children with one joined argv string are left to die with it', async () => {
    const child = (pid: number): ProcessInfo => ({
      pid, argv: [`/opt/google/chrome/chrome --type=renderer --user-data-dir=${PROFILE}`], exe: '/opt/google/chrome/chrome',
    })
    const reader = readerOf([chrome(10, PROFILE), child(11), child(12)])
    expect(await profileBrowserPids(reader, PROFILE, OWN)).toEqual([10])
  })

  it('compares resolved paths on both sides', () => {
    expect(isProfileBrowser(chrome(50, '/x/./profile/'), PROFILE, OWN)).toBe(true)
  })

  it('ignores ESRCH and EPERM from the kill and logs the count', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const codes = ['ESRCH', 'EPERM']
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill'), { code: codes.shift() })
    })
    const reader = readerOf([chrome(10, PROFILE), chrome(11, PROFILE)])
    await expect(killProfileBrowser(PROFILE, reader)).resolves.toBe(2)
    expect(console.log).toHaveBeenCalledWith('[browser]', 'killed 2 browser process(es)')
  })

  it('logs a clear line when nothing matched', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(killProfileBrowser(PROFILE, readerOf([]))).resolves.toBe(0)
    expect(console.log).toHaveBeenCalledWith('[browser]', 'no browser process found for the profile')
  })

  it('ignores a shell that merely carries the flag', () => {
    const shell: ProcessInfo = { pid: 20, argv: ['bash', '-c', `pgrep --user-data-dir=${PROFILE}`], exe: '/usr/bin/bash' }
    expect(isProfileBrowser(shell, PROFILE, OWN)).toBe(false)
    expect(isProfileBrowser({ ...shell, argv: [`--user-data-dir=${PROFILE}`] }, PROFILE, OWN)).toBe(false)
  })

  it('excludes its own pid and skips processes that vanished', async () => {
    const reader: ProcessReader = {
      list: async () => [OWN, 10, 30],
      read: async (pid) => (pid === 30 ? null : chrome(pid, PROFILE)),
    }
    expect(await profileBrowserPids(reader, PROFILE, OWN)).toEqual([10])
  })
})
