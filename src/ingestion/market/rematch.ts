import { checkItemsByIds, keyItems, targetItemIds } from '@/db/match-targets'
import { saveChecks, type PriceCheckRow } from '@/db/price-checks'
import { chunks } from '@/lib/batch'
import { HOUR_MS, MARKET_REMATCH_HOURS, SECOND_MS } from '@/lib/constants'
import { uniqueByKey, type CheckItem } from '@/lib/price-check-rules'
import { errorText } from '../errors'
import { localMatchRow, outcomeOf } from './match-local'

const LOG_TAG = '[market]'
export const REMATCH_BATCH = 500
export const REMATCH_BOOT_DELAY_MS = 30 * SECOND_MS

export interface RematchSummary { checked: number; matched: number }

interface RematchLoop {
  running: boolean
  pending: boolean
  bootTimer?: NodeJS.Timeout
  timer?: NodeJS.Timeout
}

declare global {
  var __promoRematch: RematchLoop | undefined
}

function emptySummary(): RematchSummary {
  return { checked: 0, matched: 0 }
}

function addInto(total: RematchSummary, part: RematchSummary): void {
  total.checked += part.checked
  total.matched += part.matched
}

export function rematchLine({ checked, matched }: RematchSummary): string {
  return `${LOG_TAG} rematch: ${checked} verificados, ${matched} com equivalente`
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function rematchItems(items: readonly CheckItem[], now: Date): Promise<RematchSummary> {
  const rows: PriceCheckRow[] = []
  for (const item of uniqueByKey([items], Infinity)) rows.push(await localMatchRow(item, now))
  await saveChecks(rows)
  return { checked: rows.length, matched: rows.filter((row) => outcomeOf(row) === 'matched').length }
}

export async function rematchKeys(keys: readonly string[], now: Date): Promise<RematchSummary> {
  if (keys.length === 0) return emptySummary()
  return rematchItems(await keyItems(keys, now), now)
}

export async function rematchTargets(now: Date): Promise<RematchSummary> {
  const summary = emptySummary()
  for (const batch of chunks(await targetItemIds(now), REMATCH_BATCH)) {
    try {
      addInto(summary, await rematchItems(await checkItemsByIds(batch, now), now))
    } catch (e) {
      console.error(LOG_TAG, 'rematch batch failed:', errorText(e))
    }
    await yieldToEventLoop()
  }
  return summary
}

function loop(): RematchLoop {
  globalThis.__promoRematch ??= { running: false, pending: false }
  return globalThis.__promoRematch
}

async function runPasses(state: RematchLoop): Promise<void> {
  state.running = true
  try {
    do {
      state.pending = false
      try {
        console.log(rematchLine(await rematchTargets(new Date())))
      } catch (e) {
        console.error(LOG_TAG, 'rematch failed:', errorText(e))
      }
    } while (state.pending)
  } finally {
    state.running = false
  }
}

export function requestRematch(): void {
  const state = loop()
  if (state.running) {
    state.pending = true
    return
  }
  void runPasses(state)
}

export function startRematchLoop(): void {
  const state = loop()
  clearTimeout(state.bootTimer)
  clearInterval(state.timer)
  state.bootTimer = setTimeout(requestRematch, REMATCH_BOOT_DELAY_MS)
  state.bootTimer.unref()
  state.timer = setInterval(requestRematch, MARKET_REMATCH_HOURS * HOUR_MS)
  state.timer.unref()
}
