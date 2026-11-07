'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { requestWatchRefresh, stopWatching, WatchGoneError, watchErrorText } from '@/lib/api'
import { stoppedHref } from '@/lib/routes'
import { WATCH_REFRESH_QUEUED_TEXT } from '@/lib/watch/view'
import { ErrorNote } from './ErrorNote'
import { Spinner } from './Spinner'

const REFRESH_LABEL = 'Buscar agora'
const REFRESHING_LABEL = 'Agendando...'
const STOP_LABEL = 'Parar de monitorar'
const STOPPING_LABEL = 'Parando...'

type Action = 'refresh' | 'stop'

export function WatchActions({ id, stopConfirm, describedBy }: { id: string; stopConfirm: string; describedBy: string }) {
  const router = useRouter()
  const [pending, setPending] = useState<Action | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const [leaving, startLeaving] = useTransition()
  const busy = pending !== null || refreshing || leaving

  async function run(action: Action, request: () => Promise<void>, after: () => void) {
    if (busy) return
    setPending(action)
    setNotice(null)
    setFailure(null)
    try {
      await request()
      after()
    } catch (e) {
      setFailure(watchErrorText(e))
      if (e instanceof WatchGoneError) startRefresh(() => router.refresh())
    } finally {
      setPending(null)
    }
  }

  function refresh() {
    void run('refresh', () => requestWatchRefresh(id), () => setNotice(WATCH_REFRESH_QUEUED_TEXT))
  }

  function stop() {
    if (busy || !confirm(stopConfirm)) return
    void run('stop', () => stopWatching(id), () => startLeaving(() => router.push(stoppedHref())))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          aria-disabled={busy}
          aria-describedby={describedBy}
          className="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
        >
          {pending === 'refresh' ? (
            <>
              <Spinner /> {REFRESHING_LABEL}
            </>
          ) : (
            REFRESH_LABEL
          )}
        </button>
        <button
          type="button"
          onClick={stop}
          aria-disabled={busy}
          aria-describedby={describedBy}
          className="btn btn-danger aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
        >
          {pending === 'stop' || leaving ? STOPPING_LABEL : STOP_LABEL}
        </button>
      </div>
      <div role="status" aria-atomic="true" className="flex flex-col items-start gap-2">
        {notice && <p className="text-[13px] font-medium text-[var(--color-brand-ink)]">{notice}</p>}
        {failure && <ErrorNote message={failure} />}
      </div>
    </div>
  )
}
