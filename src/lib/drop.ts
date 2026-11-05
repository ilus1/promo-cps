import { DAY_MS, HISTORY_DAYS, HISTORY_MIN_DAYS, MIN_DROP_RATIO } from './constants'
import type { Basis } from './domain'

export interface Segment { priceCents: number; basis: Basis; firstSeenAt: Date; lastSeenAt: Date }
export type SegmentRow = Segment & { id: number }

export function dropRatio(current: Segment, earlier: Segment[], now: Date): number | null {
  const windowStart = now.getTime() - HISTORY_DAYS * DAY_MS
  let firstSeen = current.firstSeenAt.getTime()
  let minPrev = Infinity
  for (const s of earlier) {
    if (s.lastSeenAt.getTime() < windowStart) continue
    firstSeen = Math.min(firstSeen, s.firstSeenAt.getTime())
    minPrev = Math.min(minPrev, s.priceCents)
  }
  if (now.getTime() - firstSeen < HISTORY_MIN_DAYS * DAY_MS) return null
  if (minPrev === Infinity) return 0
  const ratio = (minPrev - current.priceCents) / minPrev
  return ratio >= MIN_DROP_RATIO ? ratio : 0
}

export function splitOpenSegment<T extends SegmentRow>(rows: T[]): { current: T; earlier: T[] } | null {
  if (rows.length === 0) return null
  let current = rows[0]
  for (const row of rows) {
    const later = row.firstSeenAt.getTime() - current.firstSeenAt.getTime()
    if (later > 0 || (later === 0 && row.id > current.id)) current = row
  }
  return { current, earlier: rows.filter((row) => row !== current) }
}

const isComparable = (s: Segment) => s.basis !== 'other'

export function dropForSegments(rows: SegmentRow[], now: Date): number | null {
  const split = splitOpenSegment(rows)
  if (!split) return null
  if (!isComparable(split.current)) return 0
  return dropRatio(split.current, split.earlier.filter(isComparable), now)
}
