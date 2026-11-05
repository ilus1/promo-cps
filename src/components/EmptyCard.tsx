import Link from 'next/link'

export function EmptyCard({ text, action }: { text: string; action?: { href: string; label: string } | null }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="max-w-sm text-sm text-[var(--color-ink-soft)]">{text}</p>
      {action && (
        <Link href={action.href} className="btn btn-ghost">
          {action.label}
        </Link>
      )}
    </div>
  )
}
