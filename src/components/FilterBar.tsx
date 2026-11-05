'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import type { DealFacets } from '@/db/deals'
import {
  CLEARED_FILTERS, DEAL_SORTS, dealHref, hasDealFilters, type DealQuery,
} from '@/lib/deal-query'
import { CENTS_PER_REAL, SEARCH_TEXT_MAX } from '@/lib/constants'
import { EMPTY_ACTION_LABEL } from '@/lib/coupon-empty'
import { normalizeSearchText } from '@/lib/text-search'
import { categoryLabel } from '@/lib/deal-view'
import { activeFilterLabels, FILTER_TOGGLE_LABEL, freshnessApplies } from '@/lib/filter-labels'
import { formatCount, formatWholeReais } from '@/lib/format'
import { DEAL_SORT_LABEL, DISCOUNT_MIN_LABEL, SAVING_PERCENT_FILTER_LABEL, SAVING_REAIS_FILTER_LABEL } from '@/lib/labels'
import { centsFromReais } from '@/lib/query-params'
import { ANY, ListFilter, NumberFilter, optionalNumber, SearchListFilter, TextFilter, Toggle } from './filters/controls'

const PRICE_PRESETS = [100, 250, 500, 1000, 2500] as const
const DISCOUNT_PRESETS = [10, 20, 30, 40, 50] as const
const SAVING_PRESETS = [10, 20, 30, 50, 70] as const
const SAVING_REAIS_PRESETS = [20, 50, 100, 250, 500] as const
const SOLD_PRESETS = [10, 50, 100, 500, 1000] as const
const CATEGORY_NOTE = 'nomes do Mercado Livre, em inglês'
const CLEAR_LABEL = EMPTY_ACTION_LABEL['clear-filters']

type Go = (changes: Partial<DealQuery>) => void

export function FilterBar({
  query, facets, hideClear, children,
}: { query: DealQuery; facets: DealFacets; hideClear: boolean; children?: React.ReactNode }) {
  const router = useRouter()
  const go: Go = (changes) => router.replace(dealHref(query, changes), { scroll: false })
  const active = activeFilterLabels(query, facets)
  const priceMax = query.priceMaxCents === undefined ? ANY : String(query.priceMaxCents / CENTS_PER_REAL)
  const savingMinReais = query.savingMinCents === undefined ? ANY : String(query.savingMinCents / CENTS_PER_REAL)
  const categoryOptions = useMemo(
    () => facets.categories.map((c) => ({ value: c.id, label: categoryLabel(c.id) })),
    [facets.categories],
  )
  const showClear = hasDealFilters(query) && !hideClear

  return (
    <section aria-label="Filtros" className="card relative mb-5 p-3 sm:p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <TextFilter
          label="Buscar por texto"
          activeLabel={active.text ?? null}
          title="Buscar no título"
          inputLabel="Texto no título"
          value={query.text ?? ANY}
          maxLength={SEARCH_TEXT_MAX}
          onApply={(raw) => go({ text: normalizeSearchText(raw) || undefined })}
        />
        <ListFilter
          label="Busca"
          activeLabel={active.search ?? null}
          title="Filtrar por busca"
          options={[{ value: ANY, label: 'Todas as buscas' }, ...facets.searches.map((s) => ({ value: s.id, label: s.name }))]}
          value={query.searchId ?? ANY}
          onSelect={(v) => go({ searchId: v || undefined })}
        />
        <ListFilter
          label="Cupom"
          activeLabel={active.coupon ?? null}
          title="Filtrar por cupom"
          options={[
            { value: ANY, label: 'Todos os cupons' },
            ...facets.coupons.map((c) => ({ value: c.id, label: `${c.label} (${formatCount(c.linked)})` })),
          ]}
          value={query.couponId ?? ANY}
          onSelect={(v) => go({ couponId: v || undefined })}
        />
        {active.couponSet && (
          <button
            type="button"
            data-active="true"
            className="btn-chip max-w-full font-semibold"
            aria-label={`Remover filtro ${active.couponSet}`}
            title={active.couponSet}
            onClick={() => go({ couponSetQuery: undefined })}
          >
            <span className="min-w-0 truncate">{active.couponSet}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
        <NumberFilter
          label="Preço máximo"
          activeLabel={active.priceMax ?? null}
          title="Preço máximo"
          inputLabel="Preço máximo (R$)"
          value={priceMax}
          presets={PRICE_PRESETS}
          format={formatWholeReais}
          decimal
          onApply={(raw) => go({ priceMaxCents: centsFromReais(raw) || undefined })}
        />
        <NumberFilter
          label={DISCOUNT_MIN_LABEL}
          activeLabel={active.discountMin ?? null}
          title={DISCOUNT_MIN_LABEL}
          inputLabel={`${DISCOUNT_MIN_LABEL} (%)`}
          value={query.discountMin ? String(query.discountMin) : ANY}
          presets={DISCOUNT_PRESETS}
          format={(n) => `${n}%`}
          onApply={(raw) => go({ discountMin: optionalNumber(raw) })}
        />
        <NumberFilter
          label={SAVING_PERCENT_FILTER_LABEL}
          activeLabel={active.savingMin ?? null}
          title={SAVING_PERCENT_FILTER_LABEL}
          inputLabel={SAVING_PERCENT_FILTER_LABEL}
          value={query.savingMin ? String(query.savingMin) : ANY}
          presets={SAVING_PRESETS}
          format={(n) => `${n}%`}
          onApply={(raw) => go({ savingMin: optionalNumber(raw) })}
        />
        <NumberFilter
          label={SAVING_REAIS_FILTER_LABEL}
          activeLabel={active.savingMinCents ?? null}
          title={SAVING_REAIS_FILTER_LABEL}
          inputLabel={SAVING_REAIS_FILTER_LABEL}
          value={savingMinReais}
          presets={SAVING_REAIS_PRESETS}
          format={formatWholeReais}
          decimal
          onApply={(raw) => go({ savingMinCents: centsFromReais(raw) || undefined })}
        />
        <Toggle label={FILTER_TOGGLE_LABEL.onlyDrops} on={query.onlyDrops} onChange={(onlyDrops) => go({ onlyDrops })} />
        <NumberFilter
          label="Vendidos mínimo"
          activeLabel={active.soldMin ?? null}
          title="Vendidos mínimo"
          inputLabel="Vendidos mínimo"
          value={query.soldMin ? String(query.soldMin) : ANY}
          presets={SOLD_PRESETS}
          format={(n) => `${formatCount(n)}+`}
          onApply={(raw) => go({ soldMin: optionalNumber(raw) })}
        />
        <Toggle label={FILTER_TOGGLE_LABEL.full} on={query.full} onChange={(full) => go({ full })} />
        <Toggle label={FILTER_TOGGLE_LABEL.freeShipping} on={query.freeShipping} onChange={(freeShipping) => go({ freeShipping })} />
        <SearchListFilter
          label="Categoria"
          activeLabel={active.category ?? null}
          title="Filtrar por tipo de produto"
          inputLabel="Buscar tipo de produto"
          anyLabel="Todas as categorias"
          note={CATEGORY_NOTE}
          maxLength={SEARCH_TEXT_MAX}
          options={categoryOptions}
          value={query.category ?? ANY}
          onSelect={(v) => go({ category: v || undefined })}
        />
        <Toggle label={FILTER_TOGGLE_LABEL.offersOnly} on={query.offersOnly} onChange={(offersOnly) => go({ offersOnly })} />
        <Toggle label={FILTER_TOGGLE_LABEL.onlyVerified} on={query.onlyVerified} onChange={(onlyVerified) => go({ onlyVerified })} />
        <Toggle label={FILTER_TOGGLE_LABEL.showInflated} on={query.showInflated} onChange={(showInflated) => go({ showInflated })} />
        {(freshnessApplies(query.tab) || query.includeStale) && (
          <Toggle label={FILTER_TOGGLE_LABEL.includeStale} on={query.includeStale} onChange={(includeStale) => go({ includeStale })} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-3">
        <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-ink-soft)]">
          Ordenar por
          <select
            value={query.sort}
            onChange={(e) => go({ sort: DEAL_SORTS.find((s) => s === e.target.value) })}
            className="field w-auto cursor-pointer py-2 pr-7 text-[13px]"
          >
            {DEAL_SORTS.map((sort) => (
              <option key={sort} value={sort}>{DEAL_SORT_LABEL[sort]}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {children}
          {showClear && (
            <Link
              href={dealHref(query, CLEARED_FILTERS)}
              scroll={false}
              className="text-[13px] font-medium text-[var(--color-brand-strong)] hover:underline"
            >
              {CLEAR_LABEL}
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
