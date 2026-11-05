import Image from 'next/image'
import type { DealRow } from '@/db/deals'
import {
  basisLabel, compareLinkItems, couponChip, couponPartLine, discountLine, dropBadge, historyLine, MAX_COUPON_CHIPS, minimumGapLine, NO_HISTORY_TEXT, observedLine, priceCompareLines, priceDroppedLine, savingLines, sellerLine, siblingLine, soldLine,
} from '@/lib/deal-view'
import { formatCents } from '@/lib/format'
import { COMPARE_LINKS_LABEL, INFLATED_BADGE_LABEL, NEVER_PRACTICED_LABEL, NO_EQUIVALENT_TEXT, OPENS_IN_NEW_TAB_TEXT } from '@/lib/labels'
import { neverPracticedList } from '@/lib/price-history'
import { safeMlUrl } from '@/lib/ml-url'
import type { BadgeTone } from '@/lib/badge-tone'
import type { ItemStatus } from '@/lib/domain'
import { CompareButton } from './CompareButton'
import { StatusBadge } from './StatusBadge'
import { StatusButtons } from './StatusButtons'

const STATUS_BADGE: Record<ItemStatus, { tone: BadgeTone; label: string }> = {
  NOT_SEEN: { tone: 'badge-new', label: 'Novo' },
  SAVED: { tone: 'badge-saved', label: 'Salvo' },
  SEEN: { tone: 'badge-muted', label: 'Visto' },
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-[#eeece6] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-ink-soft)]">
      {children}
    </span>
  )
}

export function DealCard({ deal, now, eager }: { deal: DealRow; now: Date; eager: boolean }) {
  const titleId = `deal-${deal.id}-title`
  const compareRowId = `deal-${deal.id}-compare`
  const badge = STATUS_BADGE[deal.status]
  const discount = discountLine(deal.mlDiscountPct, deal.listPriceCents)
  const { saving, couponPrice, hint } = savingLines(deal)
  const history = historyLine(deal.history)
  const couponPart = couponPartLine(deal)
  const gap = minimumGapLine(deal, deal.coupons)
  const sold = soldLine(deal.soldQuantity)
  const seller = sellerLine(deal.sellerLabel)
  const href = deal.url ? safeMlUrl(deal.url) : null
  const drop = dropBadge(deal.dropRatio)
  const priceDropped = priceDroppedLine(deal.status, deal.seenPriceCents, deal.priceCents)
  const compare = priceCompareLines(deal.priceCheck)
  const sibling = siblingLine(deal.cheaperSibling)
  const siblingHref = sibling?.url ? safeMlUrl(sibling.url) : null
  const neverPracticed = neverPracticedList(deal.history, deal.listPriceCents, now)
  const compareLinks = compareLinkItems(deal.title)
  const chips = deal.coupons.slice(0, MAX_COUPON_CHIPS)
  const hiddenChips = deal.coupons.length - chips.length

  return (
    <li className="card flex gap-3 p-3 sm:gap-4 sm:p-4">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#eeece6] sm:h-28 sm:w-28">
        {deal.thumbnail && (
          <Image
            unoptimized
            src={deal.thumbnail}
            alt=""
            width={112}
            height={112}
            loading={eager ? 'eager' : 'lazy'}
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={badge.tone} label={badge.label} />
          {compare.inflated && <StatusBadge tone="badge-warn" label={INFLATED_BADGE_LABEL} />}
          {neverPracticed && <StatusBadge tone="badge-muted" label={NEVER_PRACTICED_LABEL} />}
          {deal.full && <Tag>FULL</Tag>}
          {deal.freeShipping && <Tag>Frete grátis</Tag>}
        </div>

        <h2 id={titleId} className="line-clamp-2 break-words text-[15px] font-semibold tracking-tight">{deal.title}</h2>

        <div>
          <p className="whitespace-nowrap font-mono text-lg font-semibold tracking-tight">{formatCents(deal.priceCents)}</p>
          <p className="text-[13px] text-[var(--color-ink-soft)]">{basisLabel(deal.basisText)}</p>
          {discount && <p className="text-[13px] font-medium text-[var(--color-brand-ink)]">{discount}</p>}
          {couponPrice && <p className="text-[13px] text-[var(--color-ink-soft)]">{couponPrice}</p>}
          {hint && <p className="text-[13px] text-[var(--color-ink-soft)]">{hint}</p>}
          {saving && <p className="text-[13px] font-semibold text-[var(--color-brand-ink)]">{saving}</p>}
          {couponPart && <p className="text-[13px] text-[var(--color-ink-soft)]">{couponPart}</p>}
          {gap && <p className="text-[13px] font-medium text-[var(--color-amber)]">{gap.text}</p>}
          {compare.line && (
            <p className={`text-[13px] ${compare.inflated ? 'font-medium text-[var(--color-danger)]' : 'text-[var(--color-ink-soft)]'}`}>{compare.line}</p>
          )}
          {sibling && (
            <p className="text-[13px] font-medium text-[var(--color-danger)]">
              {siblingHref ? (
                <a href={siblingHref} target="_blank" rel="noopener noreferrer" aria-describedby={titleId} className="underline">
                  {sibling.text}<span className="sr-only"> {OPENS_IN_NEW_TAB_TEXT}</span>
                </a>
              ) : sibling.text}
            </p>
          )}
        </div>

        {priceDropped && <StatusBadge tone="badge-new" label={priceDropped} />}
        {drop && <StatusBadge tone="badge-new" label={drop} />}
        {deal.dropRatio === null && !history && <p className="text-[13px] text-[var(--color-ink-soft)]">{NO_HISTORY_TEXT}</p>}
        {history && <p className="text-[13px] text-[var(--color-ink-soft)]">{history}</p>}

        <div className="flex flex-wrap gap-x-3 text-[13px] text-[var(--color-ink-soft)]">
          <p>{observedLine(deal.observedAt, now)}</p>
          {sold && <p>{sold}</p>}
          {seller && <p className="min-w-0 break-words">{seller}</p>}
        </div>

        {(compareLinks.length > 0 || deal.priceCheck === null || compare.noEquivalent) && (
          <div id={compareRowId} tabIndex={-1} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--color-ink-soft)]">
            {compareLinks.length > 0 && (
              <>
                <span>{COMPARE_LINKS_LABEL}:</span>
                {compareLinks.map((link) => (
                  <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" aria-describedby={titleId} className="underline">
                    {link.label}<span className="sr-only"> {OPENS_IN_NEW_TAB_TEXT}</span>
                  </a>
                ))}
              </>
            )}
            {compare.noEquivalent && <span>{NO_EQUIVALENT_TEXT}</span>}
            <CompareButton id={deal.id} titleId={titleId} rowId={compareRowId} matched={deal.priceCheck?.status === 'matched'} />
          </div>
        )}

        {chips.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Cupons ligados">
            {chips.map((coupon) => {
              const chip = couponChip(coupon, deal.priceCents, coupon.campaignId === gap?.couponId)
              return (
                <li key={coupon.campaignId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="break-words rounded-md bg-[var(--color-brand-soft)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--color-brand-ink)]">
                    {chip.text}
                  </span>
                  {chip.minimum && coupon.campaignId !== gap?.couponId && (
                    <span className="rounded-md bg-[var(--color-amber-soft)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--color-amber)]">
                      {chip.minimum}
                    </span>
                  )}
                </li>
              )
            })}
            {hiddenChips > 0 && (
              <li className="text-[12px] text-[var(--color-ink-soft)]">e mais {hiddenChips}</li>
            )}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <StatusButtons id={deal.id} status={deal.status} titleId={titleId} />
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={titleId}
              className="btn btn-ghost"
            >
              Ver no Mercado Livre<span className="sr-only"> {OPENS_IN_NEW_TAB_TEXT}</span>
            </a>
          )}
        </div>
      </div>
    </li>
  )
}
