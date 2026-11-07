'use client'

import { useRouter } from 'next/navigation'
import { useId, useRef, useState, useTransition } from 'react'
import { removeWatchListing, WatchGoneError, watchErrorText } from '@/lib/api'
import { OPENS_IN_NEW_TAB_TEXT } from '@/lib/labels'
import {
  BEST_PRICE_LABEL, LISTING_GONE_TEXT, LISTING_REMOVED_TEXT, LISTINGS_HELP_TEXT, OUT_OF_STOCK_LABEL, type ListingRow,
} from '@/lib/watch/view'
import { ErrorNote } from './ErrorNote'
import { Fact } from './Fact'
import { StatusBadge } from './StatusBadge'

const SECTION_TITLE = 'Lojas'
const STORE_LINK_LABEL = 'Ver na loja'
const REMOVE_LABEL = 'Remover este anúncio'
const REMOVING_LABEL = 'Removendo...'

export function WatchListings({ rows, emptyText }: { rows: ListingRow[]; emptyText: string }) {
  const router = useRouter()
  const ids = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null)
  const [refreshing, startTransition] = useTransition()
  const busy = removing !== null || refreshing

  function done(message: string) {
    setNotice(message)
    heading.current?.focus()
    startTransition(() => router.refresh())
  }

  async function remove(row: ListingRow) {
    if (busy || !confirm(row.removeConfirm)) return
    setRemoving(row.id)
    setNotice(null)
    setFailure(null)
    try {
      await removeWatchListing(row.id)
      done(LISTING_REMOVED_TEXT)
    } catch (e) {
      if (e instanceof WatchGoneError) done(LISTING_GONE_TEXT)
      else setFailure({ id: row.id, message: watchErrorText(e) })
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section className="card mt-5 p-5" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} ref={heading} tabIndex={-1} className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
        {SECTION_TITLE}
      </h2>
      <p className="mb-4 text-[13px] text-[var(--color-ink-soft)]">{LISTINGS_HELP_TEXT}</p>
      <div role="status" aria-atomic="true" className={notice ? 'mb-3' : undefined}>
        {notice && <p className="text-[13px] font-medium text-[var(--color-brand-ink)]">{notice}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-soft)]">{emptyText}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-line)]">
          {rows.map((row) => {
            const storeId = `${ids}-${row.id}-store`
            const errorId = `${ids}-${row.id}-error`
            const rowFailure = failure?.id === row.id ? failure.message : null
            return (
              <li key={row.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={storeId} className="text-[15px] font-semibold tracking-tight">{row.store}</h3>
                  {row.best && <StatusBadge tone="badge-new" label={BEST_PRICE_LABEL} />}
                  {row.outOfStock && <StatusBadge tone="badge-muted" label={OUT_OF_STOCK_LABEL} />}
                </div>
                <p className="break-words text-[13px] text-[var(--color-ink-soft)]">{row.title}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Fact label="Preço"><span className="font-mono">{row.price}</span></Fact>
                  <Fact label="De"><span className="font-mono">{row.listPrice}</span></Fact>
                  <Fact label="Preço final"><span className="font-mono font-semibold">{row.finalPrice}</span></Fact>
                  <Fact label="Encontrado por">{row.match}</Fact>
                </dl>
                <p className="text-[13px] text-[var(--color-ink-soft)]">{row.checked}</p>
                {row.error && <ErrorNote message={row.error} />}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {row.url && (
                    <a href={row.url} target="_blank" rel="noopener noreferrer" aria-describedby={storeId} className="btn btn-ghost">
                      {STORE_LINK_LABEL}<span className="sr-only"> {OPENS_IN_NEW_TAB_TEXT}</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(row)}
                    aria-disabled={busy}
                    aria-describedby={rowFailure ? `${storeId} ${errorId}` : storeId}
                    className="btn btn-danger aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                  >
                    {removing === row.id ? REMOVING_LABEL : REMOVE_LABEL}
                  </button>
                </div>
                <div id={errorId} role="alert">
                  {rowFailure && <ErrorNote message={rowFailure} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
