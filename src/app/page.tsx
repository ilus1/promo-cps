import { listWatchedProducts } from '@/db/watch-products'
import { AppHeader } from '@/components/AppHeader'
import { EmptyCard } from '@/components/EmptyCard'
import { StoppedNotice } from '@/components/StoppedNotice'
import { WatchAddForm } from '@/components/WatchAddForm'
import { WatchProductCard } from '@/components/WatchProductCard'
import { WATCH_REFRESH_HOURS } from '@/lib/constants'
import { PRODUCTS_LABEL } from '@/lib/labels'
import type { QueryParams } from '@/lib/query-params'
import { isStopped, STOPPED_PARAM } from '@/lib/routes'
import { PRODUCTS_EMPTY_TEXT, PRODUCTS_LIST_TITLE, productsCountLine, WATCH_STOPPED_TEXT } from '@/lib/watch/view'

export const dynamic = 'force-dynamic'

export default async function ProdutosPage({ searchParams }: { searchParams: Promise<QueryParams> }) {
  const stopped = isStopped((await searchParams)[STOPPED_PARAM])
  const now = new Date()
  const products = await listWatchedProducts(now)

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[920px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">{PRODUCTS_LABEL}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{productsCountLine(products.length, WATCH_REFRESH_HOURS)}</p>
        </div>

        {stopped && <StoppedNotice text={WATCH_STOPPED_TEXT} />}

        <WatchAddForm />

        <h2 className="sr-only">{PRODUCTS_LIST_TITLE}</h2>
        {products.length === 0 ? (
          <EmptyCard text={PRODUCTS_EMPTY_TEXT} />
        ) : (
          <ul className="flex flex-col gap-3">
            {products.map((product) => (
              <WatchProductCard key={product.id} product={product} now={now} />
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
