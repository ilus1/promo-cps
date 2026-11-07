import { SEARCH_TEXT_MAX } from './constants'
import { str } from './query-params'
import { storableText } from './storable-text'

export const ACCENTED_LETTERS = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ'
export const PLAIN_LETTERS = 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
const WHITESPACE_RUNS = /\s+/g
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g
const WHITESPACE = /\s+/
const LETTER_START = /^\p{L}/u
const NUMBER_START = /^[\p{Nd}_]/u
export const AFTER_NON_LETTER = '(?<![[:alpha:]_])'
export const AFTER_NON_ALNUM = '(?<![[:alnum:]_])'
const JS_AFTER_NON_LETTER = '(?<![\\p{L}_])'
const JS_AFTER_NON_ALNUM = '(?<![\\p{L}\\p{Nd}_])'

const PLAIN_OF = new Map([...ACCENTED_LETTERS].map((letter, index) => [letter, PLAIN_LETTERS[index]]))

const LOWER_VARIANTS = new Map<string, string[]>()
for (const [accented, plain] of PLAIN_OF) {
  const lower = plain.toLowerCase()
  LOWER_VARIANTS.set(lower, [...new Set([...(LOWER_VARIANTS.get(lower) ?? [lower]), accented.toLowerCase()])])
}
const VARIANTS_OF = new Map(
  [...LOWER_VARIANTS].map(([lower, lowers]) => [lower, [...lowers, ...lowers.map((letter) => letter.toUpperCase())].join('')]),
)

export function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIALS, '\\$&')
}

export function foldAccents(text: string): string {
  return [...text.normalize('NFC')].map((letter) => PLAIN_OF.get(letter) ?? letter).join('')
}

export function nfc<T>(value: T): T {
  if (typeof value === 'string') return value.normalize('NFC') as T
  if (Array.isArray(value)) return value.map(nfc) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, nfc(entry)])) as T
  }
  return value
}

export function normalizeSearchText(raw: string): string {
  return storableText(raw).replace(WHITESPACE_RUNS, ' ').trim().slice(0, SEARCH_TEXT_MAX).toWellFormed().trim()
}

export function searchTextOf(raw: string | string[] | undefined): string | undefined {
  const text = str(raw)
  return text ? normalizeSearchText(text) || undefined : undefined
}

export function searchWords(text: string): string[] {
  const seen = new Set<string>()
  return foldAccents(text).split(WHITESPACE).filter((word) => {
    const key = word.toLowerCase()
    if (!word || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function letterPattern(letter: string): string {
  const variants = VARIANTS_OF.get(letter.toLowerCase())
  return variants ? `[${variants}]` : escapeRegex(letter)
}

function wordStart(word: string): string {
  if (LETTER_START.test(word)) return AFTER_NON_LETTER
  return NUMBER_START.test(word) ? AFTER_NON_ALNUM : ''
}

export function wordRegexes(text: string): string[] {
  return searchWords(text).map((word) => `${wordStart(word)}${[...word].map(letterPattern).join('')}`)
}

export function wordMatchers(text: string): RegExp[] {
  return wordRegexes(text).map((source) => new RegExp(
    source.replaceAll(AFTER_NON_LETTER, JS_AFTER_NON_LETTER).replaceAll(AFTER_NON_ALNUM, JS_AFTER_NON_ALNUM),
    'iu',
  ))
}

export function textMatchesWords(title: string, text: string): boolean {
  return wordMatchers(text).every((matcher) => matcher.test(title))
}
