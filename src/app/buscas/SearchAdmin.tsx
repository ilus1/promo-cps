'use client'

import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'
import { EmptyCard } from '@/components/EmptyCard'
import { ErrorNote } from '@/components/ErrorNote'
import { Spinner } from '@/components/Spinner'
import type { Search } from '@/db/schema'
import { createBusca } from '@/lib/api'
import {
  firstInvalidField, validateBuscaDraft, type BuscaField, type BuscaFormErrors, type LastRunView,
} from '@/lib/busca-view'
import type { CycleActivity } from '@/lib/domain'
import { APP_UNREACHABLE_TEXT, BUSCA_GONE_TEXT, BUSCA_URL_HELP_TEXT } from '@/lib/labels'
import { SEARCH_HOST } from '@/lib/ml-url'
import { BuscaCard } from './BuscaCard'

const EMPTY_TEXT = 'Nenhuma Busca ainda. Adicione uma acima para começar.'

export type BuscaItem = { search: Search; activity: CycleActivity; lastRun: LastRunView | null }

export function SearchAdmin({ items, initialTerm }: { items: BuscaItem[]; initialTerm: string }) {
  const router = useRouter()
  const ids = useId()
  const fields = useRef<Partial<Record<BuscaField, HTMLInputElement | null>>>({})
  const [draft, setDraft] = useState({ name: '', url: initialTerm })
  const [errors, setErrors] = useState<BuscaFormErrors>({})
  const [creating, setCreating] = useState(false)
  const [goneNotice, setGoneNotice] = useState<string | null>(null)

  function edit(field: BuscaField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
  }

  function fail(found: BuscaFormErrors) {
    setErrors(found)
    const field = firstInvalidField(found)
    if (field) fields.current[field]?.focus()
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const invalid = validateBuscaDraft(draft)
    if (firstInvalidField(invalid)) return fail(invalid)
    setCreating(true)
    try {
      const failure = await createBusca(draft)
      if (failure) return fail(failure)
      setDraft({ name: '', url: '' })
      setErrors({})
      setGoneNotice(null)
      router.refresh()
    } catch {
      fail({ form: APP_UNREACHABLE_TEXT })
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-[920px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Buscas</h1>
        <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
          Buscas e produtos do Mercado Livre que cada ciclo lê no intervalo escolhido.
        </p>
      </div>

      <form onSubmit={create} noValidate className="card mb-8 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">Nova Busca</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-name`} className="text-sm font-medium">Nome</label>
            <input
              id={`${ids}-name`}
              ref={(el) => { fields.current.name = el }}
              className="field"
              placeholder="ex: SSD 1 TB (padrão: o termo)"
              aria-required="true"
              autoComplete="off"
              value={draft.name}
              onChange={(e) => edit('name', e.target.value)}
              aria-invalid={errors.name !== undefined}
              aria-describedby={errors.name ? `${ids}-name-error` : undefined}
            />
            {errors.name && <FieldError id={`${ids}-name-error`} message={errors.name} />}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-url`} className="text-sm font-medium">URL ou termo</label>
            <input
              id={`${ids}-url`}
              ref={(el) => { fields.current.url = el }}
              className="field"
              placeholder={`https://${SEARCH_HOST}/... ou fone bluetooth`}
              aria-required="true"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={draft.url}
              onChange={(e) => edit('url', e.target.value)}
              aria-invalid={errors.url !== undefined}
              aria-describedby={`${ids}-url-help${errors.url ? ` ${ids}-url-error` : ''}`}
            />
            {errors.url && <FieldError id={`${ids}-url-error`} message={errors.url} />}
            <p id={`${ids}-url-help`} className="text-[13px] text-[var(--color-ink-soft)]">{BUSCA_URL_HELP_TEXT}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {errors.form && <FieldError id={`${ids}-form-error`} message={errors.form} />}
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? (
              <>
                <Spinner /> Adicionando...
              </>
            ) : (
              'Adicionar Busca'
            )}
          </button>
        </div>
      </form>

      <h2 className="sr-only">Suas Buscas</h2>
      <div role="status" className={goneNotice ? 'mb-3' : undefined}>
        {goneNotice && <ErrorNote message={goneNotice} />}
      </div>
      {items.length === 0 ? (
        <EmptyCard text={EMPTY_TEXT} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map(({ search, activity, lastRun }) => (
            <li key={search.id}>
              <BuscaCard search={search} activity={activity} lastRun={lastRun} onGone={() => setGoneNotice(BUSCA_GONE_TEXT)} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="text-[13px] font-medium text-[var(--color-danger)]">
      {message}
    </p>
  )
}
