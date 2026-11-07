'use client'

import { useEffect, useRef } from 'react'
import { ROUTES } from '@/lib/routes'

export function StoppedNotice({ text }: { text: string }) {
  const notice = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    notice.current?.focus()
    window.history.replaceState(null, '', ROUTES.products)
  }, [])

  return (
    <p
      ref={notice}
      tabIndex={-1}
      role="status"
      className="mb-4 rounded-lg bg-[var(--color-brand-soft)] px-3 py-2 text-[13px] font-medium text-[var(--color-brand-ink)]"
    >
      {text}
    </p>
  )
}
