import { linksToCoupon, type LinkableCard, type ObservedCard } from '@/ingestion/ml/observed-card'
import type { CouponTerms } from './coupon-hint'
import { lastByKey } from './batch'
import type { Basis, SourceType } from './domain'
import { dropForSegments, type Segment, type SegmentRow } from './drop'

export type LinkedCoupon = CouponTerms & { campaignId: string }
export type ObservationSource =
  | { type: 'coupon'; coupons: LinkedCoupon[] }
  | { type: 'search'; id: string; url: string }
export interface OpenSegment { id: number; itemId: string; priceCents: number; basis: Basis }
export type NewSegment = Segment & { itemId: string }
export interface SegmentPlan { extend: number[]; open: NewSegment[] }
export interface SourceLink {
  itemId: string; sourceType: SourceType; sourceId: string; firstSeenAt: Date; lastSeenAt: Date
}

type PricedCard = Pick<ObservedCard, 'id' | 'priceCents' | 'basis'>

export function planSegments(cards: PricedCard[], openSegments: OpenSegment[], at: Date): SegmentPlan {
  const openByItem = new Map(openSegments.map((s) => [s.itemId, s]))
  const plan: SegmentPlan = { extend: [], open: [] }
  for (const card of cards) {
    const current = openByItem.get(card.id)
    if (current && current.priceCents === card.priceCents && current.basis === card.basis) {
      plan.extend.push(current.id)
    } else {
      plan.open.push({ itemId: card.id, priceCents: card.priceCents, basis: card.basis, firstSeenAt: at, lastSeenAt: at })
    }
  }
  return plan
}

function sourceLink(itemId: string, sourceType: SourceType, sourceId: string, at: Date): SourceLink {
  return { itemId, sourceType, sourceId, firstSeenAt: at, lastSeenAt: at }
}

export function sourceLinks(
  cards: (LinkableCard & Pick<ObservedCard, 'id'>)[], source: ObservationSource, at: Date,
): SourceLink[] {
  if (source.type === 'search') {
    return cards.map((card) => sourceLink(card.id, source.type, source.id, at))
  }
  const coupons = lastByKey(source.coupons, (c) => c.campaignId)
  return cards.flatMap((card) => coupons
    .filter((coupon) => linksToCoupon(card, coupon, card.isPad))
    .map((coupon) => sourceLink(card.id, source.type, coupon.campaignId, at)))
}

export function dropsByItem(
  itemIds: string[], segments: (SegmentRow & { itemId: string })[], now: Date,
): Map<string, number | null> {
  const byItem = new Map<string, SegmentRow[]>()
  for (const s of segments) {
    const rows = byItem.get(s.itemId)
    if (rows) rows.push(s)
    else byItem.set(s.itemId, [s])
  }
  return new Map(itemIds.map((id) => [id, dropForSegments(byItem.get(id) ?? [], now)]))
}

export function idsByValue<V>(values: Map<string, V>): Map<V, string[]> {
  const out = new Map<V, string[]>()
  for (const [id, value] of values) {
    const ids = out.get(value)
    if (ids) ids.push(id)
    else out.set(value, [id])
  }
  return out
}
