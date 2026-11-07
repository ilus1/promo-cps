import Link from 'next/link'
import { notFound } from 'next/navigation'
import { watchedProduct } from '@/db/watch-products'
import { AppHeader } from '@/components/AppHeader'
import { WatchActions } from '@/components/WatchActions'
import { WatchBestPrice } from '@/components/WatchBestPrice'
import { WatchListings } from '@/components/WatchListings'
import { WatchProductName } from '@/components/WatchProductName'
import { WatchSettingsForm } from '@/components/WatchSettingsForm'
import { BACK_TO_PRODUCTS_LABEL } from '@/lib/labels'
import { ROUTES } from '@/lib/routes'
import { alertsText, eanText, emptyListingsText, listingRows, productHeading, productSummary, settingsDraftOf, stopConfirmText } from '@/lib/watch/view'

export const dynamic = 'force-dynamic'

const BEST_SECTION_TITLE = 'Menor preço agora'
const TITLE_ID = 'product-title'
const BEST_TITLE_ID = 'product-best-title'

export default async function ProdutoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const now = new Date()
  const product = await watchedProduct(id, now)
  if (!product) notFound()
  const summary = productSummary(product, now)
  const ean = eanText(product)
  const heading = productHeading(product.name, product.resolvedAt)

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[920px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <p className="mb-3 text-sm">
          <Link href={ROUTES.products} className="text-[var(--color-ink-soft)] underline-offset-2 hover:text-[var(--color-brand-strong)] hover:underline">
            {BACK_TO_PRODUCTS_LABEL}
          </Link>
        </p>
        <div className="mb-5">
          <WatchProductName heading={heading} id={TITLE_ID} level="h1" className="text-2xl font-semibold tracking-tight" />
          {ean && <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{ean}</p>}
        </div>

        <section className="card flex flex-col gap-4 p-5" aria-labelledby={BEST_TITLE_ID}>
          <h2 id={BEST_TITLE_ID} className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">{BEST_SECTION_TITLE}</h2>
          <div className="flex flex-col gap-1">
            <WatchBestPrice summary={summary} large />
            <p className="text-[13px] text-[var(--color-ink-soft)]">{summary.checked}</p>
          </div>
          <div className="border-t border-[var(--color-line)] pt-4">
            <WatchActions id={product.id} stopConfirm={stopConfirmText(heading)} describedBy={TITLE_ID} />
          </div>
        </section>

        <WatchListings rows={listingRows(product, now)} emptyText={emptyListingsText(product)} />

        <WatchSettingsForm id={product.id} initial={settingsDraftOf(product)} summary={alertsText(product)} />
      </main>
    </>
  )
}
