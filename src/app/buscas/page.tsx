import { AppHeader } from '@/components/AppHeader'
import { listSearches } from '@/db/searches'
import { buscaActivity } from '@/ingestion/search-run'
import { lastRunView } from '@/lib/busca-view'
import { BUSCA_TERM_PARAM } from '@/lib/labels'
import { searchTextOf } from '@/lib/text-search'
import { SearchAdmin } from './SearchAdmin'

export const dynamic = 'force-dynamic'

export default async function BuscasPage({ searchParams }: { searchParams: Promise<{ [BUSCA_TERM_PARAM]?: string | string[] }> }) {
  const initialTerm = searchTextOf((await searchParams)[BUSCA_TERM_PARAM]) ?? ''
  const now = new Date()
  const items = (await listSearches()).map((search) => ({
    search,
    activity: buscaActivity(search.id),
    lastRun: lastRunView(search, now),
  }))
  return (
    <>
      <AppHeader />
      <SearchAdmin items={items} initialTerm={initialTerm} />
    </>
  )
}
