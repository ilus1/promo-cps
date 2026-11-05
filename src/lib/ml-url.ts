import { ML_HOST } from './constants'
import type { BuscaKind } from './domain'
import { classifyLocation } from './ml-session'
import { foldAccents, normalizeSearchText } from './text-search'

export const SEARCH_HOST = `lista.${ML_HOST}`
const PRODUCT_HOST = `produto.${ML_HOST}`
const CATALOG_PATH = /^\/(?:[^/]+\/)?p\/MLB\d+\/?$/
const USER_PRODUCT_PATH = /^\/(?:[^/]+\/)?up\/MLBU\d+\/?$/
const ITEM_PATH = /^\/MLB-?\d+(?:-[^/]*)?\/?$/
export const COUPON_CAMPAIGN_PARAM = 'coupon_campaign_id'
const STORE_LISTING_MARKER = '_CustId_'
const STORE_PATH = /^\/(pagina|loja)\/[^/]+/
export const EMPTY_SEARCH_TEXT = 'Digite ao menos uma palavra com letras ou números.'
export const INVALID_ML_URL = `Cole a URL de uma busca (${SEARCH_HOST}) ou de um produto do Mercado Livre.`

export function isMlHost(host: string): boolean {
  return host === ML_HOST || host.endsWith(`.${ML_HOST}`)
}

export function safeMlUrl(input: string): string | null {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || !isMlHost(u.hostname)) return null
  if (u.username || u.password || u.port) return null
  if (classifyLocation(u.toString()) !== 'ok') return null
  u.hash = ''
  return u.toString()
}

function isProductPath(u: URL): boolean {
  if (u.hostname === PRODUCT_HOST) return ITEM_PATH.test(u.pathname)
  return CATALOG_PATH.test(u.pathname) || USER_PRODUCT_PATH.test(u.pathname)
}

export function classifyMlUrl(input: string): { kind: BuscaKind; url: string } | { error: string } {
  const url = safeMlUrl(input)
  if (!url) return { error: INVALID_ML_URL }
  const u = new URL(url)
  if (u.hostname === SEARCH_HOST) return { kind: 'search', url }
  return isProductPath(u) ? { kind: 'product', url } : { error: INVALID_ML_URL }
}

const URL_SCHEME_MARK = '://'
const NOT_SLUG_CHARS = /[^a-z0-9]+/g
const EDGE_HYPHENS = /^-+|-+$/g

export function isUrlInput(input: string): boolean {
  return input.includes(URL_SCHEME_MARK) || input.toLowerCase().includes(ML_HOST)
}

export function searchSlug(text: string): string {
  return foldAccents(normalizeSearchText(text)).toLowerCase().replace(NOT_SLUG_CHARS, '-').replace(EDGE_HYPHENS, '')
}

export function classifyBuscaInput(input: string): ReturnType<typeof classifyMlUrl> {
  const typed = input.trim()
  if (typed.includes(URL_SCHEME_MARK)) return classifyMlUrl(typed)
  if (isUrlInput(typed)) return classifyMlUrl(`https://${typed}`)
  const slug = searchSlug(typed)
  return slug ? classifyMlUrl(`https://${SEARCH_HOST}/${slug}`) : { error: EMPTY_SEARCH_TEXT }
}

const CONTAINER_LISTING_MARKER = '_Container_'
const TRAILING_SLASH = /\/$/

function comparablePath(url: URL): string {
  return url.pathname.toLowerCase().replace(TRAILING_SLASH, '')
}

function samePlace(a: URL, b: URL): boolean {
  return a.origin === b.origin && comparablePath(a) === comparablePath(b)
}

export function listingLandingKept(listingUrl: string, finalUrl: string): boolean {
  let listing: URL
  let landed: URL
  try {
    listing = new URL(listingUrl)
    landed = new URL(finalUrl)
  } catch {
    return false
  }
  const wanted = listing.searchParams.get(COUPON_CAMPAIGN_PARAM)
  if (wanted === null) return samePlace(listing, landed)
  const kept = landed.searchParams.get(COUPON_CAMPAIGN_PARAM)
  if (kept !== null) return kept === wanted
  if (listing.pathname.includes(STORE_LISTING_MARKER)) return landed.hostname === SEARCH_HOST && STORE_PATH.test(landed.pathname)
  if (listing.pathname.includes(CONTAINER_LISTING_MARKER)) return samePlace(listing, landed)
  return false
}
