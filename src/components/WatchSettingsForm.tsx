'use client'

import { useRouter } from 'next/navigation'
import { useId, useRef, useState, useTransition } from 'react'
import { saveWatchSettings, WatchGoneError, watchErrorText } from '@/lib/api'
import {
  DROP_HELP_TEXT, firstInvalidSettingsField, settingsResult, WATCH_SAVED_TEXT, type SettingsDraft, type SettingsErrors, type SettingsField,
} from '@/lib/watch/view'
import { ErrorNote } from './ErrorNote'
import { FieldError } from './FieldError'
import { Spinner } from './Spinner'
import { TargetPriceField } from './TargetPriceField'

const SECTION_TITLE = 'Alertas'

export function WatchSettingsForm({ id, initial, summary }: { id: string; initial: SettingsDraft; summary: string }) {
  const router = useRouter()
  const ids = useId()
  const fields = useRef<Partial<Record<SettingsField, HTMLInputElement | null>>>({})
  const [draft, setDraft] = useState<SettingsDraft>(initial)
  const [errors, setErrors] = useState<SettingsErrors>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [refreshing, startTransition] = useTransition()
  const busy = saving || refreshing

  function edit(field: SettingsField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setNotice(null)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setNotice(null)
    setFailure(null)
    const result = settingsResult(draft)
    if (!result.patch) {
      setErrors(result.errors)
      const field = firstInvalidSettingsField(result.errors)
      if (field) fields.current[field]?.focus()
      return
    }
    setSaving(true)
    try {
      await saveWatchSettings(id, result.patch)
      setNotice(WATCH_SAVED_TEXT)
      startTransition(() => router.refresh())
    } catch (e) {
      setFailure(watchErrorText(e))
      if (e instanceof WatchGoneError) startTransition(() => router.refresh())
    } finally {
      setSaving(false)
    }
  }

  function describedBy(field: SettingsField): string {
    return `${ids}-${field}-help${errors[field] ? ` ${ids}-${field}-error` : ''}`
  }

  return (
    <form onSubmit={save} noValidate className="card mt-5 p-5" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">{SECTION_TITLE}</h2>
      <p className="mb-4 text-[13px] text-[var(--color-ink-soft)]">{summary}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TargetPriceField
          id={`${ids}-targetPrice`}
          value={draft.targetPrice}
          error={errors.targetPrice}
          onChange={(value) => edit('targetPrice', value)}
          inputRef={(el) => { fields.current.targetPrice = el }}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-dropPercent`} className="text-sm font-medium">Queda mínima (%)</label>
          <input
            id={`${ids}-dropPercent`}
            ref={(el) => { fields.current.dropPercent = el }}
            className="field font-mono"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-required="true"
            value={draft.dropPercent}
            onChange={(e) => edit('dropPercent', e.target.value)}
            aria-invalid={errors.dropPercent !== undefined}
            aria-describedby={describedBy('dropPercent')}
          />
          {errors.dropPercent && <FieldError id={`${ids}-dropPercent-error`} message={errors.dropPercent} />}
          <p id={`${ids}-dropPercent-help`} className="text-[13px] text-[var(--color-ink-soft)]">{DROP_HELP_TEXT}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <div role="status" aria-atomic="true" className="mr-auto flex flex-col items-start gap-2">
          {notice && <p className="text-[13px] font-medium text-[var(--color-brand-ink)]">{notice}</p>}
          {failure && <ErrorNote message={failure} />}
        </div>
        <button type="submit" className="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-55" aria-disabled={busy}>
          {saving ? (
            <>
              <Spinner /> Salvando...
            </>
          ) : (
            'Salvar alertas'
          )}
        </button>
      </div>
    </form>
  )
}
