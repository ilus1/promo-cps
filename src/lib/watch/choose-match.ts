import type { MatchConfidence } from '../domain'
import { matchCandidates } from '../price-compare/match'
import type { MarketCard } from '../market/types'
import { foldAccents } from '../text-search'
import { sameGtin, validEan } from './ean'
import type { ChosenMatch, ListingCandidate } from './types'

export interface WatchedIdentity { name: string; ean: string | null }

export interface MatchOptions { searchedByEan: boolean }

type ColorFit = 'same' | 'unstated' | 'conflict'

const HIGH = 'high'
const SINGLE_STORE = 1
const WORD_SEPARATOR = /[^a-z0-9]+/
const COLOR_OF: ReadonlyMap<string, string> = new Map([
  ['preto', 'preto'], ['preta', 'preto'], ['black', 'preto'],
  ['branco', 'branco'], ['branca', 'branco'], ['white', 'branco'],
  ['azul', 'azul'], ['blue', 'azul'],
  ['vermelho', 'vermelho'], ['vermelha', 'vermelho'], ['red', 'vermelho'],
  ['verde', 'verde'], ['green', 'verde'],
  ['amarelo', 'amarelo'], ['amarela', 'amarelo'], ['yellow', 'amarelo'],
  ['rosa', 'rosa'], ['pink', 'rosa'],
  ['roxo', 'roxo'], ['roxa', 'roxo'], ['lilas', 'roxo'], ['purple', 'roxo'],
  ['cinza', 'cinza'], ['grafite', 'cinza'], ['gray', 'cinza'], ['grey', 'cinza'],
  ['prata', 'prata'], ['prateado', 'prata'], ['prateada', 'prata'], ['silver', 'prata'],
  ['dourado', 'dourado'], ['dourada', 'dourado'], ['gold', 'dourado'],
  ['laranja', 'laranja'], ['orange', 'laranja'],
  ['bege', 'bege'], ['marrom', 'marrom'], ['vinho', 'vinho'],
])

function cardOf(candidate: ListingCandidate): MarketCard {
  return { name: candidate.title, priceCents: candidate.priceCents, store: candidate.retailer, storeCount: SINGLE_STORE, url: candidate.url }
}

function colorsOf(text: string): Set<string> {
  const words = foldAccents(text).toLowerCase().split(WORD_SEPARATOR)
  return new Set(words.flatMap((word) => {
    const color = COLOR_OF.get(word)
    return color ? [color] : []
  }))
}

function colorFit(name: string, candidate: ListingCandidate): ColorFit {
  const wanted = colorsOf(name)
  const found = colorsOf(candidate.title)
  if (wanted.size === 0 || found.size === 0) return 'unstated'
  return [...found].some((color) => wanted.has(color)) ? 'same' : 'conflict'
}

export function candidateConfidence(name: string, candidate: ListingCandidate): MatchConfidence | null {
  if (colorFit(name, candidate) === 'conflict') return null
  return matchCandidates(name, candidate.priceCents, [cardOf(candidate)]).confidence
}

function cheapest(candidates: ListingCandidate[]): ListingCandidate | null {
  const pool = candidates.some((candidate) => candidate.inStock) ? candidates.filter((candidate) => candidate.inStock) : candidates
  return pool.reduce<ListingCandidate | null>((best, candidate) => (best === null || candidate.priceCents < best.priceCents ? candidate : best), null)
}

function barcodeHit(ean: string | null, candidates: ListingCandidate[]): ListingCandidate | null {
  if (ean === null) return null
  return cheapest(candidates.filter((candidate) => {
    const candidateEan = validEan(candidate.ean)
    return candidateEan !== null && sameGtin(candidateEan, ean)
  }))
}

function otherBarcode(ean: string | null, candidate: ListingCandidate): boolean {
  const candidateEan = validEan(candidate.ean)
  return ean !== null && candidateEan !== null && !sameGtin(candidateEan, ean)
}

function eanSearchHit(name: string, ean: string | null, top: ListingCandidate | undefined): ListingCandidate | null {
  if (!top || otherBarcode(ean, top)) return null
  return candidateConfidence(name, top) !== null ? top : null
}

function autoHit(name: string, ean: string | null, candidates: ListingCandidate[]): ListingCandidate | null {
  const high = candidates.filter((candidate) => !otherBarcode(ean, candidate) && candidateConfidence(name, candidate) === HIGH)
  const sameColor = high.filter((candidate) => colorFit(name, candidate) === 'same')
  return cheapest(sameColor.length > 0 ? sameColor : high)
}

export function chooseMatch(product: WatchedIdentity, candidates: ListingCandidate[], { searchedByEan }: MatchOptions): ChosenMatch | null {
  const ean = validEan(product.ean)
  const exact = barcodeHit(ean, candidates)
  if (exact) return { candidate: exact, match: 'barcode' }
  const searched = searchedByEan ? eanSearchHit(product.name, ean, candidates[0]) : null
  if (searched) return { candidate: searched, match: 'barcode' }
  const auto = autoHit(product.name, ean, candidates)
  return auto ? { candidate: auto, match: 'auto' } : null
}
