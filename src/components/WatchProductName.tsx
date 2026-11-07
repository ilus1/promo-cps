import { OPENS_IN_NEW_TAB_TEXT } from '@/lib/labels'
import type { ProductHeading } from '@/lib/watch/view'

export function WatchProductName({ heading, id, level, className }: { heading: ProductHeading; id: string; level: 'h1' | 'h3'; className: string }) {
  const Heading = level
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Heading id={id} className={`break-words ${className}`}>{heading.title}</Heading>
      {heading.pending && <p className="text-[13px] text-[var(--color-ink-soft)]">{heading.pending}</p>}
      {heading.link && (
        <a
          href={heading.link}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 break-all font-mono text-[12px] text-[var(--color-ink-soft)] underline-offset-2 hover:text-[var(--color-brand-strong)] hover:underline"
        >
          {heading.link}<span className="sr-only"> {OPENS_IN_NEW_TAB_TEXT}</span>
        </a>
      )}
    </div>
  )
}
