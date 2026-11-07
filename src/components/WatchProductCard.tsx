import Link from 'next/link'
import { productHref } from '@/lib/routes'
import type { WatchProductView } from '@/lib/watch/types'
import { productHeading, productSummary } from '@/lib/watch/view'
import { WatchBestPrice } from './WatchBestPrice'
import { WatchProductName } from './WatchProductName'

const DETAILS_LABEL = 'Ver detalhes'

export function WatchProductCard({ product, now }: { product: WatchProductView; now: Date }) {
  const titleId = `product-${product.id}-title`
  const summary = productSummary(product, now)
  return (
    <li className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <WatchProductName heading={productHeading(product.name, product.resolvedAt)} id={titleId} level="h3" className="text-[15px] font-semibold tracking-tight" />
        <WatchBestPrice summary={summary} />
        <div className="flex flex-wrap gap-x-3 text-[13px] text-[var(--color-ink-soft)]">
          <p>{summary.checked}</p>
          {summary.listings && <p>{summary.listings}</p>}
        </div>
      </div>
      <Link href={productHref(product.id)} aria-describedby={titleId} className="btn btn-ghost self-start">
        {DETAILS_LABEL}
      </Link>
    </li>
  )
}
