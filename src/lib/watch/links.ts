import { AMAZON_ORIGIN, KABUM_ORIGIN } from '../constants'
import { ML_RETAILER, type ProductLink } from './types'

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const DEFAULT_SCHEME = 'https://'
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])
const ML_DOMAIN = 'mercadolivre.com.br'
const AMAZON_DOMAIN = 'amazon.com.br'
const KABUM_DOMAIN = 'kabum.com.br'
const AMERICANAS_DOMAIN = 'americanas.com.br'
const BUSCAPE_DOMAIN = 'buscape.com.br'
const ML_ITEM_ORIGIN = 'https://produto.mercadolivre.com.br'
const ML_CATALOG_ORIGIN = 'https://www.mercadolivre.com.br'
export const AMERICANAS_ORIGIN = 'https://www.americanas.com.br'
export const BUSCAPE_ORIGIN = 'https://www.buscape.com.br'
const ML_PREFIX = 'MLB'
const ML_CATALOG = /\/p\/MLB(\d+)/i
const ML_ITEM = /\bMLB-?(\d+)/i
const ML_ITEM_PARAM = /(?:[?&#]wid=|\bitem_id:)MLB-?(\d+)/i
const AMAZON_ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?=[/?#]|$)/i
const KABUM_CODE = /^\/produto\/(\d+)(?=[/?#]|$)/
const AMERICANAS_SLUG = /^\/([^/]+)\/p\/?$/
const BUSCAPE_PATH = /^\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/
const BUSCAPE_NON_PRODUCT: ReadonlySet<string> = new Set(['search', 'lead', 'cupons', 'ofertas', 'promocoes'])

function urlOf(text: string): URL | null {
  const trimmed = text.trim()
  try {
    return new URL(SCHEME.test(trimmed) ? trimmed : `${DEFAULT_SCHEME}${trimmed}`)
  } catch {
    return null
  }
}

function decodedOf(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function onDomain(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase()
  return host === domain || host.endsWith(`.${domain}`)
}

export function mlItemUrl(ref: string): string {
  return `${ML_ITEM_ORIGIN}/${ML_PREFIX}-${ref.slice(ML_PREFIX.length)}`
}

function mlLink(url: URL): ProductLink | null {
  const catalog = url.pathname.match(ML_CATALOG)
  if (catalog) return { retailer: ML_RETAILER, ref: `${ML_PREFIX}${catalog[1]}`, url: `${ML_CATALOG_ORIGIN}/p/${ML_PREFIX}${catalog[1]}` }
  const item = url.pathname.match(ML_ITEM) ?? decodedOf(`${url.search}${url.hash}`).match(ML_ITEM_PARAM)
  if (!item) return null
  const ref = `${ML_PREFIX}${item[1]}`
  return { retailer: ML_RETAILER, ref, url: mlItemUrl(ref) }
}

function amazonLink(url: URL): ProductLink | null {
  const asin = url.pathname.match(AMAZON_ASIN)?.[1].toUpperCase()
  return asin ? { retailer: 'amazon', ref: asin, url: `${AMAZON_ORIGIN}/dp/${asin}` } : null
}

function kabumLink(url: URL): ProductLink | null {
  const code = url.pathname.match(KABUM_CODE)?.[1]
  return code ? { retailer: 'kabum', ref: code, url: `${KABUM_ORIGIN}/produto/${code}` } : null
}

function americanasLink(url: URL): ProductLink | null {
  const slug = url.pathname.match(AMERICANAS_SLUG)?.[1]
  return slug ? { retailer: 'americanas', ref: slug, url: `${AMERICANAS_ORIGIN}/${slug}/p` } : null
}

function buscapeLink(url: URL): ProductLink | null {
  const path = url.pathname.toLowerCase().match(BUSCAPE_PATH)
  if (!path || BUSCAPE_NON_PRODUCT.has(path[1])) return null
  const ref = `${path[1]}/${path[2]}`
  return { retailer: 'buscape', ref, url: `${BUSCAPE_ORIGIN}/${ref}` }
}

export function parseProductLink(text: string): ProductLink | null {
  const url = urlOf(text)
  if (!url || !WEB_PROTOCOLS.has(url.protocol)) return null
  if (onDomain(url, ML_DOMAIN)) return mlLink(url)
  if (onDomain(url, AMAZON_DOMAIN)) return amazonLink(url)
  if (onDomain(url, KABUM_DOMAIN)) return kabumLink(url)
  if (onDomain(url, AMERICANAS_DOMAIN)) return americanasLink(url)
  if (onDomain(url, BUSCAPE_DOMAIN)) return buscapeLink(url)
  return null
}
