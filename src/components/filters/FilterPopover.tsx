'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const VIEWPORT_MARGIN_PX = 8

export function FilterPopover({
  label, active, open, onOpenChange, title, children,
}: {
  label: React.ReactNode
  active: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closedByPointer = useRef(false)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      closedByPointer.current = true
      onOpenChange(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

  useEffect(() => {
    if (wasOpen.current && !open && !closedByPointer.current) triggerRef.current?.focus()
    if (open) closedByPointer.current = false
    wasOpen.current = open
  }, [open])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!open || !panel) return
    if (panel.getBoundingClientRect().right > window.innerWidth - VIEWPORT_MARGIN_PX) {
      panel.style.left = 'auto'
      panel.style.right = '0'
    }
  }, [open])

  return (
    <div ref={ref} className="sm:relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-active={active ? 'true' : undefined}
        className="btn-chip max-w-[16rem]"
      >
        {active && <CheckIcon />}
        <span className="truncate">{label}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={title}
          className="absolute inset-x-0 z-30 mt-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-lift)] sm:inset-x-auto sm:left-0 sm:w-80"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function useDraftPopover<T>(
  current: T, apply: (draft: T) => void, equal: (a: T, b: T) => boolean,
) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(current)
  const onOpenChange = (next: boolean) => {
    if (next) setDraft(current)
    else if (open && !equal(draft, current)) apply(draft)
    setOpen(next)
  }
  return { open, onOpenChange, draft, setDraft, close: () => onOpenChange(false) }
}

export function PanelFooter({ onClear, onDone }: { onClear: () => void; onDone: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between border-t border-[var(--color-line)] pt-3">
      <button type="button" onClick={onClear} className="text-[13px] font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
        Limpar
      </button>
      <button type="button" onClick={onDone} className="btn btn-primary px-3 py-1.5 text-[13px]">
        Pronto
      </button>
    </div>
  )
}
