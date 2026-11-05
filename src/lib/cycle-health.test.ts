import { describe, expect, test } from 'vitest'
import { DAY_MS } from './constants'
import {
  cycleHealth, healthBannerText, healthCodes, healthLine, healthMask, HEALTH_CODES, HEALTH_PREFIX, HEALTH_TEXT, reminderToleranceMs, shouldNotifyHealth,
  type HealthCode,
} from './cycle-health'

const HEALTHY = {
  seen: 100, totalCoupons: 100, skipped: 0, unparsed: 0,
  discoveryPages: 10, discoveryRead: 10, discoveredItems: 200, discoveryCards: 200, discoveryFailed: 0, discoveryEmpty: 0,
  droppedCards: 0, discoveryLinks: 50, discoveryBasisOther: 0,
}
const health = (changes: Record<string, number>): HealthCode[] => cycleHealth({ ...HEALTHY, ...changes })

describe('cycleHealth', () => {
  test('a healthy cycle has no warnings', () => {
    expect(cycleHealth(HEALTHY)).toEqual([])
  })

  test('an empty cycle has no warnings', () => {
    expect(cycleHealth({})).toEqual([])
  })

  test('coupons seen under 90% of the total', () => {
    expect(health({ seen: 90 })).toEqual([])
    expect(health({ seen: 89 })).toEqual(['fewCoupons'])
    expect(health({ seen: 0, totalCoupons: 0 })).toContain('fewCoupons')
    expect(health({ seen: 0, totalCoupons: 10 })).toContain('fewCoupons')
  })

  test('any skipped entry', () => {
    expect(health({ skipped: 0 })).toEqual([])
    expect(health({ skipped: 1 })).toEqual(['skipped'])
  })

  test('unparsed over 5% of seen', () => {
    expect(health({ unparsed: 5 })).toEqual([])
    expect(health({ unparsed: 6 })).toEqual(['unparsed'])
    expect(health({ seen: 0, totalCoupons: 0, unparsed: 3 })).not.toContain('unparsed')
  })

  test('fewer than 20 items per listing read', () => {
    expect(health({ discoveryCards: 200 })).toEqual([])
    expect(health({ discoveryCards: 199 })).toEqual(['fewItems'])
    expect(health({ discoveryRead: 0, discoveryCards: 0, discoveryLinks: 0 })).toEqual([])
  })

  test('dropped cards over 5% of discovered items', () => {
    expect(health({ droppedCards: 10 })).toEqual([])
    expect(health({ droppedCards: 11 })).toEqual(['dropped'])
    expect(health({ discoveryCards: 0, discoveryRead: 0, discoveryLinks: 0, droppedCards: 4 })).toEqual([])
  })

  test('failed plus empty listings over 10% of discovery pages', () => {
    expect(health({ discoveryFailed: 1 })).toEqual([])
    expect(health({ discoveryFailed: 1, discoveryEmpty: 1 })).toEqual(['listings'])
    expect(health({ discoveryFailed: 2 })).toEqual(['listings'])
    expect(health({ discoveryPages: 0, discoveryRead: 0, discoveryCards: 0, discoveryLinks: 0, discoveryFailed: 1 })).toEqual([])
  })

  test('no coupon links although listing pages were read', () => {
    expect(health({ discoveryLinks: 1 })).toEqual([])
    expect(health({ discoveryLinks: 0 })).toEqual(['noLinks'])
  })

  test('basis other over 5% of discovered items', () => {
    expect(health({ discoveryBasisOther: 10 })).toEqual([])
    expect(health({ discoveryBasisOther: 11 })).toEqual(['basisOther'])
  })

  test('the code order is fixed, so the list only grows at the end', () => {
    expect(HEALTH_CODES).toEqual(['fewCoupons', 'skipped', 'unparsed', 'fewItems', 'dropped', 'listings', 'noLinks', 'basisOther'])
  })

  test('several warnings come in a fixed order', () => {
    expect(health({ skipped: 2, discoveryBasisOther: 100, seen: 1 })).toEqual(['fewCoupons', 'skipped', 'basisOther'])
  })

  test('negative and non-numeric counts count as zero', () => {
    expect(cycleHealth({ ...HEALTHY, skipped: -3, unparsed: Number.NaN })).toEqual([])
  })
})

describe('health mask', () => {
  test('round trips every code', () => {
    expect(healthCodes(healthMask(HEALTH_CODES))).toEqual(HEALTH_CODES)
    expect(healthCodes(healthMask(['skipped', 'noLinks']))).toEqual(['skipped', 'noLinks'])
  })

  test('nothing for zero, missing or invalid masks', () => {
    expect(healthMask([])).toBe(0)
    for (const mask of [0, undefined, -1, 1.5, Number.NaN]) expect(healthCodes(mask)).toEqual([])
  })
})

describe('health text', () => {
  test('the line joins the warning texts', () => {
    expect(healthLine(['skipped', 'noLinks']))
      .toBe(`${HEALTH_PREFIX}: ${HEALTH_TEXT.skipped}; ${HEALTH_TEXT.noLinks}`)
    expect(healthLine([])).toBeNull()
  })

  test('the banner reads the stored mask', () => {
    expect(healthBannerText({ health: healthMask(['skipped']) })).toContain(HEALTH_TEXT.skipped)
    expect(healthBannerText({ health: 0 })).toBeNull()
    expect(healthBannerText({})).toBeNull()
    expect(healthBannerText(null)).toBeNull()
  })
})

describe('shouldNotifyHealth', () => {
  const startedAt = new Date('2026-11-03T12:00:00Z')
  const input = { mask: 1, previousMask: 1, lastNotifiedAt: new Date(startedAt.getTime() - 1000), startedAt, cycleEveryHours: 3 }
  const reminderAt = DAY_MS - reminderToleranceMs(3)

  test('never without warnings', () => {
    expect(shouldNotifyHealth({ ...input, mask: 0, previousMask: 1, lastNotifiedAt: null })).toBe(false)
  })

  test('when a new warning appears', () => {
    expect(shouldNotifyHealth({ ...input, mask: 3 })).toBe(true)
    expect(shouldNotifyHealth({ ...input, previousMask: 0 })).toBe(true)
    expect(shouldNotifyHealth({ ...input, mask: 2, previousMask: 1 })).toBe(true)
  })

  test('an improvement does not notify', () => {
    expect(shouldNotifyHealth({ ...input, mask: 1, previousMask: 3 })).toBe(false)
  })

  test('not while the same set was notified less than a day ago', () => {
    expect(shouldNotifyHealth(input)).toBe(false)
    expect(shouldNotifyHealth({ ...input, lastNotifiedAt: new Date(startedAt.getTime() - reminderAt + 1) })).toBe(false)
  })

  test('the daily reminder is due half a cycle early, so it lands on the cycle closest to 24 hours', () => {
    expect(shouldNotifyHealth({ ...input, lastNotifiedAt: new Date(startedAt.getTime() - reminderAt) })).toBe(true)
    expect(shouldNotifyHealth({ ...input, lastNotifiedAt: new Date(startedAt.getTime() - DAY_MS) })).toBe(true)
  })

  test('the tolerance is half the cycle interval', () => {
    expect(reminderToleranceMs(3)).toBe(90 * 60 * 1000)
    expect(reminderToleranceMs(1)).toBe(30 * 60 * 1000)
    const sixHourly = { ...input, cycleEveryHours: 6, lastNotifiedAt: new Date(startedAt.getTime() - DAY_MS + 3 * 3600 * 1000) }
    expect(shouldNotifyHealth(sixHourly)).toBe(true)
    expect(shouldNotifyHealth({ ...sixHourly, lastNotifiedAt: new Date(sixHourly.lastNotifiedAt.getTime() + 1) })).toBe(false)
  })

  test('a warning that was never notified is notified', () => {
    expect(shouldNotifyHealth({ ...input, lastNotifiedAt: null })).toBe(true)
  })
})
