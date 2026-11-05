'use client'

import { useId, useMemo, useState } from 'react'
import { typeaheadChoices, typeaheadSummary, type TypeaheadOption } from '@/lib/typeahead'
import { DigitsInput, MinChoice, PanelLabel, TextInput } from './fields'
import {
  CheckIcon, FilterPopover, OptionList, PanelFooter, useDraftPopover,
} from './FilterPopover'

export const ANY = ''
const TYPEAHEAD_VISIBLE = 100

function closeOnEnter(close: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    close()
  }
}

export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-active={on ? 'true' : undefined}
      onClick={() => onChange(!on)}
      className="btn-chip"
    >
      {on && <CheckIcon />}
      {label}
    </button>
  )
}

export function ListFilter({
  label, activeLabel, title, options, value, onSelect,
}: {
  label: string
  activeLabel: string | null
  title: string
  options: { value: string; label: string }[]
  value: string
  onSelect: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <FilterPopover label={activeLabel ?? label} active={activeLabel !== null} open={open} onOpenChange={setOpen} title={title}>
      <OptionList
        options={options}
        value={value}
        onSelect={(v) => {
          onSelect(v)
          setOpen(false)
        }}
      />
    </FilterPopover>
  )
}

export function SearchListFilter({
  label, activeLabel, title, inputLabel, anyLabel, note, maxLength, options, value, onSelect,
}: {
  label: string
  activeLabel: string | null
  title: string
  inputLabel: string
  anyLabel: string
  note: string
  maxLength: number
  options: TypeaheadOption[]
  value: string
  onSelect: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const noteId = `${useId()}-note`
  const typing = term.trim() !== ''
  const found = useMemo(() => typeaheadChoices(options, term, TYPEAHEAD_VISIBLE, value), [options, term, value])
  const choices = typing ? found.shown : [{ value: ANY, label: anyLabel }, ...found.shown]
  const pick = (next: string) => {
    onSelect(next)
    setOpen(false)
    setTerm('')
  }
  return (
    <FilterPopover
      label={activeLabel ?? label}
      active={activeLabel !== null}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setTerm('')
      }}
      title={title}
    >
      <PanelLabel>{inputLabel}</PanelLabel>
      <div
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (typing && found.matches[0]) pick(found.matches[0].value)
        }}
      >
        <TextInput label={inputLabel} value={term} onChange={setTerm} maxLength={maxLength} autoFocus describedBy={noteId} />
      </div>
      <p id={noteId} className="mt-1 text-[12px] text-[var(--color-ink-soft)]">{note}</p>
      <p role="status" className="my-2 text-[12px] text-[var(--color-ink-soft)]">{typeaheadSummary(found)}</p>
      <OptionList options={choices} value={value} onSelect={pick} />
    </FilterPopover>
  )
}

export function NumberFilter({
  label, activeLabel, title, inputLabel, value, presets, format, onApply, decimal = false,
}: {
  label: string
  activeLabel: string | null
  title: string
  inputLabel: string
  value: string
  presets: readonly number[]
  format: (n: number) => string
  onApply: (raw: string) => void
  decimal?: boolean
}) {
  const p = useDraftPopover(value, onApply, (a, b) => a === b)
  return (
    <FilterPopover label={activeLabel ?? label} active={activeLabel !== null} open={p.open} onOpenChange={p.onOpenChange} title={title}>
      <PanelLabel>{inputLabel}</PanelLabel>
      <MinChoice label={inputLabel} value={p.draft} onChange={p.setDraft} choices={presets} format={format} />
      <div className="mt-2" onKeyDown={closeOnEnter(p.close)}>
        <DigitsInput label={`${inputLabel}: valor`} value={p.draft} onChange={p.setDraft} placeholder="outro valor" decimal={decimal} />
      </div>
      <PanelFooter onClear={() => p.setDraft(ANY)} onDone={p.close} />
    </FilterPopover>
  )
}

export function optionalNumber(raw: string): number | undefined {
  return Number(raw) || undefined
}

export function TextFilter({
  label, activeLabel, title, inputLabel, value, maxLength, onApply,
}: {
  label: string
  activeLabel: string | null
  title: string
  inputLabel: string
  value: string
  maxLength: number
  onApply: (raw: string) => void
}) {
  const p = useDraftPopover(value, onApply, (a, b) => a.trim() === b.trim())
  return (
    <FilterPopover label={activeLabel ?? label} active={activeLabel !== null} open={p.open} onOpenChange={p.onOpenChange} title={title}>
      <PanelLabel>{inputLabel}</PanelLabel>
      <div onKeyDown={closeOnEnter(p.close)}>
        <TextInput label={inputLabel} value={p.draft} onChange={p.setDraft} maxLength={maxLength} />
      </div>
      <PanelFooter onClear={() => p.setDraft(ANY)} onDone={p.close} />
    </FilterPopover>
  )
}
