import { expect, test, vi } from 'vitest'
import type { DuePage, ListingPage, ListingUpsert } from '@/db/watch-listings'
import type { ListingQuote } from '@/lib/watch/types'
import { refreshPass, type RefreshDeps } from './refresh'
import { resolveProduct, type ResolveDeps, type ResolveStep } from './resolve'
import type { GateResult } from './site-gate'
import type { WatchSources } from './sources'

const NOW = new Date('2026-11-06T12:00:00Z')
const ID = '0b9d0c52-1c3f-4a56-9a0e-5d8c7c4b2f11'
const REF = 'fone-de-ouvido/jbl-tune-520bt'
const LINK = `https://www.buscape.com.br/${REF}`
const TITLE = 'Fone de Ouvido JBL Tune 520BT Bluetooth Preto'
const EMPTY: GateResult<never> = { kind: 'empty', reason: 'nenhum resultado' }

const quote: ListingQuote = { ref: REF, merchant: 'Want Import', title: TITLE, priceCents: 29_990, listPriceCents: null, finalCents: 29_990, inStock: true }

test('a pasted Buscapé link reads its page unfiltered, and once named every refresh filters the page by that name', async () => {
  const names = new Map([[ID, LINK]])
  const pages: DuePage[] = []
  const buscapeQuotes = vi.fn(async (): Promise<GateResult<ListingQuote[]>> => ({ kind: 'ok', value: [quote] }))
  const sources = {
    buscapeQuotes,
    americanasByEan: vi.fn(async () => EMPTY),
    americanasByText: vi.fn(async () => EMPTY),
    amazonSearch: vi.fn(async () => EMPTY),
    kabumSearch: vi.fn(async () => EMPTY),
  } as unknown as WatchSources
  const recordPageQuotes = vi.fn(async (productId: string, page: ListingPage): Promise<ListingUpsert[]> => {
    if (!pages.some((known) => known.productId === productId && known.ref === page.ref)) pages.push({ ...page, productId })
    return [{ id: 'merchant-row', status: 'inserted' }]
  })
  const resolveDeps: ResolveDeps = {
    sources,
    chrome: { during: (work) => work() },
    due: vi.fn(async () => []),
    upsert: vi.fn(async (): Promise<ListingUpsert> => ({ id: 'x', status: 'inserted' })),
    recordQuote: vi.fn(async () => undefined),
    recordPageQuotes,
    recordError: vi.fn(async () => undefined),
    recordPageError: vi.fn(async () => undefined),
    update: vi.fn(async (id: string, patch) => {
      if (patch.name) names.set(id, patch.name)
      return true
    }),
    markResolved: vi.fn(async () => undefined),
    removedRefs: vi.fn(async () => new Map()),
    mlLinksGone: vi.fn(async () => new Set<string>()),
    alerts: vi.fn(async () => 0),
    now: () => NOW,
    log: vi.fn(),
  }
  const done = new Set<ResolveStep>()
  await resolveProduct({ id: ID, name: LINK, query: LINK, ean: null, eanSource: null, resolvedAt: null }, done, resolveDeps)
  expect(buscapeQuotes).toHaveBeenNthCalledWith(1, REF, null)
  expect(names.get(ID)).toBe(TITLE)

  const refreshDeps: RefreshDeps = {
    sources,
    chrome: { during: (work) => work() },
    dueListings: vi.fn(async () => []),
    duePages: vi.fn(async () => [...pages]),
    recordQuote: vi.fn(async () => undefined),
    recordPageQuotes,
    recordError: vi.fn(async () => undefined),
    recordPageError: vi.fn(async () => undefined),
    productNames: vi.fn(async (ids: string[]) => new Map(ids.flatMap((id) => (names.has(id) ? [[id, names.get(id) as string] as const] : [])))),
    alerts: vi.fn(async () => 0),
    now: () => NOW,
  }
  await refreshPass(refreshDeps)
  expect(buscapeQuotes).toHaveBeenLastCalledWith(REF, TITLE)
})
