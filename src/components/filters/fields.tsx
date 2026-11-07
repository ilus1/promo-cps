'use client'

import { decimalDraft, digitsDraft } from '@/lib/number-draft'

export function DigitsInput({
  value, onChange, placeholder, label, decimal = false,
}: { value: string; onChange: (v: string) => void; placeholder: string; label: string; decimal?: boolean }) {
  const clean = decimal ? decimalDraft : digitsDraft
  return (
    <input
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={value}
      onChange={(e) => onChange(clean(e.target.value))}
      placeholder={placeholder}
      aria-label={label}
      className="field py-2 font-mono text-[13px]"
    />
  )
}

export function MinChoice({
  value, onChange, label, choices, format,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  choices: readonly number[]
  format: (n: number) => string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {choices.map((c) => {
        const selected = value === String(c)
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(selected ? '' : String(c))}
            aria-pressed={selected}
            data-active={selected ? 'true' : undefined}
            className="btn-chip px-2.5"
          >
            {format(c)}
          </button>
        )
      })}
    </div>
  )
}

export function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
      {children}
    </span>
  )
}

export function TextInput({
  value, onChange, label, maxLength,
}: { value: string; onChange: (v: string) => void; label: string; maxLength: number }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
      aria-label={label}
      className="field py-2 text-[13px]"
    />
  )
}
