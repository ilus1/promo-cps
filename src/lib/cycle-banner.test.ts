import { describe, expect, test } from 'vitest'
import { cycleBannerText } from './cycle-banner'
import type { RunRowStatus } from './domain'
import { CYCLE_BANNER_TEXT } from './labels'

const at = (time: string) => new Date(`2026-11-02T${time}:00Z`)
const run = (status: RunRowStatus | null, time: string) => ({ status, startedAt: at(time) })

describe('cycleBannerText', () => {
  test.each([['session_expired'], ['blocked'], ['failed']] as const)('the last finished cycle %s shows its banner', (status) => {
    expect(cycleBannerText(run(status, '10:00'), null, null)).toBe(CYCLE_BANNER_TEXT[status])
  })

  test('no cycle, a worked cycle or an unfinished one shows nothing', () => {
    expect(cycleBannerText(null, null, null)).toBeNull()
    expect(cycleBannerText(run('ok', '10:00'), run('ok', '10:00'), null)).toBeNull()
    expect(cycleBannerText(run('partial', '10:00'), null, null)).toBeNull()
    expect(cycleBannerText(run(null, '10:00'), null, null)).toBeNull()
  })

  test('a later worked cycle clears the banner, an earlier one does not', () => {
    expect(cycleBannerText(run('blocked', '10:00'), run('ok', '11:00'), null)).toBeNull()
    expect(cycleBannerText(run('blocked', '10:00'), run('ok', '09:00'), null)).toBe(CYCLE_BANNER_TEXT.blocked)
    expect(cycleBannerText(run('failed', '10:00'), run('ok', '10:00'), null)).toBe(CYCLE_BANNER_TEXT.failed)
  })

  test('a later logged_in login clears session_expired only', () => {
    expect(cycleBannerText(run('session_expired', '10:00'), null, run('logged_in', '11:00'))).toBeNull()
    expect(cycleBannerText(run('blocked', '10:00'), null, run('logged_in', '11:00'))).toBe(CYCLE_BANNER_TEXT.blocked)
    expect(cycleBannerText(run('failed', '10:00'), null, run('logged_in', '11:00'))).toBe(CYCLE_BANNER_TEXT.failed)
  })

  test('an earlier, equal or unsuccessful login does not clear session_expired', () => {
    const expired = run('session_expired', '10:00')
    expect(cycleBannerText(expired, null, run('logged_in', '09:00'))).toBe(CYCLE_BANNER_TEXT.session_expired)
    expect(cycleBannerText(expired, null, run('logged_in', '10:00'))).toBe(CYCLE_BANNER_TEXT.session_expired)
    expect(cycleBannerText(expired, null, run('refused', '11:00'))).toBe(CYCLE_BANNER_TEXT.session_expired)
    expect(cycleBannerText(expired, null, run('unconfirmed', '11:00'))).toBe(CYCLE_BANNER_TEXT.session_expired)
  })
})
