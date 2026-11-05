import type { MarketCard } from '@/lib/market/types'
import {
  MATCH_HIGH_MIN_KEY_WORDS, MATCH_HIGH_OVERLAP, MATCH_MEDIUM_OVERLAP, MATCH_PRICE_CEILING_FACTOR, MATCH_PRICE_FLOOR_DIVISOR,
} from '../constants'
import type { MatchConfidence } from '../domain'
import { foldAccents } from '../text-search'

export type MatchOffer = {
  store: string | null
  priceCents: number
  name: string
}

export type Match = {
  confidence: MatchConfidence | null
  offers: MatchOffer[]
  marketLowCents: number | null
  marketStore: string | null
  secondLowCents: number | null
  storeCount: number
}

export type PriceBand = {
  minCents: number
  maxCents: number
}

export type TitleTerms = {
  tokens: string[]
  nameWords: string[]
  modelWords: string[]
  hardSizes: string[]
  numbers: string[]
}

type TitleParts = {
  sequence: string[]
  words: Set<string>
  modelWords: Set<string>
  sizeWords: Set<string>
  numbers: Set<string>
  tiers: Set<string>
  flags: Set<string>
  flankers: Set<string>
  zoneNumbers: Set<string>
  letters: Set<string>
  pack: number
}

const NAME_ANCHOR_WORDS = 3
const GENERIC_TITLE_WORDS: ReadonlySet<string> = new Set([
  'cabo', 'tipo', 'carregamento', 'carregador', 'caixa', 'som', 'bluetooth', 'sem', 'fio',
  'perfume', 'masculino', 'feminino', 'unissex', 'notebook', 'fone', 'ouvido', 'smartphone', 'celular',
  'tenis', 'camiseta', 'garrafa', 'termica', 'portatil',
])
const MIXED_CONCENTRATION_WORD = 'eau'
const MAX_EXTRA_MODEL_WORDS = 2
const NO_PACK = 1
const MULTI_PACK = 0
const MILLI = 1000
const MM_PER_CM = 10
const EXCLUDED_STORE_NAMES = ['mercado livre', 'mercadolivre']
const STOP_WORDS: ReadonlySet<string> = new Set([
  'para', 'com', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas', 'por',
  'um', 'uma', 'ao', 'oferta', 'original', 'envio', 'rapido', 'promocao', 'lancamento', 'novo', 'frete', 'gratis',
  'full',
])
const TIER_WORDS: ReadonlySet<string> = new Set([
  'pro', 'max', 'ultra', 'plus', 'mini', 'lite', 'light', 'fe', 'ti', 'super', 'xt', 'xtx', 'airtier', 'setier', 'digitaltier',
])
const VARIANT_FAMILIES: ReadonlySet<string>[] = [
  new Set(['hd', 'fullhd', 'uhd', 'qhd']),
  new Set(['qled', 'oled', 'qned', 'nanocell', 'crystal', 'neo', 'miniled']),
  new Set(['parfum', 'edp', 'toilette', 'edt', 'cologne', 'colonia']),
  new Set(['windows', 'linux', 'chromeos', 'macos']),
  new Set(['isolado', 'concentrado', 'hidrolisado']),
]
const FLANKER_WORDS: ReadonlySet<string> = new Set([
  'elixir', 'intense', 'intensement', 'absolu', 'extreme', 'supreme', 'privee',
])
const SIZE_MARK = 'zzsize'
const SINGLE_LETTER = /^[a-z]$/
const PLURAL_SUFFIX = /s$/
const PLURAL_MARK = 's'
const AMPERE_WORDS = /(?<![a-z0-9.,])(\d+(?:[.,]\d+)?)\s*(?:amperes?|amps?)(?![a-z0-9])/g
const SPACED_AMPERES = /(?<![a-z0-9.,])(\d+(?:[.,]\d+)?)\s+a(?![a-z0-9])(?!\s*\d+(?:[.,]\d+)?(?!\s*v\b)(?![\d.,]))/g
const AMPERE_MODEL_WORD = '$1a'
const VOLTAGE = /(?<![a-z0-9.,])\d+\s*(?:v|volts?)(?![a-z0-9])|\bbivolt\b/
const TYPO_DISTANCE = 2
const LINE_WORD = /^[a-z]{5,}$/
const SLOT_STEPS = [-1, 1]
const PLACEHOLDER_BRANDS: ReadonlySet<string> = new Set([
  'outros', 'oem', 'generico', 'generica', 'sem marca', 'diversos', 'importado', 'importada',
])
const CANDIDATE_ONLY_REJECTED_WORDS: ReadonlySet<string> = new Set([
  'capa', 'capinha', 'case', 'pelicula', 'protetor', 'refil', 'refis', 'reposicao',
  'almofada', 'almofadas', 'espuma', 'espumas', 'pulseira', 'suporte', 'compativel', 'adaptador', 'estojo', 'skin',
  'usado', 'usada', 'seminovo', 'seminova', 'recondicionado', 'recondicionada', 'vitrine', 'mostruario',
  'reembalado', 'refurbished', 'pecas', 'peca', 'replica', 'defeito', 'semi', 'aberta', 'openbox', 'tampa', 'bico',
  'jarra', 'cabo', 'bateria', 'infantil', 'importado', 'arco', 'headband', 'haste', 'alca', 'cordao', 'ponteira', 'display', 'teclado', 'carcaca', 'dobradica',
  'touchpad',
])
const FULL_HD = /\b(?:full hd|fhd)\b/g
const OPEN_BOX = /\bopen box\b/g
const AIR_TIER = /\b(ipad|macbook) air\b/g
const SE_TIER = /\b(iphone|watch) se\b/g
const DIGITAL_EDITION = /\b(?:edicao|midia) digital\b/g
const DIGITAL_CONSOLE = /\b((?:playstation \d|ps\d)(?: slim)?) digital\b/g
const APOSTROPHES = /['`\u00b4\u2019]/g
const PARA_ABBREVIATION = /\bp\//g
const NON_ALPHANUMERIC_RUNS = /[^a-z0-9]+/g
const STORAGE_GRAM_VALUES: ReadonlySet<number> = new Set([64, 128, 256, 512])
const DIGIT_RUNS = /\d+/g
const SHAPE_DIGIT = '#'
const ANY_LETTER = '?'
const LETTER_THEN_DIGITS = /^[a-z]\d+$/
const COUNT_NOUNS = 'latas?|rolos?|capsulas?|fraldas?|folhas?|saches?|tabletes?|comprimidos?|doses?|garrafas?|caixas?|potes?|tubos?|barras?|lencos?|absorventes?|sabonetes?|refis?'
const MEMORY_UNIT = 'gb'
const SOFT_UNITS: ReadonlySet<string> = new Set(['v', 'k', 'hz', 'net', 'h', 'mp', 'fps', 'ppi'])
const NETWORK_UNIT = 'net'
const LENGTH_UNIT = 'mm'
const WORD_NUMBERS: Record<string, number> = {
  duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
}
const COUNT = `\\d+|${Object.keys(WORD_NUMBERS).join('|')}`
const SIZE_UNITS = 'ml|mm|cm|mah|mp|ghz|hz|fps|ppi|gb|tb|kg|btus?|polegadas?|pol|"|litros?|metros?|l|g|w|m|v|k|h'
const AMOUNT = '\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?'
const SIZE = new RegExp(`(?<![a-z0-9.,])(${AMOUNT})\\s*(${SIZE_UNITS})(?![a-z0-9])`, 'g')
const NETWORK = /(?<![a-z0-9.,])([345])g(?![a-z0-9])/g
const THOUSANDS_INTEGER = /^[1-9]\d{0,2}(?:\.\d{3})+$/
const PACK_PATTERNS = [
  new RegExp(`\\bkit\\s*(?:com\\s*|de\\s*)?(${COUNT})\\b`, 'g'),
  new RegExp(`\\bpack\\s*(\\d+)\\b`, 'g'),
  new RegExp(`\\b(${COUNT})\\s*(?:unidades?|und|un|pacotes?|pcs|pecas)\\b`, 'g'),
  new RegExp(`\\bc\\/\\s*(\\d+)(?!\\d)(?![,.]?\\d*\\s*(?:${SIZE_UNITS})(?![a-z0-9]))`, 'g'),
  /(?<![a-z0-9])(\d+)x\b/g,
  new RegExp(`\\b(${COUNT})\\s*(?:${COUNT_NOUNS})\\b`, 'g'),
  /\b(?:leve|caixa(?:\s+com)?)\s*(\d+)\b/g,
  /\bpague\s*\d+\b/g,
  /(?<=\d\s*(?:ml|g|kg|l)\s*)x\s*(\d+)(?![a-z0-9])/g,
  new RegExp(`\\bcom\\s*(\\d+)\\s*$`),
]
const PACK_WORDS: ReadonlySet<string> = new Set(['kit', 'combo', 'duo', 'trio', 'par', 'pares'])
const MULTI_WORDS = /\b(?:kit|combo|duo|trio|par|pares)\b|\s\+\s/
const LETTER_BEFORE_DIGIT_HYPHEN = /([a-z])-(?=\d)/g
const PLUS_SUFFIX = /([a-z0-9])\+/g
const NON_ALPHANUMERIC = /[^a-z0-9]+/
const HAS_LETTER = /[a-z]/
const HAS_DIGIT = /\d/
const ONLY_DIGITS = /^\d+$/
const UNIT_ALIASES: Record<string, string> = {
  btu: 'btu', btus: 'btu', litro: 'l', litros: 'l', metro: 'm', metros: 'm', polegada: 'pol', polegadas: 'pol', '"': 'pol',
}
const UNIT_SCALES: Record<string, { unit: string; factor: number }> = {
  l: { unit: 'ml', factor: MILLI },
  kg: { unit: 'g', factor: MILLI },
  tb: { unit: 'gb', factor: MILLI },
  m: { unit: LENGTH_UNIT, factor: MILLI },
  cm: { unit: LENGTH_UNIT, factor: MM_PER_CM },
}

function normalized(text: string): string {
  return foldAccents(text).toLowerCase().replace(APOSTROPHES, '').replace(LETTER_BEFORE_DIGIT_HYPHEN, '$1').replace(PLUS_SUFFIX, '$1 plus').replace(FULL_HD, 'fullhd').replace(OPEN_BOX, 'openbox').replace(AIR_TIER, '$1 airtier').replace(SE_TIER, '$1 setier').replace(DIGITAL_EDITION, 'digitaltier').replace(DIGITAL_CONSOLE, '$1 digitaltier').replace(PARA_ABBREVIATION, 'para ')
}

function withAmperes(text: string): string {
  const named = text.replace(AMPERE_WORDS, AMPERE_MODEL_WORD)
  return VOLTAGE.test(named) ? named.replace(SPACED_AMPERES, AMPERE_MODEL_WORD) : named
}

function amountOf(raw: string): number {
  if (raw.includes(',')) return Number(raw.replaceAll('.', '').replace(',', '.'))
  return Number(THOUSANDS_INTEGER.test(raw) ? raw.replaceAll('.', '') : raw)
}

function sizeToken(amount: string, rawUnit: string): string {
  const unit = UNIT_ALIASES[rawUnit] ?? rawUnit
  const value = amountOf(amount)
  if (unit === 'g' && STORAGE_GRAM_VALUES.has(value)) return `${value}gb`
  const scale = UNIT_SCALES[unit]
  return scale ? `${Math.round(value * scale.factor)}${scale.unit}` : `${value}${unit}`
}

function extractPack(text: string): { rest: string; pack: number } {
  let rest = text
  let pack = NO_PACK
  for (const pattern of PACK_PATTERNS) {
    rest = rest.replace(pattern, (_match, count: string) => {
      pack = Math.max(pack, WORD_NUMBERS[count] ?? (Number(count) || NO_PACK))
      return ' '
    })
  }
  if (pack === NO_PACK && MULTI_WORDS.test(rest)) pack = MULTI_PACK
  return { rest, pack }
}

function extractSizes(text: string): { rest: string; sizes: Set<string> } {
  const sizes = new Set<string>()
  const withoutNetworks = text.replace(NETWORK, (_match, generation: string) => {
    sizes.add(`${generation}${NETWORK_UNIT}`)
    return ' '
  })
  const rest = withoutNetworks.replace(SIZE, (_match, amount: string, unit: string) => {
    sizes.add(sizeToken(amount, unit))
    return ` ${SIZE_MARK} `
  })
  return { rest, sizes }
}

function valueOf(size: string): string {
  return size.slice(0, size.length - unitOf(size).length)
}

function unitOf(size: string): string {
  return size.replace(/^\d+(?:\.\d+)?/, '')
}

function flagWordOf(token: string): string | null {
  if (CANDIDATE_ONLY_REJECTED_WORDS.has(token)) return token
  const singular = token.replace(PLURAL_SUFFIX, '')
  return CANDIDATE_ONLY_REJECTED_WORDS.has(singular) ? singular : null
}

function titleParts(text: string): TitleParts {
  const { rest: withoutPack, pack } = extractPack(withAmperes(normalized(text)))
  const { rest, sizes } = extractSizes(withoutPack)
  const marked = rest.split(NON_ALPHANUMERIC).filter((token) => token && !STOP_WORDS.has(token))
  const tokens = marked.filter((token) => token !== SIZE_MARK)
  return {
    sequence: marked,
    words: new Set([...tokens, ...sizes]),
    modelWords: new Set(tokens.filter((token) => HAS_LETTER.test(token) && HAS_DIGIT.test(token))),
    sizeWords: sizes,
    numbers: new Set(tokens.filter((token) => ONLY_DIGITS.test(token))),
    tiers: new Set(tokens.filter((token) => TIER_WORDS.has(token))),
    flags: new Set(tokens.map(flagWordOf).filter((word) => word !== null)),
    flankers: new Set(tokens.filter((token) => FLANKER_WORDS.has(token))),
    zoneNumbers: new Set(nameZoneOf(marked).filter((token) => ONLY_DIGITS.test(token))),
    letters: new Set(tokens.filter((token) => SINGLE_LETTER.test(token))),
    pack,
  }
}

function shapeOf(token: string): string {
  if (LETTER_THEN_DIGITS.test(token)) return `${ANY_LETTER}${SHAPE_DIGIT}`
  return token.replace(DIGIT_RUNS, SHAPE_DIGIT)
}

function digitsOf(token: string): string {
  return (token.match(DIGIT_RUNS) ?? []).join(SHAPE_DIGIT)
}

function groupedBy(items: Iterable<string>, keyOf: (item: string) => string): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>()
  for (const item of items) {
    const key = keyOf(item)
    groups.set(key, (groups.get(key) ?? new Set()).add(item))
  }
  return groups
}

function disjointGroups(left: Map<string, Set<string>>, right: Map<string, Set<string>>): boolean {
  return [...left].some(([key, items]) => {
    const other = right.get(key)
    return other !== undefined && ![...items].some((item) => other.has(item))
  })
}

function numberSlots(parts: TitleParts): Map<string, Set<string>> {
  const slots = new Map<string, Set<string>>()
  parts.sequence.forEach((token, index) => {
    if (!ONLY_DIGITS.test(token)) return
    const neighbours = [['p', parts.sequence[index - 1]], ['n', parts.sequence[index + 1]]]
    for (const [side, word] of neighbours) {
      if (word === undefined || word === SIZE_MARK || ONLY_DIGITS.test(word)) continue
      const key = `${side}:${word.replace(PLURAL_SUFFIX, '')}`
      slots.set(key, (slots.get(key) ?? new Set()).add(token))
    }
  })
  return slots
}

function sizesConflict(wanted: Set<string>, found: Set<string>): boolean {
  const byUnit = (sizes: Set<string>) => groupedBy(sizes, unitOf)
  const wantedByUnit = byUnit(wanted)
  const foundByUnit = byUnit(found)
  return [...wantedByUnit].some(([unit, sizes]) => {
    const other = foundByUnit.get(unit)
    if (other === undefined) return false
    return [...sizes].some((size) => !other.has(size)) && [...other].some((size) => !sizes.has(size))
  })
}

function hardSizesOf(parts: TitleParts): string[] {
  return [...parts.sizeWords].filter((size) => !SOFT_UNITS.has(unitOf(size)))
}

function keyWordsOf(parts: TitleParts): string[] {
  return [...parts.modelWords, ...hardSizesOf(parts)]
}

function sharesNoVariant(wanted: TitleParts, found: TitleParts): boolean {
  return VARIANT_FAMILIES.every((family) => {
    const left = new Set([...wanted.words].filter((word) => family.has(word)))
    const right = new Set([...found.words].filter((word) => family.has(word)))
    return left.size === 0 || right.size === 0 || sameSet(left, right)
  })
}

function includesAll(wanted: Set<string>, found: Set<string>): boolean {
  return [...wanted].every((word) => found.has(word))
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && includesAll(left, right)
}

function storeKey(store: string): string {
  return normalized(store).replace(NON_ALPHANUMERIC_RUNS, '')
}

function isExcludedStore(store: string): boolean {
  const folded = normalized(store)
  return EXCLUDED_STORE_NAMES.some((name) => folded.includes(name))
}

export function priceBand(finalCents: number): PriceBand {
  return { minCents: Math.ceil(finalCents / MATCH_PRICE_FLOOR_DIVISOR), maxCents: finalCents * MATCH_PRICE_CEILING_FACTOR }
}

function priceInBand(priceCents: number, finalCents: number): boolean {
  const { minCents, maxCents } = priceBand(finalCents)
  return priceCents >= minCents && priceCents <= maxCents
}

function zoneNumbersConflict(wanted: Set<string>, found: Set<string>): boolean {
  if (wanted.size === 0 || found.size === 0) return false
  return !includesAll(wanted, found) && !includesAll(found, wanted)
}

function hasWordForm(words: Set<string>, word: string): boolean {
  return words.has(word) || words.has(`${word}${PLURAL_MARK}`) || words.has(word.replace(PLURAL_SUFFIX, ''))
}

function privateLineWord(sequence: string[], index: number, other: Set<string>): boolean {
  const word = sequence[index]
  if (word === undefined || word === SIZE_MARK || !LINE_WORD.test(word)) return false
  return !GENERIC_TITLE_WORDS.has(word) && !hasWordForm(other, word)
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= right.length; j++) {
      const above = row[j]
      row[j] = Math.min(above + 1, row[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[right.length]
}

function slotConflict(wanted: string[], index: number, found: TitleParts, at: number, wantedWords: Set<string>, foundWords: Set<string>): boolean {
  if (!privateLineWord(wanted, index, foundWords) || !privateLineWord(found.sequence, at, wantedWords)) return false
  return editDistance(wanted[index], found.sequence[at]) > TYPO_DISTANCE
}

function lineWordsConflict(wanted: TitleParts, found: TitleParts): boolean {
  return nameZoneOf(wanted.sequence).some((word, index) => found.words.has(word) && found.sequence.some((other, at) => (
    other === word && SLOT_STEPS.some((step) => slotConflict(wanted.sequence, index + step, found, at + step, wanted.words, found.words))
  )))
}

function namesOwnProduct(wanted: TitleParts, found: TitleParts): boolean {
  return nameZoneOf(wanted.sequence).some((word) => (
    word.length > 1 && !ONLY_DIGITS.test(word) && !GENERIC_TITLE_WORDS.has(word) && !hasWordForm(found.words, word)
  ))
}

function brandMissing(wanted: TitleParts, brand: string | null | undefined): boolean {
  const folded = brand ? normalized(brand).trim() : ''
  if (!folded || PLACEHOLDER_BRANDS.has(folded)) return false
  const words = folded.split(NON_ALPHANUMERIC).filter(Boolean)
  return !words.some((word) => wanted.words.has(word)) && !wanted.words.has(words.join(''))
}

function acceptable(wanted: TitleParts, found: TitleParts): boolean {
  for (const keyOf of [shapeOf, digitsOf]) {
    if (disjointGroups(groupedBy(wanted.modelWords, keyOf), groupedBy(found.modelWords, keyOf))) return false
  }
  const extraModelWords = [...found.modelWords].filter((word) => !wanted.modelWords.has(word))
  if (extraModelWords.length > MAX_EXTRA_MODEL_WORDS) return false
  if (disjointGroups(numberSlots(wanted), numberSlots(found))) return false
  if (!sameSet(wanted.tiers, found.tiers) || !sameSet(wanted.flankers, found.flankers)) return false
  if (zoneNumbersConflict(wanted.zoneNumbers, found.zoneNumbers)) return false
  if (wanted.letters.size > 0 && found.letters.size > 0 && !sameSet(wanted.letters, found.letters)) return false
  if (!sharesNoVariant(wanted, found) || lineWordsConflict(wanted, found)) return false
  if ([...found.flags].some((flag) => !wanted.flags.has(flag))) return false
  return !sizesConflict(wanted.sizeWords, found.sizeWords) && wanted.pack === found.pack
}

function overlapOf(wanted: TitleParts, found: TitleParts): number {
  const shorter = keyWordsOf(wanted).length > 0 ? Math.min(wanted.words.size, found.words.size) : wanted.words.size
  if (shorter === 0) return 0
  return [...wanted.words].filter((word) => found.words.has(word)).length / shorter
}

function sharesNumberSlot(wanted: TitleParts, found: TitleParts): boolean {
  const foundSlots = numberSlots(found)
  return [...numberSlots(wanted)].some(([key, numbers]) => [...numbers].some((number) => foundSlots.get(key)?.has(number)))
}

function nameZoneOf(sequence: string[]): string[] {
  const end = sequence.findIndex((word) => word === SIZE_MARK || (HAS_LETTER.test(word) && HAS_DIGIT.test(word)))
  return end === -1 ? sequence : sequence.slice(0, end)
}

function nameWordsOf(parts: TitleParts): string[] {
  const named = nameZoneOf(parts.sequence).filter((word) => (
    word.length > 1
    && !ONLY_DIGITS.test(word)
    && !PACK_WORDS.has(word)
    && !GENERIC_TITLE_WORDS.has(word)
    && word !== MIXED_CONCENTRATION_WORD
    && !VARIANT_FAMILIES.some((family) => family.has(word))
  ))
  return named.slice(0, NAME_ANCHOR_WORDS)
}

function hasNameWord(found: TitleParts, word: string): boolean {
  if (found.words.has(word)) return true
  return [...found.words].some((token) => token.endsWith(word) && GENERIC_TITLE_WORDS.has(token.slice(0, -word.length)))
}

function hasAnchor(wanted: TitleParts, found: TitleParts): boolean {
  if (!nameWordsOf(wanted).every((word) => hasNameWord(found, word))) return false
  const pool = wanted.modelWords.size > 0 ? [...wanted.modelWords] : hardSizesOf(wanted)
  if (pool.length > 0) return pool.some((word) => found.modelWords.has(word) || found.sizeWords.has(word))
  if (wanted.zoneNumbers.size > 0 && includesAll(wanted.zoneNumbers, found.zoneNumbers)) return true
  return wanted.numbers.size === 0 || sharesNumberSlot(wanted, found)
}

function isHigh(wanted: TitleParts, found: TitleParts, overlap: number): boolean {
  const keyWords = keyWordsOf(wanted)
  const foundKeyWords = new Set(keyWordsOf(found))
  const matched = keyWords.filter((word) => foundKeyWords.has(word)).length
  const needed = Math.min(MATCH_HIGH_MIN_KEY_WORDS, keyWords.length)
  const wantedHardSizes = hardSizesOf(wanted)
  const wantedUnits = new Set(wantedHardSizes.map(unitOf))
  const sizesComplete = wantedHardSizes.every((size) => found.sizeWords.has(size))
  const smallestMemory = Math.min(...wantedHardSizes.filter((size) => unitOf(size) === MEMORY_UNIT).map((size) => Number(valueOf(size))))
  const noExtraValues = hardSizesOf(found).every((size) => {
    if (!wantedUnits.has(unitOf(size))) return wanted.numbers.has(valueOf(size))
    return wanted.sizeWords.has(size) || (unitOf(size) === MEMORY_UNIT && Number(valueOf(size)) < smallestMemory)
  })
  const identified = keyWords.length > 0 ? matched >= needed : wanted.numbers.size > 0
  return identified && sizesComplete && noExtraValues && overlap >= MATCH_HIGH_OVERLAP
}

function secondLowOf(accepted: MarketCard[], marketStore: string | null): number | null {
  const marketKey = storeKey(marketStore ?? '')
  const others = accepted.filter((card) => storeKey(card.store ?? '') !== marketKey).map((card) => card.priceCents)
  return others.length > 0 ? Math.min(...others) : null
}

function noMatch(): Match {
  return { confidence: null, offers: [], marketLowCents: null, marketStore: null, secondLowCents: null, storeCount: 0 }
}

function ungluedNamesOf(token: string): string[] {
  return [...GENERIC_TITLE_WORDS]
    .filter((generic) => token.length > generic.length && token.startsWith(generic))
    .map((generic) => token.slice(generic.length))
}

export function titleTerms(text: string): TitleTerms {
  const parts = titleParts(text)
  const words = [...parts.words]
  return {
    tokens: [...new Set([...words, ...words.flatMap(ungluedNamesOf)])],
    nameWords: nameWordsOf(parts),
    modelWords: [...parts.modelWords],
    hardSizes: hardSizesOf(parts),
    numbers: [...parts.numbers],
  }
}

export function matchCandidates(mlTitle: string, mlFinalCents: number, cards: MarketCard[]): Match {
  const wanted = titleParts(mlTitle)
  const high: MarketCard[] = []
  const medium: MarketCard[] = []
  for (const card of cards) {
    if (card.store === null || isExcludedStore(card.store) || !priceInBand(card.priceCents, mlFinalCents)) continue
    const found = titleParts(card.name)
    if (!acceptable(wanted, found) || !hasAnchor(wanted, found)) continue
    const overlap = overlapOf(wanted, found)
    const otherBrand = brandMissing(wanted, card.brand) && namesOwnProduct(wanted, found)
    if (!otherBrand && isHigh(wanted, found, overlap)) high.push(card)
    else if (overlap >= MATCH_MEDIUM_OVERLAP) medium.push(card)
  }
  const accepted = high.length > 0 ? high : medium
  if (accepted.length === 0) return noMatch()
  const cheapest = accepted.reduce((best, card) => (card.priceCents < best.priceCents ? card : best))
  const stores = new Set(accepted.map((card) => storeKey(card.store ?? '')))
  const aggregated = Math.max(...accepted.map((card) => card.storeCount ?? 0))
  return {
    confidence: high.length > 0 ? 'high' : 'medium',
    offers: accepted.map((card) => ({ store: card.store, priceCents: card.priceCents, name: card.name })),
    marketLowCents: cheapest.priceCents,
    marketStore: cheapest.store,
    secondLowCents: high.length > 0 ? secondLowOf(accepted, cheapest.store) : null,
    storeCount: Math.max(stores.size, aggregated),
  }
}
