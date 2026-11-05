import { DAY_MS, HISTORY_DAYS, LIST_NEVER_PRACTICED_DAYS, LIST_NEVER_PRACTICED_RATIO } from './constants'
import { splitOpenSegment, type SegmentRow } from './drop'

export interface PriceHistory {
  segments: number
  lowestCents: number | null
  highestCents: number | null
  firstReadAt: Date
  currentSince: Date
}

function byStart(a: SegmentRow, b: SegmentRow): number {
  return a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.id - b.id
}

function currentPriceSince(rows: SegmentRow[], currentPriceCents: number): Date {
  const ordered = [...rows].sort(byStart)
  let since = ordered[ordered.length - 1].firstSeenAt
  for (let i = ordered.length - 2; i >= 0 && ordered[i].priceCents === currentPriceCents; i--) since = ordered[i].firstSeenAt
  return since
}

export function priceHistory(rows: SegmentRow[], now: Date): PriceHistory | null {
  const split = splitOpenSegment(rows)
  if (!split) return null
  const windowStart = now.getTime() - HISTORY_DAYS * DAY_MS
  const inWindow = rows.filter((row) => row.lastSeenAt.getTime() >= windowStart)
  const currentSince = currentPriceSince(rows, split.current.priceCents)
  if (inWindow.length === 0) {
    return { segments: 1, lowestCents: null, highestCents: null, firstReadAt: currentSince, currentSince }
  }
  const prices = inWindow.map((row) => row.priceCents)
  return {
    segments: inWindow.length,
    lowestCents: Math.min(...prices),
    highestCents: Math.max(...prices),
    firstReadAt: new Date(Math.min(...inWindow.map((row) => row.firstSeenAt.getTime()))),
    currentSince,
  }
}

export function neverPracticedList(history: PriceHistory | null, listPriceCents: number | null, now: Date): boolean {
  if (history === null || listPriceCents === null || history.highestCents === null) return false
  if (history.firstReadAt.getTime() > now.getTime() - LIST_NEVER_PRACTICED_DAYS * DAY_MS) return false
  return history.highestCents < listPriceCents * LIST_NEVER_PRACTICED_RATIO
}
