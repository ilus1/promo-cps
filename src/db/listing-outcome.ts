export const ML_LINK_GONE = 'O anúncio do link não existe mais no Mercado Livre. Remova-o para buscar outro.'

export type ListingUpsertStatus = 'inserted' | 'updated' | 'kept' | 'removed'

export interface ListingUpsert { id: string; status: ListingUpsertStatus }

const QUOTED_STATUSES: ReadonlySet<ListingUpsertStatus> = new Set(['inserted', 'updated'])

export function takesQuote(outcome: ListingUpsert): boolean {
  return QUOTED_STATUSES.has(outcome.status)
}
