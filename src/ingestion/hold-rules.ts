import { HOLD_RECHECK_MS } from '@/lib/constants'
import type { RequestHold } from '@/lib/request-hold'

export type HoldAction = { kind: 'run' } | { kind: 'wait'; ms: number; hold: RequestHold }

export function holdAction(hold: RequestHold | null): HoldAction {
  return hold ? { kind: 'wait', ms: HOLD_RECHECK_MS, hold } : { kind: 'run' }
}
