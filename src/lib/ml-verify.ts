import { BLOCKED_STATUSES } from './ml-session'
import { ML_COUPONS_URL } from './constants'
import { classifyLocation } from './ml-session'
import { isMlHost } from './ml-url'

export type VerifyPhase = 'walled' | 'cleared' | 'other'

export function verifyPhase(href: string, status: number | null = null): VerifyPhase {
  if (!URL.canParse(href)) return 'other'
  if (status !== null && BLOCKED_STATUSES.includes(status)) return 'walled'
  const outcome = classifyLocation(href)
  if (outcome === 'blocked') return 'walled'
  if (outcome === 'ok' && isMlHost(new URL(href).hostname)) return 'cleared'
  return 'other'
}

export function verifyTarget(targets: ReadonlyArray<{ listingUrl: string }>): string {
  return targets[0]?.listingUrl ?? ML_COUPONS_URL
}

export function closedOutcome(lastPhase: VerifyPhase | null): 'cleared' | 'closed' {
  return lastPhase === 'cleared' ? 'cleared' : 'closed'
}
