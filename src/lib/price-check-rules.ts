import type { RunKind } from './domain'

export const CHECK_KEY_ITEM_PREFIX = 'item:'

export interface CheckItem { id: string; productId: string | null; title: string; finalCents: number; showsSaving: boolean }

export function checkKey(item: Pick<CheckItem, 'id' | 'productId'>): string {
  return item.productId ?? `${CHECK_KEY_ITEM_PREFIX}${item.id}`
}

export interface CheckPlan { alerts: boolean }

const NO_CHECKS: CheckPlan = { alerts: false }

export function checkPlan(run: { kind: RunKind; status: string | null }): CheckPlan {
  const finished = run.status === 'ok' || run.status === 'partial'
  if (!finished) return NO_CHECKS
  if (run.kind === 'cycle' || run.kind === 'search') return { alerts: true }
  return NO_CHECKS
}

export function uniqueByKey(lists: readonly (readonly CheckItem[])[], cap: number): CheckItem[] {
  const seen = new Set<string>()
  const out: CheckItem[] = []
  for (const item of lists.flat()) {
    if (out.length >= cap) break
    const key = checkKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
