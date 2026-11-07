import { ML_HOST } from './constants'
import { classifyLocation } from './ml-session'
import { foldAccents, normalizeSearchText } from './text-search'

export const SEARCH_HOST = `lista.${ML_HOST}`

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

const NOT_SLUG_CHARS = /[^a-z0-9]+/g
const EDGE_HYPHENS = /^-+|-+$/g

export function searchSlug(text: string): string {
  return foldAccents(normalizeSearchText(text)).toLowerCase().replace(NOT_SLUG_CHARS, '-').replace(EDGE_HYPHENS, '')
}
