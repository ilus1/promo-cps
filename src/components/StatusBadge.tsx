import type { BadgeTone } from '@/lib/badge-tone'

export function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span className={`badge ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> {label}
    </span>
  )
}
