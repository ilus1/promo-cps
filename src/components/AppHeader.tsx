import Link from 'next/link'
import { APP_NAME } from '@/lib/labels'
import { ROUTES } from '@/lib/routes'
import { NavLinks } from './NavLinks'
import { StatusChip } from './StatusChip'

export function AppHeader() {
  return (
    <header className="sm:sticky sm:top-0 z-20 border-b border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-canvas)_82%,white)] backdrop-blur-md">
      <div className="mx-auto flex min-h-14 max-w-[920px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 sm:px-6">
        <Link href={ROUTES.offers} className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-brand)] text-[15px] font-bold text-white shadow-sm" aria-hidden>
            P
          </span>
          <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <NavLinks />
          <span className="hidden h-5 w-px bg-[var(--color-line-strong)] sm:block" aria-hidden />
          <StatusChip />
        </div>
      </div>
    </header>
  )
}
