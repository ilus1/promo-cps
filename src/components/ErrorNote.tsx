export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="inline-flex max-w-full items-start gap-2 self-start rounded-lg border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-3 py-1.5 text-[13px] text-[var(--color-danger)]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-px shrink-0">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
      <span className="min-w-0 break-words font-medium">{message}</span>
    </div>
  )
}
