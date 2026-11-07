import { describe, expect, it, vi } from 'vitest'
import { LOAD_FAILURE_TEXT } from '@/lib/domain'
import { isRunStop, RunStop } from '../errors'
import {
  clickBreaker, loadBreaker, MAX_CONSECUTIVE_LOAD_FAILURES, MAX_UNANSWERED_CLICKS, UNANSWERED_CLICKS_STOP,
} from './breaker'

const ok = <T>(value: T) => () => Promise.resolve(value)
const fail = (message: string) => () => Promise.reject(new Error(`${message}\nCall log: details`))

async function stopOf(promise: Promise<unknown>): Promise<RunStop> {
  const e = await promise.then(() => undefined, (error: unknown) => error)
  if (!isRunStop(e)) throw new Error('expected a RunStop')
  return e
}

function stopOfSync(fn: () => void): RunStop {
  try {
    fn()
  } catch (e) {
    if (isRunStop(e)) return e
    throw e
  }
  throw new Error('expected a RunStop')
}

describe('loadBreaker with a hold', () => {
  const hold = { kind: 'vpn', text: 'x', reason: 'VPN conectada' } as const

  it('stops as partial with the hold reason before loading, and does not count as a failure', async () => {
    const work = vi.fn(ok(1))
    const stop = await stopOf(loadBreaker(async () => hold).load(work))
    expect(stop.status).toBe('partial')
    expect(stop.message).toBe('VPN conectada')
    expect(work).not.toHaveBeenCalled()
  })

  it('loads normally when nothing holds', async () => {
    await expect(loadBreaker(async () => null).load(ok(3))).resolves.toEqual({ ok: true, value: 3 })
  })

  it('checks the hold before every page', async () => {
    let held = false
    const breaker = loadBreaker(async () => (held ? hold : null))
    await breaker.load(ok(1))
    held = true
    await expect(stopOf(breaker.load(ok(2)))).resolves.toMatchObject({ status: 'partial' })
  })

  it('a hold stop does not use up the failure allowance', async () => {
    let held = false
    const breaker = loadBreaker(async () => (held ? hold : null))
    for (let i = 2; i < MAX_CONSECUTIVE_LOAD_FAILURES; i++) await breaker.load(fail('x'))
    held = true
    await stopOf(breaker.load(ok(1)))
    held = false
    await expect(breaker.load(fail('again'))).resolves.toEqual({ ok: false, error: 'again' })
  })
})

describe('loadBreaker', () => {
  it('returns the loaded value', async () => {
    await expect(loadBreaker().load(ok(7))).resolves.toEqual({ ok: true, value: 7 })
  })

  it('returns the first line of the error for each failure below the limit', async () => {
    const breaker = loadBreaker()
    for (let i = 1; i < MAX_CONSECUTIVE_LOAD_FAILURES; i++) {
      await expect(breaker.load(fail(`timeout ${i}`))).resolves.toEqual({ ok: false, error: `timeout ${i}` })
    }
  })

  it('stops as failed on the last consecutive failure allowed, with the load failure text and the last error', async () => {
    const breaker = loadBreaker()
    for (let i = 1; i < MAX_CONSECUTIVE_LOAD_FAILURES; i++) await breaker.load(fail(`failure ${i}`))
    const stop = await stopOf(breaker.load(fail('last')))
    expect(stop.status).toBe('failed')
    expect(stop.counts).toEqual({ loadBreaker: 1 })
    expect(stop.message).toBe(`${LOAD_FAILURE_TEXT}: last`)
  })

  it('resets the count after a successful load', async () => {
    const breaker = loadBreaker()
    for (let i = 1; i < MAX_CONSECUTIVE_LOAD_FAILURES; i++) await breaker.load(fail('before'))
    await breaker.load(ok(1))
    for (let i = 1; i < MAX_CONSECUTIVE_LOAD_FAILURES; i++) {
      await expect(breaker.load(fail('after'))).resolves.toEqual({ ok: false, error: 'after' })
    }
  })

  it('propagates a RunStop at once without counting it', async () => {
    const breaker = loadBreaker()
    const expired = new RunStop('session_expired', 'expirada')
    await expect(breaker.load(() => Promise.reject(expired))).rejects.toBe(expired)
    for (let i = 1; i < MAX_CONSECUTIVE_LOAD_FAILURES; i++) {
      await expect(breaker.load(fail('after'))).resolves.toEqual({ ok: false, error: 'after' })
    }
  })
})

describe('clickBreaker', () => {
  it('stops the run as blocked after the allowed unanswered clicks in a row', () => {
    const breaker = clickBreaker()
    for (let i = 1; i < MAX_UNANSWERED_CLICKS; i++) breaker.saw('unanswered')
    const stop = stopOfSync(() => breaker.saw('unanswered'))
    expect(stop.status).toBe('blocked')
    expect(stop.message).toBe(UNANSWERED_CLICKS_STOP)
  })

  it('resets on an answered click', () => {
    const breaker = clickBreaker()
    for (let i = 1; i < MAX_UNANSWERED_CLICKS; i++) breaker.saw('unanswered')
    breaker.saw('answered')
    for (let i = 1; i < MAX_UNANSWERED_CLICKS; i++) expect(() => breaker.saw('unanswered')).not.toThrow()
  })

  it('ignores an attempt that did not click', () => {
    const breaker = clickBreaker()
    for (let i = 1; i < MAX_UNANSWERED_CLICKS; i++) breaker.saw('unanswered')
    expect(() => breaker.saw('not_clicked')).not.toThrow()
    expect(() => breaker.saw('unanswered')).toThrow(UNANSWERED_CLICKS_STOP)
  })
})

describe('loadBreaker uncounted loads', () => {
  const failing = () => Promise.reject(new Error('page props missing'))

  it('reports a failed load without counting it toward the consecutive-load stop', async () => {
    const breaker = loadBreaker()
    for (let i = 0; i < MAX_CONSECUTIVE_LOAD_FAILURES + 1; i += 1) {
      await expect(breaker.loadUncounted(failing)).resolves.toEqual({ ok: false, error: 'page props missing' })
    }
    for (let i = 0; i < MAX_CONSECUTIVE_LOAD_FAILURES - 1; i += 1) await breaker.load(failing)
    await expect(breaker.load(failing)).rejects.toThrow()
  })

  it('still stops on a wall, a captcha, an expired session or a hold', async () => {
    await expect(loadBreaker().loadUncounted(() => Promise.reject(new RunStop('blocked', 'captcha')))).rejects.toThrow('captcha')
    const expired = await stopOf(loadBreaker().loadUncounted(() => Promise.reject(new RunStop('session_expired', 'login'))))
    expect(expired.status).toBe('session_expired')
    const work = vi.fn(ok(1))
    await expect(loadBreaker(async () => ({ kind: 'manual', text: 'x', reason: 'pausado manualmente' }) as const).loadUncounted(work)).rejects.toThrow('pausado manualmente')
    expect(work).not.toHaveBeenCalled()
    const hold = { kind: 'vpn', text: 'x', reason: 'VPN conectada' } as const
    await expect(loadBreaker(async () => hold).loadUncounted(ok(1))).rejects.toThrow('VPN conectada')
  })
})
