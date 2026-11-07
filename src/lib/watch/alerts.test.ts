import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS, WATCH_LOW_WINDOW_DAYS } from '../constants'
import { decideAlerts, type AlertSettings } from './alerts'
import type { BestOffer, PricePoint, SentWatchAlert, WatchAlertKind, WatchListingView } from './types'

const NOW = new Date('2026-11-06T12:00:00Z')
const WINDOW_START = NOW.getTime() - WATCH_LOW_WINDOW_DAYS * DAY_MS
const NO_TARGET: AlertSettings = { targetPriceCents: null, dropPercent: 10 }

const ago = (ms: number) => new Date(NOW.getTime() - ms)
const point = (finalCents: number, at: Date): PricePoint => ({ finalCents, at })
const sent = (kind: WatchAlertKind, priceCents: number): SentWatchAlert => ({ kind, priceCents, sentAt: ago(DAY_MS) })

function best(finalCents: number): BestOffer {
  return { listingId: 'listing-1', retailer: 'kabum', merchant: null, finalCents, url: 'https://www.kabum.com.br/produto/1' }
}

function kindsOf(settings: AlertSettings, finalCents: number, history: PricePoint[], alerts: SentWatchAlert[] = []): WatchAlertKind[] {
  return decideAlerts(settings, best(finalCents), history, alerts, NOW).map((decision) => decision.kind)
}

describe('decideAlerts', () => {
  it('decides nothing without a best offer', () => {
    expect(decideAlerts({ targetPriceCents: 99_999, dropPercent: 10 }, null, [point(10_000, ago(2 * DAY_MS))], [], NOW)).toEqual([])
  })

  it('returns each decision with the best offer and the previous best', () => {
    const history = [point(10_000, ago(5 * DAY_MS))]
    expect(decideAlerts({ targetPriceCents: 9_000, dropPercent: 10 }, best(8_000), history, [], NOW)).toEqual([
      { kind: 'target', best: best(8_000), previousBestCents: 10_000 },
      { kind: 'low_30d', best: best(8_000), previousBestCents: 10_000 },
      { kind: 'drop', best: best(8_000), previousBestCents: 10_000 },
    ])
  })
})

describe('decideAlerts target', () => {
  const settings: AlertSettings = { targetPriceCents: 9_000, dropPercent: 10 }

  it('fires at or below the target', () => {
    expect(kindsOf(settings, 9_000, [])).toEqual(['target'])
    expect(kindsOf(settings, 8_999, [])).toEqual(['target'])
  })

  it('does not fire above the target or without one', () => {
    expect(kindsOf(settings, 9_001, [])).toEqual([])
    expect(kindsOf(NO_TARGET, 1, [])).toEqual([])
  })
})

describe('decideAlerts low_30d', () => {
  it('fires strictly below every point of the window', () => {
    const history = [point(10_000, ago(20 * DAY_MS)), point(9_000, ago(10 * DAY_MS)), point(9_500, ago(2 * DAY_MS))]
    expect(kindsOf(NO_TARGET, 8_999, history)).toContain('low_30d')
    expect(kindsOf(NO_TARGET, 9_000, history)).not.toContain('low_30d')
  })

  it('needs history at least one day old', () => {
    expect(kindsOf(NO_TARGET, 5_000, [point(10_000, ago(DAY_MS - 1))])).not.toContain('low_30d')
    expect(kindsOf(NO_TARGET, 5_000, [point(10_000, ago(DAY_MS))])).toContain('low_30d')
  })

  it('needs some history', () => {
    expect(kindsOf(NO_TARGET, 5_000, [])).toEqual([])
  })

  it('counts a point exactly at the window start', () => {
    const history = [point(5_000, new Date(WINDOW_START)), point(9_000, ago(10 * DAY_MS))]
    expect(kindsOf(NO_TARGET, 6_000, history)).not.toContain('low_30d')
  })

  it('counts the price in effect when the window starts', () => {
    const history = [point(5_000, new Date(WINDOW_START - 1)), point(9_000, ago(29 * DAY_MS))]
    expect(kindsOf(NO_TARGET, 6_000, history)).not.toContain('low_30d')
  })

  it('ignores a price replaced before the window starts', () => {
    const history = [point(5_000, ago(31 * DAY_MS)), point(9_000, new Date(WINDOW_START))]
    expect(kindsOf(NO_TARGET, 6_000, history)).toContain('low_30d')
    expect(kindsOf(NO_TARGET, 6_000, [point(5_000, ago(40 * DAY_MS)), point(9_000, ago(35 * DAY_MS))])).toContain('low_30d')
  })

  it('compares with an old price still in effect', () => {
    expect(kindsOf(NO_TARGET, 8_999, [point(9_000, ago(40 * DAY_MS))])).toContain('low_30d')
    expect(kindsOf(NO_TARGET, 9_000, [point(9_000, ago(40 * DAY_MS))])).not.toContain('low_30d')
  })

  it('accepts history in any order', () => {
    const history = [point(9_500, ago(2 * DAY_MS)), point(7_000, ago(20 * DAY_MS)), point(9_000, ago(10 * DAY_MS))]
    expect(kindsOf(NO_TARGET, 8_000, history)).not.toContain('low_30d')
  })
})

describe('decideAlerts drop', () => {
  const history = [point(12_000, ago(5 * DAY_MS)), point(9_000, ago(3 * HOUR_MS))]

  it('fires exactly at the drop percent below the latest previous best', () => {
    expect(kindsOf(NO_TARGET, 8_100, history)).toContain('drop')
    expect(kindsOf(NO_TARGET, 8_101, history)).not.toContain('drop')
  })

  it('reads the drop percent of the product', () => {
    expect(kindsOf({ targetPriceCents: null, dropPercent: 25 }, 6_750, history)).toContain('drop')
    expect(kindsOf({ targetPriceCents: null, dropPercent: 25 }, 6_751, history)).not.toContain('drop')
  })

  it('needs a previous best below which to drop', () => {
    expect(kindsOf(NO_TARGET, 1_000, [])).not.toContain('drop')
    expect(kindsOf(NO_TARGET, 9_500, history)).not.toContain('drop')
    expect(kindsOf({ targetPriceCents: null, dropPercent: 0 }, 9_000, history)).not.toContain('drop')
  })
})

describe('decideAlerts with points recorded now', () => {
  it('ignores points at or after now', () => {
    const history = [point(10_000, ago(DAY_MS)), point(9_000, NOW), point(1_000, new Date(NOW.getTime() + HOUR_MS))]
    expect(decideAlerts(NO_TARGET, best(9_000), history, [], NOW)).toEqual([
      { kind: 'low_30d', best: best(9_000), previousBestCents: 10_000 },
      { kind: 'drop', best: best(9_000), previousBestCents: 10_000 },
    ])
  })

  it('treats a product whose only point is now as new', () => {
    expect(kindsOf(NO_TARGET, 9_000, [point(9_000, NOW)])).toEqual([])
  })
})

describe('decideAlerts repeat suppression', () => {
  const settings: AlertSettings = { targetPriceCents: 10_000, dropPercent: 10 }
  const history = [point(12_000, ago(5 * DAY_MS))]

  it('does not repeat a kind at or above a price already sent', () => {
    expect(kindsOf(settings, 9_000, history, [sent('target', 9_000)])).toEqual(['low_30d', 'drop'])
    expect(kindsOf(settings, 9_500, history, [sent('target', 9_000)])).toEqual(['low_30d', 'drop'])
  })

  it('repeats a kind below the price already sent', () => {
    expect(kindsOf(settings, 8_999, history, [sent('target', 9_000)])).toEqual(['target', 'low_30d', 'drop'])
  })

  it('suppresses each kind on its own', () => {
    const alerts = [sent('low_30d', 9_000), sent('drop', 9_500), sent('target', 5_000)]
    expect(kindsOf(settings, 9_000, history, alerts)).toEqual(['drop'])
  })
})

describe('decideAlerts drops come only from stores already known', () => {
  const minutes = (count: number) => count * 60_000
  const hours = (count: number) => count * HOUR_MS
  const listing = (id: string, retailer: WatchListingView['retailer'], finalCents: number | null, over: Partial<WatchListingView> = {}): WatchListingView => ({
    id, retailer, merchant: null, title: 't', url: `https://${retailer}.example/${id}`, match: 'auto', priceCents: finalCents, listPriceCents: null,
    finalCents, inStock: finalCents !== null, checkedAt: NOW, lastError: null, ...over,
  })
  const offerOf = (view: WatchListingView): BestOffer => ({
    listingId: view.id, retailer: view.retailer, merchant: view.merchant, finalCents: view.finalCents ?? 0, url: view.url,
  })
  const cheapestOf = (listings: WatchListingView[]) => listings
    .filter((view) => view.inStock && view.finalCents !== null)
    .reduce((top, view) => ((view.finalCents ?? 0) < (top.finalCents ?? 0) ? view : top))
  const decide = (settings: AlertSettings, listings: WatchListingView[], known: string[], history: PricePoint[], alerts: SentWatchAlert[] = []) => (
    decideAlerts(settings, offerOf(cheapestOf(listings)), history, alerts, NOW, { listings, knownIds: new Set(known) })
  )
  const kinds = (...args: Parameters<typeof decide>) => decide(...args).map((decision) => decision.kind)

  const americanas = listing('americanas', 'americanas', 33_900)
  const buscape = listing('buscape', 'buscape', 20_713, { merchant: 'Want Import' })
  const amazon = listing('amazon', 'amazon', 18_922)

  const staggered = (settings: AlertSettings) => {
    const fired: [number, WatchAlertKind][] = []
    const alerts: SentWatchAlert[] = []
    const steps: [WatchListingView[], string[], PricePoint[]][] = [
      [[americanas], [], []],
      [[americanas, buscape], ['americanas'], [point(33_900, ago(minutes(10)))]],
      [[americanas, buscape, amazon], ['americanas', 'buscape'], [point(33_900, ago(minutes(10))), point(20_713, ago(minutes(6)))]],
    ]
    for (const [listings, known, history] of steps) {
      for (const decision of decide(settings, listings, known, history, alerts)) {
        fired.push([decision.best.finalCents, decision.kind])
        alerts.push({ kind: decision.kind, priceCents: decision.best.finalCents, sentAt: NOW })
      }
    }
    return fired
  }

  it('a staggered first resolve (Americanas, then Buscapé, then Amazon, each cheaper) fires no drop and no 30-day low', () => {
    expect(staggered(NO_TARGET)).toEqual([])
  })

  it('the same with a target of R$ 200 fires the target once, at R$ 189,22', () => {
    expect(staggered({ targetPriceCents: 20_000, dropPercent: 10 })).toEqual([[18_922, 'target']])
  })

  it('an ML listing adopted 5 h after the add, cheaper than the rest, fires no drop', () => {
    const history = [point(33_900, ago(hours(5))), point(20_713, ago(hours(5) - minutes(2))), point(18_922, ago(hours(5) - minutes(4)))]
    expect(kinds(NO_TARGET, [americanas, buscape, amazon, listing('ml', 'ml', 15_000)], ['americanas', 'buscape', 'amazon'], history)).toEqual([])
  })

  it('a known listing whose price falls 15% fires the drop', () => {
    expect(kinds(NO_TARGET, [listing('kabum', 'kabum', 85_000)], ['kabum'], [point(100_000, ago(hours(5)))])).toEqual(['drop'])
  })

  it('a listing back in stock 15% cheaper is known, so it fires the drop', () => {
    const history = [point(100_000, ago(hours(30))), point(120_000, ago(hours(4)))]
    expect(kinds(NO_TARGET, [listing('kabum', 'kabum', 102_000)], ['kabum'], history)).toEqual(['drop'])
  })

  it('after a day of history, a newly found store at a new 30-day low fires low_30d but no drop', () => {
    const listings = [listing('kabum', 'kabum', 100_000), listing('amazon', 'amazon', 85_000)]
    expect(kinds(NO_TARGET, listings, ['kabum'], [point(100_000, ago(2 * DAY_MS))])).toEqual(['low_30d'])
  })

  it('a listing that was never the cheapest still fires the drop when it falls 20% below the previous best', () => {
    const listings = [listing('cheap', 'kabum', 100_000), listing('pricey', 'amazon', 80_000)]
    expect(kinds(NO_TARGET, listings, ['cheap', 'pricey'], [point(100_000, ago(hours(5)))])).toEqual(['drop'])
  })

  it('a listing never in stock before, quoted in stock for the first time, is a discovery', () => {
    const listings = [listing('known', 'kabum', 100_000), listing('fresh', 'amazon', 70_000)]
    expect(kinds(NO_TARGET, listings, ['known'], [point(100_000, ago(hours(5)))])).toEqual([])
  })

  it('an ML listing re-adopted under a new ref after a removal is a discovery', () => {
    const listings = [listing('kabum', 'kabum', 100_000), listing('ml-new-ref', 'ml', 60_000)]
    expect(kinds(NO_TARGET, listings, ['kabum'], [point(100_000, ago(hours(5))), point(90_000, ago(hours(2)))])).toEqual([])
  })

  it('the drop names the known store that dropped, even when a newly found store is cheaper', () => {
    const listings = [listing('known', 'kabum', 85_000), listing('fresh', 'amazon', 70_000)]
    const [drop] = decide(NO_TARGET, listings, ['known'], [point(100_000, ago(hours(5)))])
    expect(drop).toMatchObject({ kind: 'drop', best: { listingId: 'known', retailer: 'kabum', finalCents: 85_000 }, previousBestCents: 100_000 })
  })

  it('a known listing that fails its check or is out of stock is no drop', () => {
    const history = [point(100_000, ago(hours(5)))]
    expect(kinds(NO_TARGET, [listing('a', 'kabum', 100_000), listing('k', 'amazon', 80_000, { lastError: 'HTTP 503' })], ['a', 'k'], history)).toEqual([])
    expect(kinds(NO_TARGET, [listing('a', 'kabum', 100_000), listing('k', 'amazon', 80_000, { inStock: false })], ['a', 'k'], history)).toEqual([])
  })

  it('the first price of a product, with nothing known yet, fires only the target', () => {
    expect(kinds({ targetPriceCents: 90_000, dropPercent: 10 }, [listing('a', 'kabum', 85_000)], [], [])).toEqual(['target'])
  })
})
