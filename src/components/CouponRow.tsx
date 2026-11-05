import Image from 'next/image'
import Link from 'next/link'
import type { CouponListRow } from '@/db/coupons'
import type { CouponListStatus } from '@/lib/domain'
import { couponLabel } from '@/lib/coupon-label'
import { selectPreviews } from '@/lib/coupon-preview'
import { discountAtMinimum, effectiveLimitCents, fullPercentUpTo, isUnboundedSaving, maxSavingCents } from '@/lib/coupon-value'
import { formatAgo, formatCents, formatDate, formatPercent } from '@/lib/format'
import type { BadgeTone } from '@/lib/badge-tone'
import {
  COUPON_PREVIEWS_LABEL, COUPON_SCOPE_LABEL, COUPON_STATUS_LABEL, DISCOUNT_AT_MINIMUM_LABEL, NO_EXPIRY_TEXT, NO_LINKED_OFFERS_TEXT,
  OPENS_IN_NEW_TAB_TEXT, UNCAPPED_TEXT,
} from '@/lib/labels'
import { offersByCouponHref } from '@/lib/deal-query'
import { isDiscoveryPending } from '@/lib/coupon-order'
import { PRIORITY_BADGE_LABEL } from '@/lib/priority-view'
import { StatusBadge } from './StatusBadge'

const NEVER_DISCOVERED = 'nunca'
const NO_VALUE = '-'

const STATUS_BADGE: Record<CouponListStatus, BadgeTone> = {
  active: 'badge-new',
  inactive: 'badge-saved',
  ended: 'badge-muted',
}

const PREVIEW_SIZE_PX = 64

function Previews({ coupon, text }: { coupon: CouponListRow; text?: string }) {
  const shown = selectPreviews(coupon.previews, text)
  if (shown.length === 0) return null
  return (
    <ul aria-label={COUPON_PREVIEWS_LABEL} className="flex flex-wrap gap-2">
      {shown.map((preview, index) => (
        <li key={`${index}-${preview.src}`} className="overflow-hidden rounded-lg bg-[#eeece6]" style={{ width: PREVIEW_SIZE_PX, height: PREVIEW_SIZE_PX }}>
          <Image
            unoptimized
            src={preview.src}
            alt={preview.alt}
            title={preview.alt}
            width={PREVIEW_SIZE_PX}
            height={PREVIEW_SIZE_PX}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain"
          />
        </li>
      ))}
    </ul>
  )
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="text-sm text-[var(--color-ink)]">{children}</dd>
    </div>
  )
}

export function CouponRow({ coupon, now, text }: { coupon: CouponListRow; now: Date; text?: string }) {
  const titleId = `coupon-${coupon.campaignId}-title`
  const pending = coupon.listStatus !== 'ended' && coupon.listingUrl !== null && isDiscoveryPending(coupon)
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="break-words text-[15px] font-semibold tracking-tight">{couponLabel(coupon)}</h2>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{COUPON_SCOPE_LABEL[coupon.isStore ? 'store' : 'ml']}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {pending && <StatusBadge tone="badge-saved" label={PRIORITY_BADGE_LABEL} />}
          <StatusBadge tone={STATUS_BADGE[coupon.listStatus]} label={COUPON_STATUS_LABEL[coupon.listStatus]} />
        </div>
      </div>

      <Previews coupon={coupon} text={text} />

      <DiscountLine coupon={coupon} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        <Fact label="Compra mínima">{coupon.minPaymentCents === null ? NO_VALUE : formatCents(coupon.minPaymentCents)}</Fact>
        <Fact label="Limite">{moneyOrUnbounded(effectiveLimitCents(coupon.kind, coupon.amountOffCents, coupon.capCents), isUnboundedSaving(coupon.kind, coupon.capCents))}</Fact>
        <Fact label="Validade">{coupon.expiresAt ? formatDate(coupon.expiresAt) : NO_EXPIRY_TEXT}</Fact>
        <Fact label="Ofertas ligadas">
          <span className="font-mono">{coupon.linkedItems}</span>
        </Fact>
        <Fact label="Última busca de ofertas">
          {coupon.lastDiscoveredAt ? formatAgo(coupon.lastDiscoveredAt, now) : NEVER_DISCOVERED}
        </Fact>
      </dl>

      {coupon.activationError && coupon.listStatus !== 'active' && (
        <p className="self-start rounded-lg bg-[var(--color-danger-soft)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-danger)]">
          Falha ao ativar: {coupon.activationError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {coupon.linkedItems > 0 ? (
          <Link
            href={offersByCouponHref(coupon.campaignId)}
            aria-describedby={titleId}
            className="btn btn-ghost"
          >
            Ver ofertas
          </Link>
        ) : (
          <p className="text-[13px] text-[var(--color-ink-soft)]">{NO_LINKED_OFFERS_TEXT}</p>
        )}
        {coupon.listingUrl && (
          <a
            href={coupon.listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={titleId}
            className="btn btn-ghost"
          >
            Ver no ML<span className="sr-only"> {OPENS_IN_NEW_TAB_TEXT}</span>
          </a>
        )}
      </div>
    </li>
  )
}
