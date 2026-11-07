import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))
vi.mock('@/env', () => ({ env: () => ({ PORT: 8510 }) }))

import { DAY_MS } from '@/lib/constants'
import type { AlertHistory } from '@/db/watch-alerts'
import type { BestOffer, PricePoint, SentWatchAlert, WatchListingView, WatchProductView } from '@/lib/watch/types'
import { alertNotification, checkAlerts, type AlertDeps } from './price-alerts'

const NOW = new Date('2026-11-06T12:00:00Z')
const ID = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const LISTING = '1b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f12'
const BASE = 'http://127.0.0.1:8510'
const BEST: BestOffer = { listingId: LISTING, retailer: 'kabum', merchant: null, finalCents: 80_000, url: 'https://www.kabum.com.br/produto/1' }

const NEW_LISTING = '2b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f13'

function listing(id: string, finalCents: number): WatchListingView {
  return {
    id, retailer: 'kabum', merchant: null, title: 't', url: 'https://www.kabum.com.br/produto/1', match: 'auto',
    priceCents: finalCents, listPriceCents: null, finalCents, inStock: true, checkedAt: NOW, lastError: null,
  }
}

function product(patch: Partial<WatchProductView> = {}): WatchProductView {
  return {
    id: ID, name: 'Fone JBL Tune 520BT', query: 'fone jbl tune 520bt', ean: null, eanSource: null,
    targetPriceCents: null, dropPercent: 10, best: BEST, low30dCents: null, lastCheckedAt: NOW, resolvedAt: null,
    listings: [listing(LISTING, 80_000)], ...patch,
  }
}

const historyOf = (points: PricePoint[], known: string[] = [LISTING]): AlertHistory => ({ points, knownListingIds: new Set(known) })

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? ReturnType<typeof vi.fn<T[K]>> : never }

let deps: Mocked<AlertDeps>

beforeEach(() => {
  deps = {
    product: vi.fn<AlertDeps['product']>(async () => product()),
    history: vi.fn<AlertDeps['history']>(async () => historyOf([])),
    sent: vi.fn<AlertDeps['sent']>(async (): Promise<SentWatchAlert[]> => []),
    log: vi.fn<AlertDeps['log']>(async () => true),
    notify: vi.fn<AlertDeps['notify']>(),
    baseUrl: vi.fn<AlertDeps['baseUrl']>(() => BASE),
  }
})

test('a best price at the target sends one notification and logs it', async () => {
  deps.product.mockResolvedValue(product({ targetPriceCents: 85_000 }))
  expect(await checkAlerts(ID, NOW, deps)).toBe(1)
  expect(deps.log).toHaveBeenCalledWith(ID, 'target', 80_000, LISTING, NOW)
  expect(deps.notify).toHaveBeenCalledWith({
    title: 'Preço baixou: Fone JBL Tune 520BT',
    body: 'R$ 800 na Kabum\nAtingiu o preço alvo de R$ 850',
    url: `${BASE}/produtos/${ID}`,
  })
})

test('the history covers the 30-day window and stops before this check', async () => {
  await checkAlerts(ID, NOW, deps)
  expect(deps.history).toHaveBeenCalledWith(ID, daysAgo(30), NOW)
})

test('a drop and a new low each notify, with the previous best in the text', async () => {
  deps.history.mockResolvedValue(historyOf([{ finalCents: 100_000, at: daysAgo(5) }]))
  expect(await checkAlerts(ID, NOW, deps)).toBe(2)
  const bodies = deps.notify.mock.calls.map(([notification]) => notification.body)
  expect(bodies).toEqual(['R$ 800 na Kabum\nMenor preço dos últimos 30 dias', 'R$ 800 na Kabum\nCaiu 20% (antes R$ 1.000)'])
})

test('an alert already logged is not notified again', async () => {
  deps.product.mockResolvedValue(product({ targetPriceCents: 85_000 }))
  deps.log.mockResolvedValue(false)
  expect(await checkAlerts(ID, NOW, deps)).toBe(0)
  expect(deps.notify).not.toHaveBeenCalled()
})

test('a product without a best offer, or gone, sends nothing', async () => {
  deps.product.mockResolvedValueOnce(product({ best: null, targetPriceCents: 1 })).mockResolvedValueOnce(null)
  expect(await checkAlerts(ID, NOW, deps)).toBe(0)
  expect(await checkAlerts(ID, NOW, deps)).toBe(0)
  expect(deps.history).not.toHaveBeenCalled()
})

test('the store reads with its preposition: no Mercado Livre, na Amazon', () => {
  const ml = alertNotification(product(), { kind: 'low_30d', best: { ...BEST, retailer: 'ml' }, previousBestCents: null }, BASE)
  const amazon = alertNotification(product(), { kind: 'low_30d', best: { ...BEST, retailer: 'amazon' }, previousBestCents: null }, BASE)
  expect(ml.body.split('\n')[0]).toBe('R$ 800 no Mercado Livre')
  expect(amazon.body.split('\n')[0]).toBe('R$ 800 na Amazon')
})

test('a Buscapé merchant is named in the notification', () => {
  const notification = alertNotification(
    product(), { kind: 'low_30d', best: { ...BEST, retailer: 'buscape', merchant: 'Magazine Luiza' }, previousBestCents: null }, BASE,
  )
  expect(notification.body).toBe('R$ 800 na Magazine Luiza (via Buscapé)\nMenor preço dos últimos 30 dias')
})

test('a store quoted for the first time is a discovery: it moves the best but fires no drop', async () => {
  const fresh = { ...BEST, listingId: NEW_LISTING, finalCents: 70_000 }
  deps.product.mockResolvedValue(product({ best: fresh, listings: [listing(LISTING, 100_000), listing(NEW_LISTING, 70_000)] }))
  deps.history.mockResolvedValue(historyOf([{ finalCents: 100_000, at: new Date(NOW.getTime() - 5 * 60 * 60 * 1000) }]))
  expect(await checkAlerts(ID, NOW, deps)).toBe(0)
})

test('the drop notification names the known store that dropped, not a cheaper newly found one', async () => {
  const fresh = { ...BEST, listingId: NEW_LISTING, retailer: 'amazon' as const, finalCents: 70_000 }
  deps.product.mockResolvedValue(product({ best: fresh, listings: [listing(LISTING, 85_000), { ...listing(NEW_LISTING, 70_000), retailer: 'amazon' }] }))
  deps.history.mockResolvedValue(historyOf([{ finalCents: 100_000, at: new Date(NOW.getTime() - 5 * 60 * 60 * 1000) }]))
  expect(await checkAlerts(ID, NOW, deps)).toBe(1)
  expect(deps.log).toHaveBeenCalledWith(ID, 'drop', 85_000, LISTING, NOW)
  expect(deps.notify.mock.calls[0][0].body).toBe('R$ 850 na Kabum\nCaiu 15% (antes R$ 1.000)')
})

test('a known store that falls fires the drop, measured on the known stores only', async () => {
  deps.product.mockResolvedValue(product({ best: BEST, listings: [listing(LISTING, 80_000)] }))
  deps.history.mockResolvedValue(historyOf([{ finalCents: 100_000, at: new Date(NOW.getTime() - 5 * 60 * 60 * 1000) }]))
  expect(await checkAlerts(ID, NOW, deps)).toBe(1)
  expect(deps.log).toHaveBeenCalledWith(ID, 'drop', 80_000, LISTING, NOW)
})

test('two known stores: the pricier one, never the best, falling the drop percent below the previous best fires the drop for it', async () => {
  const OTHER = '3b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f14'
  const pricier = { ...listing(OTHER, 85_000), retailer: 'amazon' as const }
  const offer = { ...BEST, listingId: OTHER, retailer: 'amazon' as const, finalCents: 85_000 }
  deps.product.mockResolvedValue(product({ best: offer, listings: [listing(LISTING, 99_000), pricier] }))
  deps.history.mockResolvedValue(historyOf([{ finalCents: 100_000, at: new Date(NOW.getTime() - 5 * 60 * 60 * 1000) }], [LISTING, OTHER]))
  expect(await checkAlerts(ID, NOW, deps)).toBe(1)
  expect(deps.log).toHaveBeenCalledWith(ID, 'drop', 85_000, OTHER, NOW)
  expect(deps.notify.mock.calls[0][0].body).toBe('R$ 850 na Amazon\nCaiu 15% (antes R$ 1.000)')
})
