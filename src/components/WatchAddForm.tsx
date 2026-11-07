'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState, useTransition } from 'react'
import { createWatch } from '@/lib/api'
import { APP_UNREACHABLE_TEXT } from '@/lib/labels'
import { productHref, ROUTES } from '@/lib/routes'
import {
  EAN_HELP_TEXT, firstInvalidWatchField, NAME_OR_LINK_HELP_TEXT, validateWatchDraft, WATCH_ADDED_IDLE_TEXT, WATCH_ADDED_TEXT, watchRequestOf,
  type WatchDraft, type WatchField, type WatchFormErrors,
} from '@/lib/watch/view'
import { FieldError } from './FieldError'
import { Spinner } from './Spinner'
import { TargetPriceField } from './TargetPriceField'

const EMPTY_DRAFT: WatchDraft = { nameOrLink: '', ean: '', targetPrice: '' }
const SEE_PRODUCT_LABEL = 'Ver produto'

export function WatchAddForm() {
  const router = useRouter()
  const ids = useId()
  const fields = useRef<Partial<Record<WatchField, HTMLInputElement | null>>>({})
  const [draft, setDraft] = useState<WatchDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<WatchFormErrors>({})
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<{ id: string | null; started: boolean } | null>(null)
  const [refreshing, startTransition] = useTransition()
  const busy = adding || refreshing

  function edit(field: WatchField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
  }

  function fail(found: WatchFormErrors) {
    setErrors(found)
    const field = firstInvalidWatchField(found)
    if (field) fields.current[field]?.focus()
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setAdded(null)
    const invalid = validateWatchDraft(draft)
    if (firstInvalidWatchField(invalid)) return fail(invalid)
    setAdding(true)
    try {
      const result = await createWatch(watchRequestOf(draft))
      if (!result.ok) return fail(result.errors)
      setDraft(EMPTY_DRAFT)
      setErrors({})
      setAdded({ id: result.id, started: result.started })
      fields.current.nameOrLink?.focus()
      startTransition(() => router.replace(ROUTES.products, { scroll: false }))
    } catch {
      fail({ form: APP_UNREACHABLE_TEXT })
    } finally {
      setAdding(false)
    }
  }

  function describedBy(field: WatchField): string {
    return `${ids}-${field}-help${errors[field] ? ` ${ids}-${field}-error` : ''}`
  }

  return (
    <form onSubmit={add} noValidate className="card mb-8 p-5" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">Adicionar produto</h2>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-nameOrLink`} className="text-sm font-medium">Nome ou link do produto</label>
          <input
            id={`${ids}-nameOrLink`}
            ref={(el) => { fields.current.nameOrLink = el }}
            className="field"
            type="text"
            aria-required="true"
            autoComplete="off"
            spellCheck={false}
            value={draft.nameOrLink}
            onChange={(e) => edit('nameOrLink', e.target.value)}
            aria-invalid={errors.nameOrLink !== undefined}
            aria-describedby={describedBy('nameOrLink')}
          />
          {errors.nameOrLink && <FieldError id={`${ids}-nameOrLink-error`} message={errors.nameOrLink} />}
          <p id={`${ids}-nameOrLink-help`} className="text-[13px] text-[var(--color-ink-soft)]">{NAME_OR_LINK_HELP_TEXT}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-ean`} className="text-sm font-medium">Código de barras (EAN)</label>
            <input
              id={`${ids}-ean`}
              ref={(el) => { fields.current.ean = el }}
              className="field font-mono"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={draft.ean}
              onChange={(e) => edit('ean', e.target.value)}
              aria-invalid={errors.ean !== undefined}
              aria-describedby={describedBy('ean')}
            />
            {errors.ean && <FieldError id={`${ids}-ean-error`} message={errors.ean} />}
            <p id={`${ids}-ean-help`} className="text-[13px] text-[var(--color-ink-soft)]">{EAN_HELP_TEXT}</p>
          </div>
          <TargetPriceField
            id={`${ids}-targetPrice`}
            value={draft.targetPrice}
            error={errors.targetPrice}
            onChange={(value) => edit('targetPrice', value)}
            inputRef={(el) => { fields.current.targetPrice = el }}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <div role="status" aria-atomic="true" className="mr-auto text-[13px] font-medium">
          {added && (
            <p className={added.started ? 'text-[var(--color-brand-ink)]' : 'text-[var(--color-amber)]'}>
              {added.started ? WATCH_ADDED_TEXT : WATCH_ADDED_IDLE_TEXT}
              {added.id && (
                <>
                  {' '}
                  <Link href={productHref(added.id)} className="underline">{SEE_PRODUCT_LABEL}</Link>
                </>
              )}
            </p>
          )}
        </div>
        {errors.form && <FieldError id={`${ids}-form-error`} message={errors.form} />}
        <button type="submit" className="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-55" aria-disabled={busy}>
          {adding ? (
            <>
              <Spinner /> Adicionando...
            </>
          ) : (
            'Adicionar produto'
          )}
        </button>
      </div>
    </form>
  )
}
