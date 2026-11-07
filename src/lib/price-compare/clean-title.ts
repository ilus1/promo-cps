import { COMPARE_QUERY_MAX_WORDS } from '../constants'
import { foldAccents } from '../text-search'

export const FILLER_WORDS: ReadonlySet<string> = new Set([
  'para', 'com', 'de', 'da', 'do', 'e', 'oferta', 'original', 'envio', 'rapido',
  'promocao', 'lancamento', 'novo', 'kit', 'frete', 'gratis',
])

const WORD_SEPARATORS = /[\s/]+/
const EDGE_PUNCTUATION = /^[^a-z0-9]+|[^a-z0-9]+$/g
const SHIPPING_BIGRAM = /\benvio full\b/g

function foldedWords(text: string): string[] {
  return text
    .split(WORD_SEPARATORS)
    .map((word) => word.replace(EDGE_PUNCTUATION, ''))
    .filter(Boolean)
}

export function cleanTitle(title: string): string[] {
  const folded = foldAccents(title).toLowerCase().replace(SHIPPING_BIGRAM, ' ')
  return foldedWords(folded).filter((word) => !FILLER_WORDS.has(word)).slice(0, COMPARE_QUERY_MAX_WORDS)
}

export function compareQuery(title: string): string {
  return cleanTitle(title).join(' ')
}
