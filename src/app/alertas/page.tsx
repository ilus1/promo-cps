import Link from 'next/link'
import { AppHeader } from '@/components/AppHeader'
import { DeleteAlertButton } from '@/components/DeleteAlertButton'
import { EmptyCard } from '@/components/EmptyCard'
import { ErrorNote } from '@/components/ErrorNote'
import { labelFacetsFor, listAlerts } from '@/db/alerts'
import { viewHref } from '@/lib/alert-digest'
import { alertFilters } from '@/lib/deal-query'
import { buscaRemoved, filterChipLabels } from '@/lib/filter-labels'
import { formatCount, formatDateTime } from '@/lib/format'
import { ALERT_BUSCA_REMOVED_TEXT, ALERT_NO_FILTERS_TEXT, ALERTS_EMPTY_ACTION_TEXT, ALERTS_EMPTY_TEXT } from '@/lib/labels'
import { ROUTES } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export default async function AlertasPage() {
  const alerts = await listAlerts()
  const parsed = alerts.map((alert) => alertFilters(alert.query))
  const facets = await labelFacetsFor(parsed)
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[920px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Alertas</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
            <span className="font-mono">{formatCount(alerts.length)}</span> {alerts.length === 1 ? 'alerta salvo' : 'alertas salvos'}.
          </p>
        </div>
        {alerts.length === 0 ? (
          <EmptyCard text={ALERTS_EMPTY_TEXT} action={{ href: ROUTES.offers, label: ALERTS_EMPTY_ACTION_TEXT }} />
        ) : (
          <ul className="flex flex-col gap-3">
            {alerts.map((alert, index) => {
              const nameId = `alert-${alert.id}`
              const filters = parsed[index]
              const chips = filterChipLabels(filters, facets)
              return (
                <li key={alert.id}>
                  <article className="card p-4 sm:p-5" aria-labelledby={nameId}>
                    <h2 id={nameId} className="min-w-0 break-words text-base font-semibold tracking-tight">{alert.name}</h2>
                    <ul aria-label="Filtros do alerta" className="mt-2 flex flex-wrap gap-1.5">
                      {(chips.length > 0 ? chips : [ALERT_NO_FILTERS_TEXT]).map((chip) => (
                        <li key={chip} className="badge badge-muted">{chip}</li>
                      ))}
                    </ul>
                    {buscaRemoved(filters, facets) && (
                      <div className="mt-2"><ErrorNote message={ALERT_BUSCA_REMOVED_TEXT} /></div>
                    )}
                    <p className="mt-2 text-[13px] text-[var(--color-ink-soft)]">Criado em {formatDateTime(alert.createdAt)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
                      <Link href={viewHref('', alert.query)} aria-describedby={nameId} className="btn btn-ghost min-h-9">
                        Abrir
                      </Link>
                      <DeleteAlertButton id={alert.id} name={alert.name} describedBy={nameId} />
                    </div>
                  </article>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </>
  )
}
