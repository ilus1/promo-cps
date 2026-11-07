export interface ListingState { inStock: boolean | null; finalCents: number | null; lastError: string | null }

export function quotesPrice<Listing extends ListingState>(listing: Listing): listing is Listing & { finalCents: number } {
  return listing.inStock === true && listing.finalCents !== null && listing.lastError === null
}
