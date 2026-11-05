'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isActivePath } from '@/lib/nav'
import { ROUTES } from '@/lib/routes'

const LINKS = [
  { href: ROUTES.offers, label: 'Ofertas' },
  { href: ROUTES.coupons, label: 'Cupons' },
  { href: ROUTES.searches, label: 'Buscas' },
  { href: ROUTES.alerts, label: 'Alertas' },
  { href: ROUTES.account, label: 'Conta' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <nav aria-label="Principal" className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
      {LINKS.map(({ href, label }) => {
        const active = isActivePath(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`relative rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'text-[var(--color-ink)]'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            {label}
            {active && (
              <span className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-[var(--color-brand)]" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
