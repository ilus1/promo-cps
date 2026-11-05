import { FILLER_WORDS } from '@/lib/price-compare/clean-title'
import { titleTerms, type TitleTerms } from '@/lib/price-compare/match'
import type { RetrievalTerms } from './types'

const SOLE_ANCHOR_WORD = 1

export function offerTokens(title: string): string[] {
  return titleTerms(title).tokens.filter((token) => !FILLER_WORDS.has(token))
}

function anchorPool({ modelWords, hardSizes, numbers }: TitleTerms): string[] {
  if (modelWords.length > 0) return modelWords
  return hardSizes.length > 0 ? hardSizes : numbers
}

export function retrievalTerms(mlTitle: string): RetrievalTerms {
  const terms = titleTerms(mlTitle)
  const pool = anchorPool(terms)
  if (pool.length === SOLE_ANCHOR_WORD) return { all: [...terms.nameWords, ...pool], any: [] }
  return { all: terms.nameWords, any: pool }
}

export function hasRetrievalTerms({ all, any }: RetrievalTerms): boolean {
  return all.length > 0 || any.length > 0
}

export function retrieves({ all, any }: RetrievalTerms, tokens: ReadonlySet<string>): boolean {
  return all.every((term) => tokens.has(term)) && (any.length === 0 || any.some((term) => tokens.has(term)))
}
