'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { requestItemStatus } from '@/lib/api'
import type { ItemStatus } from '@/lib/domain'
import { ErrorNote } from './ErrorNote'

const SEEN: ItemStatus = 'SEEN'
const SAVED: ItemStatus = 'SAVED'
const NOT_SEEN: ItemStatus = 'NOT_SEEN'

export function StatusButtons({ id, status, titleId }: { id: string; status: ItemStatus; titleId: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function update(next: ItemStatus) {
    setPending(true)
    setError(null)
    try {
      await requestItemStatus(id, next)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  const saved = status === SAVED
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || status === SEEN}
          onClick={() => update(SEEN)}
          aria-describedby={titleId}
          className="btn-chip"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Visto
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => update(saved ? NOT_SEEN : SAVED)}
          aria-pressed={saved}
          aria-describedby={titleId}
          className="btn-chip"
          data-active={saved ? 'true' : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
          </svg>
          {saved ? 'Salvo' : 'Salvar'}
        </button>
        {status !== NOT_SEEN && (
          <button
            type="button"
            disabled={pending}
            onClick={() => update(NOT_SEEN)}
            aria-describedby={titleId}
            className="btn-chip"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H9" />
            </svg>
            Novo
          </button>
        )}
      </div>
      {error && <ErrorNote message={error} />}
    </div>
  )
}
