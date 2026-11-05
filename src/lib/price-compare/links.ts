import { AMAZON_SEARCH_URL, BUSCAPE_SEARCH_URL, GOOGLE_SHOPPING_URL, MAGALU_SEARCH_URL } from '../constants'
import { cleanTitle, rawTitleWords } from './clean-title'

export type CompareLinks = {
  buscape: string
  googleShopping: string
  amazon: string
  magalu: string
}

function joined(words: string[], separator: string): string {
  return words.map(encodeURIComponent).join(separator)
}

export function compareLinks(title: string): CompareLinks | null {
  const cleaned = cleanTitle(title)
  const words = cleaned.length > 0 ? cleaned : rawTitleWords(title)
  if (words.length === 0) return null
  const plus = joined(words, '+')
  return {
    buscape: `${BUSCAPE_SEARCH_URL}${plus}`,
    googleShopping: `${GOOGLE_SHOPPING_URL}${plus}`,
    amazon: `${AMAZON_SEARCH_URL}${plus}`,
    magalu: `${MAGALU_SEARCH_URL}${joined(words, '-')}/`,
  }
}
