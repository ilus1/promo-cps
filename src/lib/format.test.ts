import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS, MINUTE_MS } from './constants'
import { discountThresholdRatio, formatAgo, formatCents, formatCount, formatDate, formatDayMonth, formatDayMonthTime, formatDuration, formatPercent, formatPercentOneDecimal, formatPrice, savingThresholdRatio, formatWholeReais, relativeTime } from './format'

const now = new Date('2026-11-01T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

describe('formatPrice', () => {
  it('whole reais grouped pt-BR style, centavos with two digits', () => {
    expect(formatPrice('280000.00')).toBe('R$ 280.000')
    expect(formatPrice(89.9)).toBe('R$ 89,90')
  })
  it('a placeholder when the price is missing', () => {
    expect(formatPrice(null)).toBe('Sem preço')
    expect(formatPrice('')).toBe('Sem preço')
  })
})

describe('formatCents', () => {
  it('whole reais without decimals', () => {
    expect(formatCents(458800)).toBe('R$ 4.588')
    expect(formatCents(123456700)).toBe('R$ 1.234.567')
  })
  it('two decimals when there are centavos', () => {
    expect(formatCents(8990)).toBe('R$ 89,90')
    expect(formatCents(5)).toBe('R$ 0,05')
  })
})

describe('formatPercent', () => {
  it('rounds a ratio to a whole percent, never floors', () => {
    expect(formatPercent(0.12)).toBe('12%')
    expect(formatPercent(0.125)).toBe('13%')
    expect(formatPercent(0.019)).toBe('2%')
  })
})

describe('formatAgo', () => {
  it('agora under one minute', () => {
    expect(formatAgo(now, now)).toBe('agora')
    expect(formatAgo(ago(MINUTE_MS - 1), now)).toBe('agora')
  })
  it('whole minutes under an hour', () => {
    expect(formatAgo(ago(MINUTE_MS), now)).toBe('há 1 min')
    expect(formatAgo(ago(HOUR_MS - 1), now)).toBe('há 59 min')
  })
  it('whole hours under a day', () => {
    expect(formatAgo(ago(HOUR_MS), now)).toBe('há 1 h')
    expect(formatAgo(ago(6 * HOUR_MS - 1), now)).toBe('há 5 h')
    expect(formatAgo(ago(DAY_MS - 1), now)).toBe('há 23 h')
  })
  it('whole days from one day', () => {
    expect(formatAgo(ago(DAY_MS), now)).toBe('há 1 d')
    expect(formatAgo(ago(2 * DAY_MS + 5 * HOUR_MS), now)).toBe('há 2 d')
  })
  it('agora for a time ahead of now', () => {
    expect(formatAgo(new Date(now.getTime() + HOUR_MS), now)).toBe('agora')
  })
})

describe('formatDayMonth', () => {
  it('prints day and month in the app time zone', () => {
    expect(formatDayMonth(new Date('2026-11-02T15:00:00Z'))).toBe('02/11')
    expect(formatDayMonth(new Date('2026-11-03T02:00:00Z'))).toBe('02/11')
  })
})

describe('formatDate', () => {
  it('day first, in the Sao Paulo calendar day', () => {
    expect(formatDate(new Date('2026-11-02T15:00:00Z'))).toBe('02/11/2026')
    expect(formatDate(new Date('2026-11-02T02:00:00Z'))).toBe('01/11/2026')
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0 s'],
    [-5000, '0 s'],
    [499, '0 s'],
    [45_000, '45 s'],
    [59_600, '1 min 0 s'],
    [200_000, '3 min 20 s'],
    [HOUR_MS, '1 h 0 min'],
    [HOUR_MS + 5 * MINUTE_MS + 30_000, '1 h 5 min'],
  ])('%d ms is %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('formatCount', () => {
  it('groups thousands pt-BR style', () => {
    expect(formatCount(1931)).toBe('1.931')
    expect(formatCount(0)).toBe('0')
  })
})

describe('relativeTime', () => {
  const ahead = (ms: number) => new Date(now.getTime() + ms)
  it('em instantes under one minute, now or already past', () => {
    expect(relativeTime(now, now)).toBe('em instantes')
    expect(relativeTime(ahead(MINUTE_MS - 1), now)).toBe('em instantes')
    expect(relativeTime(ago(HOUR_MS), now)).toBe('em instantes')
  })
  it('whole minutes, hours and days ahead', () => {
    expect(relativeTime(ahead(MINUTE_MS), now)).toBe('em 1 min')
    expect(relativeTime(ahead(HOUR_MS - 1), now)).toBe('em 59 min')
    expect(relativeTime(ahead(2 * HOUR_MS + 5), now)).toBe('em 2 h')
    expect(relativeTime(ahead(DAY_MS), now)).toBe('em 1 d')
  })
})

describe('discountThresholdRatio', () => {
  it.each([10 / 11, 59 / 200, 1 / 8, 0.8, 0.01, 1])('the shown whole percent of %s passes its own threshold and not the next', (ratio) => {
    const shown = Number.parseInt(formatPercent(ratio), 10)
    expect(ratio).toBeGreaterThanOrEqual(discountThresholdRatio(shown))
    expect(ratio).toBeLessThan(discountThresholdRatio(shown + 1))
  })

  it('half a percent below the value is the threshold', () => {
    expect(discountThresholdRatio(91)).toBe(0.905)
  })
})

describe('formatPercentOneDecimal', () => {
  it('shows one decimal with the pt-BR comma', () => {
    expect(formatPercentOneDecimal(0.5753)).toBe('57,5%')
    expect(formatPercentOneDecimal(0.5696)).toBe('57,0%')
    expect(formatPercentOneDecimal(0.5)).toBe('50,0%')
    expect(formatPercentOneDecimal(1)).toBe('100,0%')
    expect(formatPercentOneDecimal(0)).toBe('0,0%')
  })
})

describe('savingThresholdRatio', () => {
  it('a whole N passes from N minus a twentieth of a percent', () => {
    expect(savingThresholdRatio(57)).toBeCloseTo(0.5695, 10)
    expect(savingThresholdRatio(100)).toBeCloseTo(0.9995, 10)
  })

  it.each([0.0295, 0.4295, 0.4995, 0.5695, 0.5696, 0.57, 0.5749, 0.8, 0.0501, 1])('a ratio shown as N,0% or more passes the filter N, and %s agrees with what is shown', (ratio) => {
    const shownWhole = Math.floor(Number(formatPercentOneDecimal(ratio).replace('%', '').replace(',', '.')))
    expect(ratio).toBeGreaterThanOrEqual(savingThresholdRatio(shownWhole))
    expect(ratio).toBeLessThan(savingThresholdRatio(shownWhole + 1))
  })

  it('a ratio shown below N,0% fails the filter N', () => {
    expect(formatPercentOneDecimal(0.5694)).toBe('56,9%')
    expect(0.5694).toBeLessThan(savingThresholdRatio(57))
  })
})

describe('savingThresholdRatio at exact boundaries', () => {
  it.each([[0.0295, 3], [0.4295, 43], [0.4995, 50]])('%s shows %i,0%% and passes the filter %i', (ratio, whole) => {
    expect(formatPercentOneDecimal(ratio)).toBe(`${whole},0%`)
    expect(ratio).toBeGreaterThanOrEqual(savingThresholdRatio(whole))
  })
})

describe('formatWholeReais', () => {
  it('groups thousands', () => {
    expect(formatWholeReais(1500)).toBe('R$ 1.500')
  })
})

it('formatDayMonthTime is dd/mm hh:mm in the app time zone', () => {
  expect(formatDayMonthTime(new Date('2026-11-04T15:30:00Z'))).toBe('04/11 12:30')
})
