import Link from 'next/link'
import { formatCount } from '@/lib/format'

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  return (
    <nav aria-label="Paginação" className="mt-6 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className="btn btn-ghost">
          Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-[var(--color-ink-soft)]">
        Página <span className="font-mono">{formatCount(page)}</span> de <span className="font-mono">{formatCount(pages)}</span>
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} rel="next" className="btn btn-ghost">
          Próxima
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
