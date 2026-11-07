import type { CouponListRow } from '@/db/coupons'
import type { CouponListStatus } from '@/lib/domain'
import { couponLabel } from '@/lib/coupon-label'
import { discountAtMinimum, effectiveLimitCents, fullPercentUpTo, isUnboundedSaving, maxSavingCents } from '@/lib/coupon-value'
import { formatCents, formatDate, formatPercent } from '@/lib/format'
import type { BadgeTone } from '@/lib/badge-tone'
import {
  COUPON_SCOPE_LABEL, COUPON_STATUS_LABEL, DISCOUNT_AT_MINIMUM_LABEL, NO_EXPIRY_TEXT, NO_VALUE, OPENS_IN_NEW_TAB_TEXT, UNCAPPED_TEXT,
} from '@/lib/labels'
import { Fact } from './Fact'
import { StatusBadge } from './StatusBadge'

const STATUS_BADGE: Record<CouponListStatus, BadgeTone> = {
  active: 'badge-new',
  inactive: 'badge-saved',
  ended: 'badge-muted',
}

function moneyOrUnbounded(cents: number | null, unbounded: boolean): string {
  if (cents !== null) return formatCents(cents)
  return unbounded ? UNCAPPED_TEXT : NO_VALUE
}

function DiscountLine({ coupon }: { coupon: CouponListRow }) {
  const ratio = discountAtMinimum(coupon.kind, coupon.percentOff, coupon.amountOffCents, coupon.minPaymentCents, coupon.capCents)
  const upTo = coupon.kind === 'percent' ? fullPercentUpTo(coupon.percentOff, coupon.capCents) : null
  const saving = maxSavingCents(coupon.kind, coupon.amountOffCents, coupon.capCents)
  const unbounded = isUnboundedSaving(coupon.kind, coupon.capCents)
  return (
    <p className="text-sm text-[var(--color-ink)]">
      {DISCOUNT_AT_MINIMUM_LABEL}:{' '}
      <strong className="font-semibold">{ratio === null ? NO_VALUE : formatPercent(ratio)}</strong>
      {upTo !== null && <span className="text-[var(--color-ink-soft)]">, rende até {formatCents(upTo)}</span>}
      <br />
      Economia máxima:{' '}
      <strong className="font-semibold">
        {moneyOrUnbounded(saving, unbounded)}
      </strong>
    </p>
  )
}

export function CouponRow({ coupon }: { coupon: CouponListRow }) {
  const titleId = `coupon-${coupon.campaignId}-title`
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="break-words text-[15px] font-semibold tracking-tight">{couponLabel(coupon)}</h2>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{COUPON_SCOPE_LABEL[coupon.isStore ? 'store' : 'ml']}</p>
        </div>
        <StatusBadge tone={STATUS_BADGE[coupon.listStatus]} label={COUPON_STATUS_LABEL[coupon.listStatus]} />
      </div>

      <DiscountLine coupon={coupon} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Fact label="Compra mínima">{coupon.minPaymentCents === null ? NO_VALUE : formatCents(coupon.minPaymentCents)}</Fact>
        <Fact label="Limite">{moneyOrUnbounded(effectiveLimitCents(coupon.kind, coupon.amountOffCents, coupon.capCents), isUnboundedSaving(coupon.kind, coupon.capCents))}</Fact>
        <Fact label="Validade">{coupon.expiresAt ? formatDate(coupon.expiresAt) : NO_EXPIRY_TEXT}</Fact>
      </dl>

      {coupon.activationError && coupon.listStatus !== 'active' && (
        <p className="self-start rounded-lg bg-[var(--color-danger-soft)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-danger)]">
          Falha ao ativar: {coupon.activationError}
        </p>
      )}

      {coupon.listingUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={coupon.listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={titleId}
            className="btn btn-ghost"
          >
            Ver no ML<span className="sr-only"> {OPENS_IN_NEW_TAB_TEXT}</span>
          </a>
        </div>
      )}
    </li>
  )
}
