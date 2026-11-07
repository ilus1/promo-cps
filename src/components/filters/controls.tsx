'use client'

import { DigitsInput, MinChoice, PanelLabel, TextInput } from './fields'
import { FilterPopover, PanelFooter, useDraftPopover } from './FilterPopover'

export const ANY = ''

function closeOnEnter(close: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    close()
  }
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
