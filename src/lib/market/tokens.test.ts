import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matchCandidates, titleTerms } from '@/lib/price-compare/match'
import { FIXTURE_EXPECTATIONS, HIGH_PAIRS, MEDIUM_PAIRS, REJECTED_PAIRS } from '@/lib/price-compare/match-labels'
import { parseAmazonBestsellers, parseAmazonSearch } from './parse-amazon'
import { parseKabumListing } from './parse-kabum'
import { hasRetrievalTerms, offerTokens, retrievalTerms, retrieves } from './tokens'
import type { MarketCard, MarketOffer } from './types'

const MATCH_FIXTURES = join(__dirname, '..', 'price-compare', '__fixtures__')
const CARDS_SUFFIX = '.cards.json'
const NOW = new Date('2026-11-04T21:00:00Z')
const ANY_PRICE = 10_000
const marketFixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')

function cardNamesOf(fixture: string): string[] {
  const cards: MarketCard[] = JSON.parse(readFileSync(join(MATCH_FIXTURES, fixture), 'utf8'))
  return cards.map((card) => card.name)
}

const CATALOG: MarketOffer[] = [
  parseKabumListing(200, marketFixture('kabum-smartphones.html'), 'https://www.kabum.com.br/celular-smartphone/smartphones', NOW),
  parseAmazonSearch(200, marketFixture('amazon-search-a55.html')),
  parseAmazonBestsellers(200, marketFixture('amazon-bestsellers-electronics.html'), 'https://www.amazon.com.br/gp/bestsellers/electronics'),
].flatMap((page) => (page.kind === 'results' ? page.offers : []))

const HIGH_CANDIDATES: [string, string][] = [
  ...HIGH_PAIRS.map(([ml, , name]): [string, string] => [ml, name]),
  ...FIXTURE_EXPECTATIONS.flatMap(({ fixture, title, high }) => {
    const names = cardNamesOf(`${fixture}${CARDS_SUFFIX}`)
    return high.map((index): [string, string] => [title, names[index]])
  }),
]

const FIXTURE_TITLES = [...new Set([
  ...readdirSync(MATCH_FIXTURES).filter((name) => name.endsWith(CARDS_SUFFIX)).flatMap(cardNamesOf),
  ...CATALOG.map((offer) => offer.title),
  ...[...HIGH_PAIRS, ...MEDIUM_PAIRS, ...REJECTED_PAIRS].flatMap(([ml, , name]) => [ml, name]),
])]

const cardOf = (name: string, priceCents: number): MarketCard => ({ name, priceCents, store: 'Loja', storeCount: 1, url: 'https://www.kabum.com.br/x' })

function acceptedNames(mlTitle: string, candidates: string[]): string[] {
  const accepted: string[] = []
  let remaining = candidates.map((name) => cardOf(name, ANY_PRICE))
  for (;;) {
    const match = matchCandidates(mlTitle, ANY_PRICE, remaining)
    if (match.confidence === null) return accepted
    const names = new Set(match.offers.map((offer) => offer.name))
    accepted.push(...names)
    if (match.confidence === 'medium') return accepted
    remaining = remaining.filter((card) => !names.has(card.name))
  }
}

describe('offerTokens', () => {
  it('uses the matcher normalization, with sizes and model words joined', () => {
    expect(offerTokens('Smartphone Samsung Galaxy A-55 5G 256GB Azul')).toEqual(['smartphone', 'samsung', 'galaxy', 'a55', 'azul', '5net', '256gb'])
  })
  it('folds accents and drops filler words and duplicates', () => {
    expect(offerTokens('Kit Câmera Câmera para Carro Original')).toEqual(['camera', 'carro'])
  })
  it('adds the name word glued to a generic word', () => {
    expect(offerTokens('NotebookVAIO FE16')).toEqual(['notebookvaio', 'fe16', 'vaio'])
  })
  it('gives nothing for an empty title', () => {
    expect(offerTokens('')).toEqual([])
  })
})

describe('retrievalTerms', () => {
  it('needs every anchor name word, plus the only model word', () => {
    expect(retrievalTerms('Samsung Galaxy A55 5G 256gb')).toEqual({ all: ['samsung', 'galaxy', 'a55'], any: [] })
    expect(retrievalTerms('Fone JBL Tune 520BT Preto')).toEqual({ all: ['jbl', 'tune', '520bt'], any: [] })
  })
  it('needs any one of several model words', () => {
    expect(retrievalTerms('Celular Samsung Galaxy A55 5g 256gb 8gb Ram Sm-a556e')).toEqual({ all: ['samsung', 'galaxy'], any: ['a55', 'a556e'] })
    expect(retrievalTerms('Notebook VAIO FE16 Intel Core 5 320 16GB RAM 512GB SSD Linux DDR5')).toEqual({ all: ['vaio'], any: ['fe16', 'ddr5'] })
  })
  it('falls back to the hard sizes when there is no model word', () => {
    expect(retrievalTerms('Perfume Masculino Malbec Eau de Parfum 100ml O Boticario')).toEqual({ all: ['malbec', '100ml'], any: [] })
    expect(retrievalTerms('Pendrive Sandisk 64gb 128gb')).toEqual({ all: ['pendrive', 'sandisk'], any: ['64gb', '128gb'] })
  })
  it('falls back to the plain numbers when there is no hard size either', () => {
    expect(retrievalTerms('Smart TV Samsung 55 Crystal UHD 4K')).toEqual({ all: ['smart', 'tv', 'samsung', '55'], any: [] })
    expect(retrievalTerms('Bicicleta Caloi Aro 29 21 Marchas')).toEqual({ all: ['bicicleta', 'caloi', 'aro'], any: ['29', '21'] })
  })
  it('gives no terms for a title made of generic words', () => {
    const terms = retrievalTerms('Cabo Carregador Tipo C')
    expect(terms).toEqual({ all: [], any: [] })
    expect(hasRetrievalTerms(terms)).toBe(false)
    expect(hasRetrievalTerms(retrievalTerms('Pendrive 64gb 128gb'))).toBe(true)
  })
  it('exposes the anchor pools through titleTerms', () => {
    expect(titleTerms('Smart TV Samsung 55 Crystal UHD 4K 2024')).toMatchObject({ modelWords: [], hardSizes: [], numbers: ['55', '2024'] })
  })
})

describe('retrieves', () => {
  const tokens = new Set(['samsung', 'galaxy', 'a556e'])
  it('needs all of all and one of any', () => {
    expect(retrieves({ all: ['samsung', 'galaxy'], any: ['a55', 'a556e'] }, tokens)).toBe(true)
    expect(retrieves({ all: ['samsung', 'galaxy'], any: ['a55'] }, tokens)).toBe(false)
    expect(retrieves({ all: ['samsung', 'tab'], any: [] }, tokens)).toBe(false)
    expect(retrieves({ all: ['samsung'], any: [] }, tokens)).toBe(true)
  })
})

describe('retrievalTerms recall on the labelled high matches', () => {
  it('covers every labelled high match', () => {
    expect(HIGH_CANDIDATES).toHaveLength(HIGH_PAIRS.length + FIXTURE_EXPECTATIONS.reduce((total, { high }) => total + high.length, 0))
  })
  it.each(HIGH_CANDIDATES)('%s retrieves %s', (ml, name) => {
    const terms = retrievalTerms(ml)
    expect(hasRetrievalTerms(terms)).toBe(true)
    expect(retrieves(terms, new Set(offerTokens(name)))).toBe(true)
  })
})

describe('retrievalTerms recall over every pair of fixture titles', () => {
  it('retrieves every candidate the matcher accepts, high or medium', () => {
    const tokensOf = new Map(FIXTURE_TITLES.map((title) => [title, new Set(offerTokens(title))]))
    const wordsOf = new Map(FIXTURE_TITLES.map((title) => [title, new Set(titleTerms(title).tokens)]))
    const pairs = FIXTURE_TITLES.flatMap((ml) => {
      const words = wordsOf.get(ml) ?? new Set<string>()
      const sharing = FIXTURE_TITLES.filter((name) => name !== ml && [...(wordsOf.get(name) ?? [])].some((word) => words.has(word)))
      return acceptedNames(ml, sharing).map((name): [string, string] => [ml, name])
    })
    const missed = pairs.filter(([ml, name]) => {
      const terms = retrievalTerms(ml)
      return !hasRetrievalTerms(terms) || !retrieves(terms, tokensOf.get(name) ?? new Set())
    })
    expect(pairs.length).toBeGreaterThan(600)
    expect(missed).toEqual([])
  })
})

describe('retrievalTerms on the catalog fixtures', () => {
  const ML_ITEMS: [string, number][] = [
    ['Apple iPhone 15 128gb Rosa', 420_000],
    ['Celular Samsung Galaxy A57 5G 128GB 8GB RAM', 190_000],
    ['Samsung Galaxy S25 FE 5G 128gb', 290_000],
    ['Smartphone Samsung Galaxy A17 128gb 4gb Ram Preto', 90_000],
    ['Pilha Alcalina Elgin Palito AAA Blister com 4', 800],
    ['Xiaomi Poco X8 Pro 512gb 12gb', 330_000],
    ['Celular Samsung Galaxy A55 5g 256gb 8gb Ram Sm-a556e', 200_000],
  ]
  const offerCard = (offer: MarketOffer): MarketCard => ({ ...cardOf(offer.title, offer.priceCents), store: offer.retailer, url: offer.url })

  it.each(ML_ITEMS)('%s matches the retrieved offers as it matches the whole catalog', (title, finalCents) => {
    const terms = retrievalTerms(title)
    const retrieved = CATALOG.filter((offer) => retrieves(terms, new Set(offerTokens(offer.title))))
    expect(matchCandidates(title, finalCents, retrieved.map(offerCard))).toEqual(matchCandidates(title, finalCents, CATALOG.map(offerCard)))
  })
  it('finds high matches among them', () => {
    const highs = ML_ITEMS.filter(([title, finalCents]) => matchCandidates(title, finalCents, CATALOG.map(offerCard)).confidence === 'high')
    expect(highs.map(([title]) => title)).toEqual(['Apple iPhone 15 128gb Rosa', 'Celular Samsung Galaxy A57 5G 128GB 8GB RAM', 'Samsung Galaxy S25 FE 5G 128gb'])
  })
})
