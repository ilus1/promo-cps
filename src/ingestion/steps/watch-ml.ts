import type { Page } from 'playwright'
import { removedRefs } from '@/db/monitoring'
import { liveListingsOf, recordListingError, recordListingGone, recordQuote, upsertListing } from '@/db/watch-listings'
import { activeProducts, updateProduct } from '@/db/watch-products'
import { CYCLE_COUNT } from '@/lib/cycle-counts'
import type { HoldKind } from '@/lib/request-hold'
import { ML_RETAILER } from '@/lib/watch/types'
import { readProductPage } from '../ml/product'
import { loadWithRetry } from '../ml/page-state'
import { readSearchPage } from '../ml/search-page'
import { requestHold } from '../request-hold'
import { checkAlerts } from '../watch/price-alerts'
import type { LoadBreaker } from './breaker'
import { mlEanMisses, mlLinkFailures, watchMlProducts, type MlListingRow, type WatchMlIo, type WatchMlResult } from './watch-ml-pages'

export interface WatchMlStep extends WatchMlResult { counts: Record<string, number> }

const PRICE_PAUSE: HoldKind = 'price_manual'

async function mlListings(productIds: string[]): Promise<MlListingRow[]> {
  const rows = await liveListingsOf(productIds)
  return rows.flatMap((row) => (row.retailer === ML_RETAILER
    ? [{ id: row.id, productId: row.productId, ref: row.ref, url: row.url, match: row.match, lastError: row.lastError, checkedAt: row.checkedAt }]
    : []))
}

function ioFor(page: Page, breaker: LoadBreaker): WatchMlIo {
  return {
    eanMisses: mlEanMisses(),
    linkFailures: mlLinkFailures(),
    paused: async () => (await requestHold(new Date()))?.kind === PRICE_PAUSE,
    products: activeProducts,
    mlListings,
    removedRefs,
    load: (url) => breaker.load(() => loadWithRetry(page, url)),
    loadLink: (url) => breaker.loadUncounted(() => loadWithRetry(page, url)),
    readSearch: readSearchPage,
    readProduct: readProductPage,
    upsert: upsertListing,
    recordQuote,
    recordError: recordListingError,
    recordGone: recordListingGone,
    update: updateProduct,
    alerts: (productId, now) => checkAlerts(productId, now),
    now: () => new Date(),
  }
}

export async function watchMl(page: Page, breaker: LoadBreaker): Promise<WatchMlStep> {
  const result = await watchMlProducts(ioFor(page, breaker))
  return {
    ...result,
    counts: {
      [CYCLE_COUNT.watchProducts]: result.products,
      [CYCLE_COUNT.watchMatched]: result.matched,
      [CYCLE_COUNT.watchFailed]: result.failed,
      [CYCLE_COUNT.watchPages]: result.pages,
      [CYCLE_COUNT.watchEmpty]: result.empty,
      [CYCLE_COUNT.watchCards]: result.cards,
      [CYCLE_COUNT.watchDropped]: result.dropped,
      [CYCLE_COUNT.watchSkipped]: result.skipped,
    },
  }
}
