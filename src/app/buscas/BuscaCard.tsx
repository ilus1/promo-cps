'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { ErrorNote } from '@/components/ErrorNote'
import { RunButton } from '@/components/RunButton'
import { StatusBadge } from '@/components/StatusBadge'
import { useActivityJob } from '@/components/useActivityJob'
import type { Search } from '@/db/schema'
import { ACTIVITY_VIEW } from '@/lib/activity-view'
import { buscaErrorText, BuscaGoneError, deleteBusca, requestBuscaRun, updateBusca } from '@/lib/api'
import type { LastRunView } from '@/lib/busca-view'
import { RUN_EVERY_HOURS_OPTIONS } from '@/lib/constants'
import { offersByBuscaHref } from '@/lib/deal-query'
import type { CycleActivity } from '@/lib/domain'
import { BUSCA_KIND_LABEL, DELETE_LABEL, BUSCA_NEVER_RUN_TEXT, OPENS_IN_NEW_TAB_TEXT } from '@/lib/labels'

const IDLE: CycleActivity = { phase: 'idle' }

export function BuscaCard({
  search, activity, lastRun, onGone,
}: {
  search: Search
  activity: CycleActivity
  lastRun: LastRunView | null
  onGone: () => void
}) {
  const router = useRouter()
  const ids = useId()
  const nameId = `${ids}-name`
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  function gone() {
    onGone()
    router.refresh()
  }

  async function run(): Promise<CycleActivity> {
    try {
      return await requestBuscaRun(search.id)
    } catch (e) {
      if (!(e instanceof BuscaGoneError)) throw new Error(buscaErrorText(e))
      gone()
      return IDLE
    }
  }

  const job = useActivityJob(activity, (next) => next.buscas[search.id] ?? IDLE, run)
  const view = job.status.phase === 'idle' ? null : ACTIVITY_VIEW[job.status.phase]
  const error = actionError ?? job.error

  async function mutate(action: () => Promise<void>) {
    setPending(true)
    setActionError(null)
    try {
      await action()
      router.refresh()
    } catch (e) {
      if (e instanceof BuscaGoneError) gone()
      else setActionError(buscaErrorText(e))
    } finally {
      setPending(false)
    }
  }

  function remove() {
    if (!confirm(`${DELETE_LABEL} "${search.name}"?`)) return
    void mutate(() => deleteBusca(search.id))
  }

  return (
    <article className="card p-4 sm:p-5" aria-labelledby={nameId}>
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={nameId} className="min-w-0 break-words text-base font-semibold tracking-tight">{search.name}</h3>
            <span className="badge badge-muted">{BUSCA_KIND_LABEL[search.kind]}</span>
            {!search.enabled && <span className="badge badge-muted">Pausada</span>}
          </div>
          <p className="mt-1.5">
            <a
              href={search.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 break-all font-mono text-[12px] text-[var(--color-ink-soft)] underline-offset-2 hover:text-[var(--color-brand-strong)] hover:underline"
            >
              {search.url}
              <span className="sr-only"> {OPENS_IN_NEW_TAB_TEXT}</span>
            </a>
          </p>
          <div role="status" aria-atomic="true" className="mt-2 flex flex-col gap-1.5">
            {view && (
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-ink-soft)]">
                <StatusBadge tone={view.badge} label={view.label} />
                {view.detail}
              </p>
            )}
            {lastRun ? (
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-ink-soft)]">
                <StatusBadge tone={lastRun.tone} label={lastRun.label} />
                {lastRun.text}
              </p>
            ) : (
              !view && <p className="text-[13px] text-[var(--color-ink-soft)]">{BUSCA_NEVER_RUN_TEXT}</p>
            )}
            {search.lastError && <ErrorNote message={search.lastError} />}
            {error && <ErrorNote message={error} />}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-line)] pt-3">
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              role="switch"
              className="h-4 w-4 cursor-pointer accent-[var(--color-brand)]"
              aria-describedby={nameId}
              checked={search.enabled}
              disabled={pending}
              onChange={(e) => void mutate(() => updateBusca(search.id, { enabled: e.target.checked }))}
            />
            Ativa
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            A cada
            <select
              className="field w-auto cursor-pointer py-2 pr-7"
              aria-label={`A cada, ${search.name}`}
              value={search.runEveryHours}
              disabled={pending}
              onChange={(e) => void mutate(() => updateBusca(search.id, { runEveryHours: Number(e.target.value) }))}
            >
              {RUN_EVERY_HOURS_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>{hours} h</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Link href={offersByBuscaHref(search.id)} aria-describedby={nameId} className="btn btn-ghost">
              Ver ofertas
            </Link>
            <RunButton busy={job.busy} disabled={pending} onClick={job.start} describedBy={nameId} />
            <button type="button" onClick={remove} disabled={pending} aria-describedby={nameId} className="btn btn-danger">
              {DELETE_LABEL}
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
