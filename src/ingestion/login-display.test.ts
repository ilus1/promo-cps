import { describe, expect, it } from 'vitest'
import type { LoginStatus } from '@/lib/domain'
import { loginDisplay, type RecordedLogin, type RecordedRun } from './login-display'

const at = (iso: string) => new Date(iso)
const idle: LoginStatus = { state: 'idle', error: null }
const login = (status: RecordedLogin['status'], iso = '2026-11-02T10:00:00Z', error: string | null = null): RecordedLogin =>
  ({ status, startedAt: at(iso), error })
const cycle = (status: RecordedRun['status'], iso: string): RecordedRun => ({ status, startedAt: at(iso) })
const EXPIRED = { state: 'session_expired', error: null }
const ACTIVE = { state: 'session_active', error: null }

describe('loginDisplay', () => {
  it('shows the in-memory state while a login is in progress', () => {
    expect(loginDisplay({ state: 'waiting', error: null }, login('refused'), null, cycle('session_expired', '2026-11-02T11:00:00Z')))
      .toEqual({ state: 'waiting', error: null })
    expect(loginDisplay({ state: 'queued', error: null }, null, null, null)).toEqual({ state: 'queued', error: null })
  })

  it('shows the last login run after a restart', () => {
    expect(loginDisplay(idle, login('logged_in'), null, null)).toEqual({ state: 'logged_in', error: null })
    expect(loginDisplay(idle, login('failed', '2026-11-02T10:00:00Z', 'boom'), null, null)).toEqual({ state: 'failed', error: 'boom' })
  })

  it('is idle without any login run, or with an unfinished one', () => {
    expect(loginDisplay(idle, null, null, null)).toEqual(idle)
    expect(loginDisplay(idle, login(null), null, null)).toEqual(idle)
  })

  it('prefers a finished in-memory outcome over an older recorded run', () => {
    expect(loginDisplay({ state: 'timed_out', error: null }, login('logged_in'), null, null)).toEqual({ state: 'timed_out', error: null })
  })

  it('follows schedulerPause: session expired after the login, or with no login run', () => {
    expect(loginDisplay(idle, login('logged_in'), null, cycle('session_expired', '2026-11-02T11:00:00Z'))).toEqual(EXPIRED)
    expect(loginDisplay(idle, null, null, cycle('session_expired', '2026-11-02T11:00:00Z'))).toEqual(EXPIRED)
    expect(loginDisplay(idle, login('unconfirmed'), null, cycle('session_expired', '2026-11-02T11:00:00Z'))).toEqual(EXPIRED)
  })

  it('follows schedulerPause: a login after the expiry clears it, an older or equal expiry does not count', () => {
    expect(loginDisplay(idle, login('logged_in'), null, cycle('session_expired', '2026-11-02T09:00:00Z')).state).toBe('logged_in')
    expect(loginDisplay(idle, login('logged_in'), null, cycle('session_expired', '2026-11-02T10:00:00Z')).state).toBe('session_expired')
  })

  it('ignores a later cycle that is unfinished', () => {
    expect(loginDisplay(idle, login('logged_in'), cycle(null, '2026-11-02T11:00:00Z'), null).state).toBe('logged_in')
  })

  it('keeps the expiry visible when no run worked after it, and lifts it when one did', () => {
    const expired = cycle('session_expired', '2026-11-02T09:00:00Z')
    expect(loginDisplay(idle, null, null, expired)).toEqual(EXPIRED)
    expect(loginDisplay(idle, null, cycle('ok', '2026-11-02T08:00:00Z'), expired)).toEqual(EXPIRED)
    expect(loginDisplay(idle, null, cycle('ok', '2026-11-02T11:00:00Z'), expired)).toEqual(ACTIVE)
    expect(loginDisplay(idle, null, cycle('partial', '2026-11-02T11:00:00Z'), expired)).toEqual(ACTIVE)
  })

  it('keeps a refusal visible over a later session_expired cycle', () => {
    expect(loginDisplay(idle, login('refused'), null, cycle('session_expired', '2026-11-02T11:00:00Z')).state).toBe('refused')
  })

  describe('session active', () => {
    it('shows after a worked cycle when no login is recorded (a session that predates login recording)', () => {
      expect(loginDisplay(idle, null, cycle('ok', '2026-11-02T11:00:00Z'), null)).toEqual(ACTIVE)
      expect(loginDisplay(idle, null, cycle('partial', '2026-11-02T11:00:00Z'), null)).toEqual(ACTIVE)
    })

    it('shows when the last login is older than the worked cycle, whatever its outcome', () => {
      for (const status of ['logged_in', 'failed', 'refused', 'timed_out', null] as const) {
        expect(loginDisplay(idle, login(status), cycle('ok', '2026-11-02T11:00:00Z'), null)).toEqual(ACTIVE)
      }
    })

    it('does not show when the login is newer or at the same instant as the worked cycle', () => {
      expect(loginDisplay(idle, login('logged_in', '2026-11-02T12:00:00Z'), cycle('ok', '2026-11-02T11:00:00Z'), null).state).toBe('logged_in')
      expect(loginDisplay(idle, login('logged_in', '2026-11-02T11:00:00Z'), cycle('ok', '2026-11-02T11:00:00Z'), null).state).toBe('logged_in')
    })

    it('does not show when an expiry is newer than the worked cycle', () => {
      expect(loginDisplay(idle, null, cycle('ok', '2026-11-02T09:00:00Z'), cycle('session_expired', '2026-11-02T11:00:00Z'))).toEqual(EXPIRED)
    })

    it('does not show without a worked cycle, nor while a login is in progress', () => {
      expect(loginDisplay(idle, null, null, null)).toEqual(idle)
      expect(loginDisplay({ state: 'waiting', error: null }, null, cycle('ok', '2026-11-02T11:00:00Z'), null).state).toBe('waiting')
    })

    it('a finished in-memory outcome does not hide it when a worked cycle came after the login', () => {
      const timedOut = { state: 'timed_out', error: null } as const
      expect(loginDisplay(timedOut, login('timed_out'), cycle('ok', '2026-11-02T11:00:00Z'), null)).toEqual(ACTIVE)
      expect(loginDisplay({ state: 'refused', error: null }, login('refused'), cycle('ok', '2026-11-02T11:00:00Z'), null)).toEqual(ACTIVE)
    })

    it('a finished in-memory outcome stays when the login is newer than the worked cycle', () => {
      expect(loginDisplay({ state: 'timed_out', error: null }, login('timed_out', '2026-11-02T12:00:00Z'), cycle('ok', '2026-11-02T11:00:00Z'), null).state)
        .toBe('timed_out')
    })

    it('agrees with schedulerPause: refused, worked, then expired shows the expiry', () => {
      expect(loginDisplay(idle, login('refused'), cycle('ok', '2026-11-02T11:00:00Z'), cycle('session_expired', '2026-11-02T12:00:00Z')))
        .toEqual(EXPIRED)
    })
  })
})
