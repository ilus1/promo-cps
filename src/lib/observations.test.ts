import { describe, expect, it } from 'vitest'
import { DAY_MS } from './constants'
import type { Basis } from './domain'
import { dropsByItem, idsByValue, planSegments, sourceLinks } from './observations'

const at = new Date('2026-11-02T12:00:00Z')
const daysAgo = (d: number) => new Date(at.getTime() - d * DAY_MS)
const priced = (id: string, priceCents: number, basis: Basis = 'coupon') => ({ id, priceCents, basis })

describe('planSegments', () => {
  const open = [
    { id: 1, itemId: 'same', priceCents: 1000, basis: 'coupon' as const },
    { id: 2, itemId: 'price', priceCents: 1000, basis: 'coupon' as const },
    { id: 3, itemId: 'basis', priceCents: 1000, basis: 'coupon' as const },
  ]
  const plan = planSegments(
    [priced('same', 1000), priced('price', 900), priced('basis', 1000, 'pix_coupon'), priced('new', 500)],
    open,
    at,
  )
  it('extends the open segment when price and basis match', () => {
    expect(plan.extend).toEqual([1])
  })
  it('opens a segment on a price change, a basis change or a first sighting', () => {
    expect(plan.open).toEqual([
      { itemId: 'price', priceCents: 900, basis: 'coupon', firstSeenAt: at, lastSeenAt: at },
      { itemId: 'basis', priceCents: 1000, basis: 'pix_coupon', firstSeenAt: at, lastSeenAt: at },
      { itemId: 'new', priceCents: 500, basis: 'coupon', firstSeenAt: at, lastSeenAt: at },
    ])
  })
})

describe('sourceLinks', () => {
  const hint = (percentOff: number) => ({
    text: `${percentOff}% OFF com Cupom`, percentOff, amountOffCents: null, priceAfterCents: null,
  })
  const cards = [
    { id: 'priced', basis: 'coupon' as const, priceCents: 10000, couponHint: null, isPad: false },
    { id: 'hinted', basis: 'none' as const, priceCents: 10000, couponHint: hint(15), isPad: false },
    { id: 'other-coupon', basis: 'none' as const, priceCents: 10000, couponHint: hint(25), isPad: false },
    { id: 'plain', basis: 'pix' as const, priceCents: 10000, couponHint: null, isPad: false },
  ]
  const c1 = { campaignId: 'c1', kind: 'percent' as const, percentOff: 15, amountOffCents: null, capCents: null }
  const c2 = { campaignId: 'c2', kind: 'fixed' as const, percentOff: null, amountOffCents: 2000, capCents: null }
  it('links coupon-priced cards to every coupon of the listing and hinted cards only to the matching one', () => {
    const links = sourceLinks(cards, { type: 'coupon', coupons: [c1, c2, c1] }, at)
    expect(links.map((l) => `${l.itemId}:${l.sourceId}`)).toEqual(['priced:c1', 'priced:c2', 'hinted:c1'])
    expect(links.every((l) => l.sourceType === 'coupon' && l.firstSeenAt === at && l.lastSeenAt === at)).toBe(true)
  })
  it('links a sponsored card by hint only', () => {
    const sponsored = [
      { id: 'ad-priced', basis: 'coupon' as const, priceCents: 10000, couponHint: null, isPad: true },
      { id: 'ad-hinted', basis: 'coupon' as const, priceCents: 10000, couponHint: hint(15), isPad: true },
    ]
    const links = sourceLinks(sponsored, { type: 'coupon', coupons: [c1, c2] }, at)
    expect(links.map((l) => `${l.itemId}:${l.sourceId}`)).toEqual(['ad-hinted:c1'])
  })
  it('links every card to the Busca', () => {
    const links = sourceLinks(cards, { type: 'search', id: 's1', url: 'https://lista.mercadolivre.com.br/x' }, at)
    expect(links.map((l) => `${l.itemId}:${l.sourceType}:${l.sourceId}`))
      .toEqual(['priced:search:s1', 'hinted:search:s1', 'other-coupon:search:s1', 'plain:search:s1'])
  })
})

describe('dropsByItem', () => {
  const seg = (id: number, itemId: string, priceCents: number, from: number, to: number) => ({
    id, itemId, priceCents, basis: 'coupon' as const, firstSeenAt: daysAgo(from), lastSeenAt: daysAgo(to),
  })
  it('computes each item from all of its own segments', () => {
    const drops = dropsByItem(
      ['drop', 'flat', 'young', 'missing'],
      [seg(1, 'drop', 1000, 20, 2), seg(2, 'drop', 900, 2, 0), seg(3, 'flat', 1000, 20, 0), seg(4, 'young', 1000, 2, 0)],
      at,
    )
    expect(drops.get('drop')).toBeCloseTo(0.1, 5)
    expect(drops.get('flat')).toBe(0)
    expect(drops.get('young')).toBeNull()
    expect(drops.get('missing')).toBeNull()
  })
})

describe('idsByValue', () => {
  it('groups ids that share a value, null included', () => {
    const grouped = idsByValue(new Map<string, number | null>([['a', 0], ['b', null], ['c', 0], ['d', 0.2]]))
    expect([...grouped]).toEqual([[0, ['a', 'c']], [null, ['b']], [0.2, ['d']]])
  })
})
