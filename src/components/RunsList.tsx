import type { Run } from '@/db/schema'
import { formatCount, formatDateTime, formatDuration } from '@/lib/format'
import type { RunKind } from '@/lib/domain'
import { RUN_KIND_LABEL } from '@/lib/labels'
import { liveRunIds, runCountItems, runDurationMs, runShowsPages, runStatusText, runTone } from '@/lib/run-view'
import { StatusBadge } from './StatusBadge'

const NO_RUNS_TEXT = 'Nenhuma execução registrada ainda.'
const NO_DURATION = 'sem duração'

export function RunsList({ runs, active }: { runs: Run[]; active: ReadonlySet<RunKind> }) {
  if (runs.length === 0) return <p className="text-sm text-[var(--color-ink-soft)]">{NO_RUNS_TEXT}</p>
  const live = liveRunIds(runs, active)
  return (
    <ul className="flex flex-col divide-y divide-[var(--color-line)]">
      {runs.map((run) => {
        const duration = runDurationMs(run)
        const counts = runCountItems(run)
        return (
          <li key={run.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-semibold">{RUN_KIND_LABEL[run.kind]}</span>
              <StatusBadge tone={runTone(run, live.has(run.id))} label={runStatusText(run, live.has(run.id))} />
              <time dateTime={run.startedAt.toISOString()} className="text-[13px] text-[var(--color-ink-soft)]">
                {formatDateTime(run.startedAt)}
              </time>
            </div>
            <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-[var(--color-ink-soft)]">
              <div className="flex gap-1">
                <dt>duração</dt>
                <dd className="font-medium text-[var(--color-ink)]">{duration === null ? NO_DURATION : formatDuration(duration)}</dd>
              </div>
              {runShowsPages(run) && (
                <div className="flex gap-1">
                  <dt>páginas</dt>
                  <dd className="font-medium text-[var(--color-ink)]">{formatCount(run.pages)}</dd>
                </div>
              )}
              {counts.map(({ label, value }) => (
                <div key={label} className="flex gap-1">
                  <dt>{label}</dt>
                  <dd className="font-medium text-[var(--color-ink)]">{value}</dd>
                </div>
              ))}
            </dl>
            {run.error && <p className="break-words text-[13px] text-[var(--color-danger)]">{run.error}</p>}
          </li>
        )
      })}
    </ul>
  )
}
