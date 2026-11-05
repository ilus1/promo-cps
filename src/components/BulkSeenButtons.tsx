'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { requestBulkSeen } from '@/lib/api'
import type { BulkSeenRequest } from '@/lib/bulk-seen'
import { bulkSeenLabels, markedText } from '@/lib/bulk-seen-view'
import { ErrorNote } from './ErrorNote'

interface Props { ids: string[]; query: string; total: number; filtered: boolean; asOf: string }

export function BulkSeenButtons({ ids, query, total, filtered, asOf }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ marked: number; query: string } | null>(null)
  const filteredRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const cancelled = useRef(false)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const router = useRouter()
  const labels = bulkSeenLabels(ids.length, total, filtered)
  const shown = result?.query === query ? result.marked : null

  useEffect(() => {
    if (confirming) cancelRef.current?.focus()
    else if (cancelled.current) filteredRef.current?.focus()
    cancelled.current = false
  }, [confirming])

  useEffect(() => {
    if (result) statusRef.current?.focus()
  }, [result])

  async function mark(target: BulkSeenRequest) {
    setPending(true)
    setError(null)
    try {
      const marked = await requestBulkSeen(target)
      setConfirming(false)
      setResult({ marked, query })
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  function cancel() {
    cancelled.current = true
    setConfirming(false)
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={() => void mark({ ids, asOf })} className="btn-chip">
            {labels.page}
          </button>
          {labels.filtered && (
            <button ref={filteredRef} type="button" disabled={pending || confirming} onClick={() => setConfirming(true)} className="btn-chip">
              {labels.filtered}
            </button>
          )}
        </div>
      )}
      {confirming && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-amber-soft)] px-3 py-2 text-[13px] font-medium text-[var(--color-amber)]">
          <span>{labels.confirm}</span>
          <button type="button" disabled={pending} onClick={() => void mark({ query, asOf })} className="btn-chip">
            {labels.confirmAction}
          </button>
          <button ref={cancelRef} type="button" disabled={pending} onClick={cancel} className="btn-chip">
            {labels.cancelAction}
          </button>
        </div>
      )}
      <p ref={statusRef} tabIndex={-1} role="status" className="text-[13px] text-[var(--color-ink-soft)] outline-none empty:hidden">
        {shown !== null && markedText(shown)}
      </p>
      {error && <ErrorNote message={error} />}
    </div>
  )
}
