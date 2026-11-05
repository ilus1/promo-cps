'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ErrorNote } from '@/components/ErrorNote'
import { alertErrorText, saveAlert } from '@/lib/api'
import { ALERT_NAME_MAX } from '@/lib/alert-rules'
import {
  ALERT_ACTIVE_TEXT, ALERT_ADD_TEXT, ALERT_HELP_TEXT, ALERT_NAME_LABEL, ALERT_NAME_REQUIRED_TEXT,
} from '@/lib/labels'
import { ROUTES } from '@/lib/routes'

function BellIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

export function AlertButton({
  viewQuery, activeName, notes,
}: { viewQuery: string; activeName: string | null; notes: readonly string[] }) {
  const router = useRouter()
  const ids = useId()
  const inputId = `${ids}-name`
  const errorId = `${ids}-error`
  const noteIds = notes.map((_, index) => `${ids}-note-${index}`)
  const opener = useRef<HTMLButtonElement>(null)
  const activeLink = useRef<HTMLAnchorElement>(null)
  const restoreFocus = useRef(false)
  const focusActive = useRef(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open || !restoreFocus.current) return
    restoreFocus.current = false
    opener.current?.focus()
  }, [open])

  useEffect(() => {
    if (activeName === null || !focusActive.current) return
    focusActive.current = false
    activeLink.current?.focus()
  }, [activeName])

  if (activeName !== null) {
    return (
      <Link
        ref={activeLink}
        href={ROUTES.alerts}
        data-active="true"
        className="btn-chip min-h-9 max-w-full"
        title={ALERT_HELP_TEXT}
      >
        <BellIcon filled />
        <span className="min-w-0 truncate">{ALERT_ACTIVE_TEXT}: {activeName}</span>
      </Link>
    )
  }

  function close() {
    restoreFocus.current = true
    setOpen(false)
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(ALERT_NAME_REQUIRED_TEXT)
      return
    }
    setPending(true)
    setError(null)
    try {
      await saveAlert(trimmed, viewQuery)
      focusActive.current = true
      setName('')
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(alertErrorText(err))
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <button
        ref={opener}
        type="button"
        onClick={() => setOpen(true)}
        title={ALERT_HELP_TEXT}
        className="btn-chip min-h-9 shrink-0"
      >
        <BellIcon filled={false} />
        {ALERT_ADD_TEXT}
      </button>
    )
  }

  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && close()} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <label htmlFor={inputId} className="text-[13px] font-medium text-[var(--color-ink-soft)]">{ALERT_NAME_LABEL}</label>
      <input
        id={inputId}
        autoFocus
        className="field w-full min-w-0 sm:w-56"
        value={name}
        maxLength={ALERT_NAME_MAX}
        aria-required="true"
        aria-invalid={error !== null}
        aria-describedby={[...noteIds, ...(error ? [errorId] : [])].join(' ') || undefined}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" disabled={pending} className="btn btn-primary min-h-9">Salvar</button>
      <button type="button" disabled={pending} onClick={close} className="btn btn-ghost min-h-9">Cancelar</button>
      {notes.map((note, index) => (
        <p key={note} id={noteIds[index]} className="w-full text-[13px] text-[var(--color-ink-soft)]">{note}</p>
      ))}
      <div id={errorId} role="alert" className="w-full">
        {error && <ErrorNote message={error} />}
      </div>
    </form>
  )
}
