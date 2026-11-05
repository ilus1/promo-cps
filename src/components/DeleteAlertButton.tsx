'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { ErrorNote } from '@/components/ErrorNote'
import { alertErrorText, removeAlert } from '@/lib/api'
import { DELETE_LABEL } from '@/lib/labels'

export function DeleteAlertButton({ id, name, describedBy }: { id: string; name: string; describedBy: string }) {
  const router = useRouter()
  const errorId = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!confirm(`${DELETE_LABEL} o alerta "${name}"?`)) return
    setPending(true)
    setError(null)
    try {
      await removeAlert(id)
      router.refresh()
    } catch (e) {
      setError(alertErrorText(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void remove()}
        disabled={pending}
        aria-describedby={error ? `${describedBy} ${errorId}` : describedBy}
        className="btn btn-danger min-h-9"
      >
        {DELETE_LABEL}
      </button>
      <div id={errorId} role="alert" className="w-full">
        {error && <ErrorNote message={error} />}
      </div>
    </>
  )
}
