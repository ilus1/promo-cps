import { expect, test } from 'vitest'
import { HOLD_RECHECK_MS } from '@/lib/constants'
import { holdAction } from './hold-rules'

const hold = { kind: 'vpn', text: 't', reason: 'VPN conectada' } as const

test('a hold waits one minute and carries the hold', () => {
  expect(holdAction(hold)).toEqual({ kind: 'wait', ms: HOLD_RECHECK_MS, hold })
  expect(HOLD_RECHECK_MS).toBe(60_000)
})

test('no hold runs at once', () => {
  expect(holdAction(null)).toEqual({ kind: 'run' })
})
