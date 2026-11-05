'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { priorityErrorText, requestPriority } from '@/lib/api'
import { PRIORITY_BUSY_LABEL, PRIORITY_BUTTON_LABEL, priorityMessage } from '@/lib/priority-view'
import { ErrorNote } from './ErrorNote'
import { Spinner } from './Spinner'

export function PrioritizeButton({ query }: { query: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const prioritize = async () => {
    setBusy(true)
    setError(null)
    try {
      setMessage(priorityMessage(await requestPriority(query), new Date()))
      router.refresh()
    } catch (e) {
      setMessage(null)
      setError(priorityErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" onClick={prioritize} disabled={busy} className="btn btn-ghost">
        {busy ? (
          <>
            <Spinner /> {PRIORITY_BUSY_LABEL}
          </>
        ) : (
          PRIORITY_BUTTON_LABEL
        )}
      </button>
      <div role="status" aria-atomic="true" className="flex flex-col items-start gap-2">
        {message && <p className="text-[13px] font-medium text-[var(--color-ink-soft)]">{message}</p>}
        {error && <ErrorNote message={error} />}
      </div>
    </div>
  )
}
