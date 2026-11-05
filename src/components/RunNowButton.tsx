'use client'

import { requestRun } from '@/lib/api'
import { ACTIVITY_VIEW } from '@/lib/activity-view'
import type { CycleActivity } from '@/lib/domain'
import { ErrorNote } from './ErrorNote'
import { RunButton } from './RunButton'
import { StatusBadge } from './StatusBadge'
import { useActivityJob } from './useActivityJob'

export function RunNowButton({ initial }: { initial: CycleActivity }) {
  const { status, busy, error, start } = useActivityJob(initial, (next) => next.cycle, requestRun)
  const view = ACTIVITY_VIEW[status.phase]

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-atomic="true" className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <StatusBadge tone={view.badge} label={view.label} />
          {view.detail}
        </p>
        {error && <ErrorNote message={error} />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4">
        <p className="max-w-md text-[13px] text-[var(--color-ink-soft)]">
          Lê os cupons, ativa alguns e descobre as ofertas de cada um. O navegador roda oculto.
        </p>
        <RunButton busy={busy} onClick={start} />
      </div>
    </div>
  )
}
