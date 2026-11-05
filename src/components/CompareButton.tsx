'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { compareErrorText, requestCompare } from '@/lib/api'
import { COMPARE_BUSY_LABEL, COMPARE_NOW_LABEL } from '@/lib/labels'
import type { CompareOutcome } from '@/lib/market/types'
import { compareNote } from '@/lib/market/view'
import { ErrorNote } from './ErrorNote'
import { Spinner } from './Spinner'

const MATCHED: CompareOutcome = 'matched'

export function CompareButton({ id, titleId, rowId, matched }: { id: string; titleId: string; rowId: string; matched: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const focusRow = useRef(false)
  const focusButton = useRef(false)

  useEffect(() => {
    if (busy || refreshing) return
    if (focusRow.current) document.getElementById(rowId)?.focus()
    if (focusButton.current) button.current?.focus()
    focusRow.current = false
    focusButton.current = false
  }, [busy, refreshing, rowId])

  async function compare() {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const result = await requestCompare(id)
      setNote(compareNote(result, new Date()))
      focusRow.current = result.status === MATCHED
      focusButton.current = result.status !== MATCHED
      startTransition(() => router.refresh())
    } catch (e) {
      setError(compareErrorText(e))
      focusButton.current = true
    } finally {
      setBusy(false)
    }
  }

  if (matched) return note ? <span>{note}</span> : null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button ref={button} type="button" onClick={compare} disabled={busy || refreshing} aria-describedby={titleId} className="btn-chip">
        {busy || refreshing ? (
          <>
            <Spinner /> {COMPARE_BUSY_LABEL}
          </>
        ) : (
          COMPARE_NOW_LABEL
        )}
      </button>
      <div role="status" aria-atomic="true">{error ? <ErrorNote message={error} /> : note && <span>{note}</span>}</div>
    </div>
  )
}
