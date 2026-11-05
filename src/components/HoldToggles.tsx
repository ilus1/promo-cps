'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { holdErrorText, requestHoldChange } from '@/lib/api'
import { holdBanner, priceChecksToggle, priceToggleNote, requestsToggle, vpnToggleNote } from '@/lib/hold-view'
import type { HoldState } from '@/lib/request-hold'
import { ErrorNote } from './ErrorNote'

export function HoldToggles({ state }: { state: HoldState }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const banner = holdBanner(state)
  const heldBy = vpnToggleNote(state)
  const requests = requestsToggle(state.requestsPaused, heldBy)
  const price = priceChecksToggle(state.priceChecksPaused, priceToggleNote(state))
  const working = busy || refreshing

  async function change(next: { requestsPaused?: boolean; priceChecksPaused?: boolean }) {
    if (working) return
    setBusy(true)
    setError(null)
    try {
      await requestHoldChange(next)
      startTransition(() => router.refresh())
    } catch (e) {
      setError(holdErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-atomic="true" className="flex flex-col gap-2">
        {banner && (
          <p className="rounded-lg bg-[var(--color-amber-soft)] px-3 py-2 text-sm font-semibold text-[var(--color-amber)]">{banner}</p>
        )}
        {error && <ErrorNote message={error} />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-ink-soft)]">{requests.state}</p>
        <button type="button" className="btn btn-ghost aria-disabled:cursor-not-allowed aria-disabled:opacity-55" aria-disabled={working} onClick={() => change({ requestsPaused: !state.requestsPaused })}>
          {requests.action}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-ink-soft)]">{price.state}</p>
        <button type="button" className="btn btn-ghost aria-disabled:cursor-not-allowed aria-disabled:opacity-55" aria-disabled={working} onClick={() => change({ priceChecksPaused: !state.priceChecksPaused })}>
          {price.action}
        </button>
      </div>
    </div>
  )
}
