import type { PriceNote, ProductSummary } from '@/lib/watch/view'

function Note({ note }: { note: PriceNote }) {
  return (
    <p className={`text-[13px] ${note.good ? 'font-semibold text-[var(--color-brand-ink)]' : 'text-[var(--color-ink-soft)]'}`}>{note.text}</p>
  )
}

export function WatchBestPrice({ summary, large = false }: { summary: ProductSummary; large?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {summary.price ? (
        <div>
          <p className={`whitespace-nowrap font-mono font-semibold tracking-tight ${large ? 'text-2xl' : 'text-lg'}`}>{summary.price}</p>
          <p className="text-[13px] text-[var(--color-ink-soft)]">{summary.bestLine}</p>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-ink-soft)]">{summary.noPrice}</p>
      )}
      {summary.low && <Note note={summary.low} />}
      {summary.target && <Note note={summary.target} />}
    </div>
  )
}
