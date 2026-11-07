import { TARGET_HELP_TEXT } from '@/lib/watch/view'
import { FieldError } from './FieldError'

const LABEL = 'Preço alvo (R$)'
const PLACEHOLDER = 'ex: 199,90'

export function TargetPriceField({
  id, value, error, onChange, inputRef,
}: {
  id: string
  value: string
  error: string | undefined
  onChange: (value: string) => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{LABEL}</label>
      <input
        id={id}
        ref={inputRef}
        className="field font-mono"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={PLACEHOLDER}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId}
      />
      {error && <FieldError id={errorId} message={error} />}
      <p id={helpId} className="text-[13px] text-[var(--color-ink-soft)]">{TARGET_HELP_TEXT}</p>
    </div>
  )
}
