import type { BadgeTone } from './badge-tone'
import { CYCLE_COUNT, type CycleCountKey } from './cycle-counts'
import { RUN_INTERRUPTED_TEXT, type RunKind, type RunRowStatus } from './domain'
import { formatCount } from './format'
import { BUSCA_COUNT_LABELS, NO_TEXT, YES_TEXT, CYCLE_COUNT_LABELS, RUN_ROW_STATUS_LABEL, RUN_RUNNING_TEXT } from './labels'

export type RunLike = {
  kind: RunKind
  status: RunRowStatus | null
  startedAt: Date
  finishedAt: Date | null
  counts: Record<string, number>
  error: string | null
}

const GOOD_STATUSES: readonly RunRowStatus[] = ['ok', 'logged_in']
const IN_BETWEEN_STATUSES: readonly RunRowStatus[] = ['partial', 'unconfirmed']
const WALL_TEXT = /captcha|\/gz\/account-verification/i

const COUNT_LABELS_BY_KIND: Record<RunKind, ReadonlyArray<readonly [CycleCountKey, string]>> = {
  cycle: [...CYCLE_COUNT_LABELS, ...BUSCA_COUNT_LABELS],
  search: BUSCA_COUNT_LABELS.filter(([key]) => key !== CYCLE_COUNT.buscaPages),
  login: [],
}

export function runStatusText(run: Pick<RunLike, 'status'>, live: boolean): string {
  if (run.status) return RUN_ROW_STATUS_LABEL[run.status]
  return live ? RUN_RUNNING_TEXT : RUN_INTERRUPTED_TEXT
}

export function runTone(run: Pick<RunLike, 'status'>, live: boolean): BadgeTone {
  if (!run.status) return live ? 'badge-saved' : 'badge-muted'
  if (GOOD_STATUSES.includes(run.status)) return 'badge-new'
  return IN_BETWEEN_STATUSES.includes(run.status) ? 'badge-saved' : 'badge-warn'
}

export function liveRunIds(
  runs: ReadonlyArray<Pick<RunLike, 'kind' | 'status'> & { id: string }>,
  active: ReadonlySet<RunKind>,
): Set<string> {
  const live = new Set<string>()
  const seen = new Set<RunKind>()
  for (const run of runs) {
    if (seen.has(run.kind)) continue
    seen.add(run.kind)
    if (run.status === null && active.has(run.kind)) live.add(run.id)
  }
  return live
}

export function runDurationMs(run: Pick<RunLike, 'startedAt' | 'finishedAt'> & { counts?: Record<string, number> }): number | null {
  if (run.counts?.[CYCLE_COUNT.orphan] === 1) return null
  return run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null
}

function countText(key: CycleCountKey, value: number): string {
  if (key === CYCLE_COUNT.fullHarvest) return value === 1 ? YES_TEXT : NO_TEXT
  return formatCount(value)
}

export function runCountItems(run: Pick<RunLike, 'kind' | 'counts'>): Array<{ label: string; value: string }> {
  const labels = COUNT_LABELS_BY_KIND[run.kind]
  return labels.flatMap(([key, label]) => {
    const value = run.counts[key]
    return typeof value === 'number' ? [{ label, value: countText(key, value) }] : []
  })
}

export function runShowsPages(run: Pick<RunLike, 'kind'>): boolean {
  return run.kind !== 'login'
}

export function suggestsVerification(run: Pick<RunLike, 'status' | 'error'> | null): boolean {
  return run?.status === 'blocked' && run.error !== null && WALL_TEXT.test(run.error)
}
