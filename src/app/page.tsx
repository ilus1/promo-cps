import Link from 'next/link'
import { listAlerts } from '@/db/alerts'
import { countDealsByTab, dealFacets, earliestSegmentStart, listDeals } from '@/db/deals'
import { marketStatus } from '@/ingestion/market/crawlers'
import { accountRuns } from '@/db/request-runs'
import { AlertButton } from '@/components/AlertButton'
import { AppHeader } from '@/components/AppHeader'
import { BulkSeenButtons } from '@/components/BulkSeenButtons'
import { DealCard } from '@/components/DealCard'
import { EmptyCard } from '@/components/EmptyCard'
import { HealthBanner } from '@/components/HealthBanner'
import { FilterBar } from '@/components/FilterBar'
import { Pagination } from '@/components/Pagination'
import { EAGER_THUMBNAILS, PAGE_SIZE } from '@/lib/constants'
import { EMPTY_ACTION_LABEL } from '@/lib/coupon-empty'
import { alertFormNotes } from '@/lib/alert-note'
import { narrowsList } from '@/lib/bulk-seen-view'
import { marketCoverageText } from '@/lib/market/view'
import { countsLine, dropsNotice, hiddenNote } from '@/lib/deal-view'
import { dealEmptyState } from '@/lib/deal-empty'
import { alertNarrows, alertQueryOf, CLEARED_FILTERS, dealHref, dealSearchParams, hasDealFilters, parseDealQuery, viewsDrops, type DealParams } from '@/lib/deal-query'
import { ALERT_STATUSES, ITEM_STATUSES, STATUS_NOT_SEEN } from '@/lib/domain'
import { formatCount } from '@/lib/format'
import { cycleBannerText } from '@/lib/cycle-banner'
import { followHref } from '@/lib/busca-view'
import { buscaFollowText, ITEM_TAB_LABEL } from '@/lib/labels'
import { ROUTES } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export default async function OfertasPage({ searchParams }: { searchParams: Promise<DealParams> }) {
  const query = parseDealQuery(await searchParams)
  const now = new Date()
  const [deals, facets, runs, totals, alerts, earliestSegment, market] = await Promise.all([
    listDeals(query, now),
    dealFacets(now, query.couponId),
    accountRuns(),
    countDealsByTab(query, now),
    listAlerts(),
    viewsDrops(query) ? earliestSegmentStart() : null,
    marketStatus(now),
  ])
  const notice = dropsNotice(earliestSegment, now)
  const eagerIds = new Set(deals.filter((deal) => deal.thumbnail).slice(0, EAGER_THUMBNAILS).map((deal) => deal.id))
  const viewQuery = alertQueryOf(query)
  const activeAlert = alerts.find((alert) => alert.query === viewQuery)
  const alertNotes = alertFormNotes(alertNarrows(query), ALERT_STATUSES.reduce((sum, tab) => sum + totals.offers[tab], 0))
  const total = totals.items[query.tab]
  const offers = totals.offers[query.tab]
  const hiddenCount = totals.hidden[query.tab]
  const coverage = marketCoverageText(market.coverage)
  const anyTab = ITEM_STATUSES.reduce((sum, tab) => sum + totals.items[tab], 0)
  const { page } = query
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = hasDealFilters(query)
  const empty = dealEmptyState({ shown: deals.length, total, filtered, anyTab })
  const emptyHref = {
    'first-page': dealHref(query, { page: 1 }),
    account: ROUTES.account,
    'clear-filters': dealHref(query, CLEARED_FILTERS),
  }
  const bannerText = cycleBannerText(runs.finishedCycle, runs.workedCycle, runs.login)

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[920px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ofertas</h1>
            <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
              {countsLine(total, offers)}.
              {hiddenCount > 0 && (
                <>
                  {' '}
                  <Link href={dealHref(query, { showInflated: true })} className="underline">{hiddenNote(hiddenCount).link}</Link>
                  {' '}{hiddenNote(hiddenCount).rest}
                </>
              )}
            </p>
            {coverage && <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{coverage}</p>}
          </div>
          <nav aria-label="Abas" className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]">
            {ITEM_STATUSES.map((tab) => {
              const active = query.tab === tab
              return (
                <Link
                  key={tab}
                  href={dealHref(query, { tab })}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-ink)]'
                      : 'text-[var(--color-ink-soft)] hover:bg-[#f4f2ec] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {ITEM_TAB_LABEL[tab]}
                  <span className="min-w-4 rounded-full bg-[#eeece6] px-1 text-center font-mono text-[11px] text-[var(--color-ink-soft)]">
                    {formatCount(totals.items[tab])}
                  </span>
                </Link>
              )
            })}
          </nav>
        </div>

        {bannerText && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-[13px] font-medium text-[var(--color-danger)]">
            <span className="min-w-0 break-words">{bannerText}</span>
            <Link href={ROUTES.account} className="underline">{EMPTY_ACTION_LABEL.account}</Link>
          </div>
        )}

        <HealthBanner cycle={runs.finishedCycle} />

        <FilterBar query={query} facets={facets} hideClear={empty?.action === 'clear-filters'}>
          <AlertButton viewQuery={viewQuery} activeName={activeAlert?.name ?? null} notes={alertNotes} />
        </FilterBar>

        {query.text && (
          <p className="mb-3 text-sm">
            <Link href={followHref(query.text)} className="underline">{buscaFollowText(query.text)}</Link>
          </p>
        )}

        {query.tab === STATUS_NOT_SEEN && (
          <BulkSeenButtons
            ids={deals.map((deal) => deal.id)}
            query={dealSearchParams(query).toString()}
            total={total}
            filtered={narrowsList(query)}
            asOf={now.toISOString()}
          />
        )}

        {notice && (
          <p className="mb-3 rounded-lg bg-[var(--color-amber-soft)] px-3 py-2 text-[13px] font-medium text-[var(--color-amber)]">{notice}</p>
        )}

        {empty ? (
          <EmptyCard text={empty.text} action={empty.action && { href: emptyHref[empty.action], label: EMPTY_ACTION_LABEL[empty.action] }} />
        ) : (
          <ul className="flex flex-col gap-3">
            {deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} now={now} eager={eagerIds.has(deal.id)} />
            ))}
          </ul>
        )}

        {pages > 1 && !empty && (
          <Pagination page={page} pages={pages} hrefFor={(target) => dealHref(query, { page: target })} />
        )}
      </main>
    </>
  )
}
