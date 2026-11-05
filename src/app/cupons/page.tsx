import Link from 'next/link'
import { countCoupons, countValidCoupons, listCoupons } from '@/db/coupons'
import { AppHeader } from '@/components/AppHeader'
import { PrioritizeButton } from '@/components/PrioritizeButton'
import { CouponFilterBar } from '@/components/CouponFilterBar'
import { CouponRow } from '@/components/CouponRow'
import { EmptyCard } from '@/components/EmptyCard'
import { Pagination } from '@/components/Pagination'
import { PAGE_SIZE } from '@/lib/constants'
import { EMPTY_ACTION_LABEL, emptyState } from '@/lib/coupon-empty'
import {
  CLEARED_COUPON_FILTERS, couponFilterQuery, couponHref, FILTERABLE_KINDS, hasCouponFilters, parseCouponQuery, type CouponParams,
} from '@/lib/coupon-query'
import { offersByCouponSetHref } from '@/lib/deal-query'
import { COUPON_LIST_STATUSES, COUPON_SCOPES } from '@/lib/domain'
import { couponCountLine } from '@/lib/coupon-count'
import {
  COUPON_KIND_LABEL, COUPON_SCOPE_LABEL, COUPON_STATUS_LABEL, ML_ACCOUNT_LABEL, OFFERS_OF_SET_LABEL,
} from '@/lib/labels'
import { ROUTES } from '@/lib/routes'

export const dynamic = 'force-dynamic'

const EXPIRY_WINDOWS = [7, 30]

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={active ? 'btn-chip font-semibold' : 'btn-chip'}
      data-active={active ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
    >
      {active && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {children}
    </Link>
  )
}

function ChipGroup({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const labelId = `chips-${id}`
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1.5">
      <span id={labelId} className="text-[13px] font-medium text-[var(--color-ink-soft)]">{label}:</span>
      {children}
    </div>
  )
}

export default async function CuponsPage({ searchParams }: { searchParams: Promise<CouponParams> }) {
  const query = parseCouponQuery(await searchParams)
  const now = new Date()
  const [coupons, total, valid] = await Promise.all([
    listCoupons(query, now),
    countCoupons(query, now),
    query.status === undefined ? countValidCoupons(query, now) : null,
  ])
  const { page } = query
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = hasCouponFilters(query)
  const overall = coupons.length === 0 && total === 0 && filtered ? await countCoupons({}, now) : total
  const empty = emptyState({ shown: coupons.length, total, filtered, overall })
  const filterQuery = couponFilterQuery(query)
  const showSetActions = filtered && query.status !== 'ended'
  const emptyHref = {
    'first-page': couponHref(query, { page: 1 }),
    account: ROUTES.account,
    'clear-filters': couponHref(query, CLEARED_COUPON_FILTERS),
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[920px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Cupons</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
            {couponCountLine(total, valid, query.status)} no {ML_ACCOUNT_LABEL}.
          </p>
        </div>

        <CouponFilterBar query={query}>
          <ChipGroup id="status" label="Status">
            {COUPON_LIST_STATUSES.map((status) => (
              <Chip
                key={status}
                href={couponHref(query, { status: query.status === status ? undefined : status })}
                active={query.status === status}
              >
                {COUPON_STATUS_LABEL[status]}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup id="scope" label="Escopo">
            {COUPON_SCOPES.map((scope) => (
              <Chip
                key={scope}
                href={couponHref(query, { scope: query.scope === scope ? undefined : scope })}
                active={query.scope === scope}
              >
                {COUPON_SCOPE_LABEL[scope]}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup id="kind" label="Tipo">
            {FILTERABLE_KINDS.map((kind) => (
              <Chip
                key={kind}
                href={couponHref(query, { kind: query.kind === kind ? undefined : kind })}
                active={query.kind === kind}
              >
                {COUPON_KIND_LABEL[kind]}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup id="expiry" label="Vence em">
            {EXPIRY_WINDOWS.map((days) => (
              <Chip
                key={days}
                href={couponHref(query, { expiringWithinDays: query.expiringWithinDays === days ? undefined : days })}
                active={query.expiringWithinDays === days}
              >
                {days} dias
              </Chip>
            ))}
          </ChipGroup>
        </CouponFilterBar>

        {showSetActions && (
          <div className="mb-5 flex flex-wrap items-start gap-x-3 gap-y-2">
            <Link href={offersByCouponSetHref(filterQuery)} className="btn btn-ghost">{OFFERS_OF_SET_LABEL}</Link>
            <PrioritizeButton key={filterQuery} query={filterQuery} />
          </div>
        )}

        {empty ? (
          <EmptyCard text={empty.text} action={{ href: emptyHref[empty.action], label: EMPTY_ACTION_LABEL[empty.action] }} />
        ) : (
          <ul className="flex flex-col gap-3">
            {coupons.map((coupon) => (
              <CouponRow key={coupon.campaignId} coupon={coupon} now={now} text={query.text} />
            ))}
          </ul>
        )}

        {pages > 1 && !empty && (
          <Pagination page={page} pages={pages} hrefFor={(target) => couponHref(query, { page: target })} />
        )}
      </main>
    </>
  )
}
