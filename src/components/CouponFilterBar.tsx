'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CENTS_PER_REAL, SEARCH_TEXT_MAX } from '@/lib/constants'
import { EMPTY_ACTION_LABEL } from '@/lib/coupon-empty'
import { CLEARED_COUPON_FILTERS, couponHref, hasCouponFilters, type CouponQuery } from '@/lib/coupon-query'
import { COUPON_SORTS, DEFAULT_COUPON_SORT } from '@/lib/domain'
import { activeCouponLabels, COUPON_WITH_OFFERS_LABEL } from '@/lib/filter-labels'
import { formatWholeReais } from '@/lib/format'
import {
  COUPON_SORT_LABEL, DISCOUNT_AT_MINIMUM_LABEL, DISCOUNT_MIN_LABEL, LIMIT_MIN_LABEL, MINIMUM_MAX_LABEL, TRIVIAL_SAVING_NOTE,
} from '@/lib/labels'
import { normalizeSearchText } from '@/lib/text-search'
import { centsFromReais } from '@/lib/query-params'
import { ANY, NumberFilter, optionalNumber, TextFilter, Toggle } from './filters/controls'

const MINIMUM_PRESETS = [20, 50, 100, 200, 500] as const
const LIMIT_PRESETS = [5, 10, 20, 50, 100] as const
const DISCOUNT_PRESETS = [10, 20, 30, 50, 80] as const
const CLEAR_LABEL = EMPTY_ACTION_LABEL['clear-filters']

const reaisOf = (cents: number | undefined) => (cents === undefined ? ANY : String(cents / CENTS_PER_REAL))
const TRIVIAL_NOTE_ID = 'coupon-trivial-note'

export function CouponFilterBar({ query, children }: { query: CouponQuery; children?: React.ReactNode }) {
  const router = useRouter()
  const go = (changes: Partial<CouponQuery>) => router.replace(couponHref(query, changes), { scroll: false })
  const active = activeCouponLabels(query)
  const showNote = query.order === DEFAULT_COUPON_SORT

  return (
    <section aria-label="Filtros" className="card relative mb-5 p-3 sm:p-3.5">
      {children && <div className="mb-3 flex flex-col gap-2 border-b border-[var(--color-line)] pb-3">{children}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <TextFilter
          label="Buscar por texto"
          activeLabel={active.text ?? null}
          title="Buscar no título, na loja ou nos produtos"
          inputLabel="Texto no título, na loja ou nos produtos"
          value={query.text ?? ANY}
          maxLength={SEARCH_TEXT_MAX}
          onApply={(raw) => go({ text: normalizeSearchText(raw) || undefined })}
        />
        <NumberFilter
          label={MINIMUM_MAX_LABEL}
          activeLabel={active.minimumMax ?? null}
          title={MINIMUM_MAX_LABEL}
          inputLabel={`${MINIMUM_MAX_LABEL} (R$)`}
          value={reaisOf(query.minimumMaxCents)}
          presets={MINIMUM_PRESETS}
          format={formatWholeReais}
          decimal
          onApply={(raw) => go({ minimumMaxCents: centsFromReais(raw) || undefined })}
        />
        <NumberFilter
          label="Limite mínimo"
          activeLabel={active.limitMin ?? null}
          title={LIMIT_MIN_LABEL}
          inputLabel={`${LIMIT_MIN_LABEL} (R$)`}
          value={reaisOf(query.limitMinCents)}
          presets={LIMIT_PRESETS}
          format={formatWholeReais}
          decimal
          onApply={(raw) => go({ limitMinCents: centsFromReais(raw) || undefined })}
        />
        <NumberFilter
          label={DISCOUNT_MIN_LABEL}
          activeLabel={active.discountMin ?? null}
          title={DISCOUNT_AT_MINIMUM_LABEL}
          inputLabel={`${DISCOUNT_AT_MINIMUM_LABEL} (%)`}
          value={query.discountMin ? String(query.discountMin) : ANY}
          presets={DISCOUNT_PRESETS}
          format={(n) => `${n}%`}
          onApply={(raw) => go({ discountMin: optionalNumber(raw) })}
        />
        <Toggle label={COUPON_WITH_OFFERS_LABEL} on={Boolean(query.withOffers)} onChange={(on) => go({ withOffers: on || undefined })} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-3">
        <label className="flex w-full flex-col items-start gap-1.5 text-[13px] sm:w-auto sm:flex-row sm:items-center sm:gap-2 font-medium text-[var(--color-ink-soft)]">
          Ordenar por
          <select
            aria-describedby={showNote ? TRIVIAL_NOTE_ID : undefined}
            value={query.order}
            onChange={(e) => go({ order: COUPON_SORTS.find((s) => s === e.target.value) })}
            className="field w-full cursor-pointer py-2 pr-7 text-[13px] sm:w-auto"
          >
            {COUPON_SORTS.map((sort) => (
              <option key={sort} value={sort}>{COUPON_SORT_LABEL[sort]}</option>
            ))}
          </select>
        </label>
        {showNote && (
          <p id={TRIVIAL_NOTE_ID} className="w-full text-[13px] text-[var(--color-ink-soft)]">{TRIVIAL_SAVING_NOTE}</p>
        )}
        {hasCouponFilters(query) && (
          <Link
            href={couponHref(query, CLEARED_COUPON_FILTERS)}
            scroll={false}
            className="text-[13px] font-medium text-[var(--color-brand-strong)] hover:underline"
          >
            {CLEAR_LABEL}
          </Link>
        )}
      </div>
    </section>
  )
}
