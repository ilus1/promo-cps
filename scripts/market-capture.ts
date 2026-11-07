import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { amazonPageLoader, withAmazonBrowser } from '@/ingestion/market/amazon-browser'
import type { FetchedPage } from '@/ingestion/market/fetched-page'
import { fetchMarketPage } from '@/ingestion/market/http-client'
import { vpnCheck } from '@/ingestion/vpn-guard'
import { AMAZON_ORIGIN, KABUM_ORIGIN } from '@/lib/constants'
import {
  amazonBestsellersRootUrl, parseAmazonBestsellerRoot, parseAmazonBestsellers, parseAmazonSearch,
} from '@/lib/market/parse-amazon'
import { statusFailure } from '@/lib/market/pages'
import { kabumSitemapIndexUrl, parseKabumListing, parseKabumSitemapIndex } from '@/lib/market/parse-kabum'
import { RETAILERS, type PageKind, type ParsedPage, type Retailer } from '@/lib/market/types'

const COUNT_FILE = '/tmp/market-capture-count.json'
const SITE_LIMIT = 10
const SEARCH_PATH = '/s?'
const BESTSELLERS_PATH = '/gp/bestsellers/'
const ORIGINS: Record<Retailer, string> = { kabum: KABUM_ORIGIN, amazon: AMAZON_ORIGIN }
const USAGE = 'Uso: market-capture --site kabum|amazon --url <url do site> --out <arquivo>'
const MISSING_FILE = 'ENOENT'
const BAD_COUNT_FILE = `${COUNT_FILE} ilegível: nenhuma captura até ele ser conferido`
const NO_SLUGS = 'sem departamentos'

type SiteCount = { requests: number; walled: boolean }
type Counts = Record<Retailer, SiteCount>
type PageSummary = { kind: PageKind | 'sitemap'; detail: string }

const NO_COUNTS: Counts = { kabum: { requests: 0, walled: false }, amazon: { requests: 0, walled: false } }

function isRetailer(value: string | undefined): value is Retailer {
  return RETAILERS.some((site) => site === value)
}

function siteCountOf(raw: unknown): SiteCount | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { requests, walled } = raw as { requests?: unknown; walled?: unknown }
  if (typeof requests !== 'number' || !Number.isInteger(requests) || requests < 0 || typeof walled !== 'boolean') return null
  return { requests, walled }
}

function countsOf(text: string): Counts {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(BAD_COUNT_FILE)
  }
  const sites = typeof raw === 'object' && raw !== null ? raw as Partial<Record<Retailer, unknown>> : {}
  const kabum = siteCountOf(sites.kabum)
  const amazon = siteCountOf(sites.amazon)
  if (!kabum || !amazon) throw new Error(BAD_COUNT_FILE)
  return { kabum, amazon }
}

async function readCounts(): Promise<Counts> {
  try {
    return countsOf(await readFile(COUNT_FILE, 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === MISSING_FILE) return NO_COUNTS
    throw e
  }
}

function refusal(site: Retailer, count: SiteCount): string | null {
  if (count.walled) return `${site} já respondeu com bloqueio; nenhuma nova captura (apague ${COUNT_FILE} só com o aval do líder)`
  if (count.requests >= SITE_LIMIT) return `limite de ${SITE_LIMIT} capturas para ${site} atingido (${COUNT_FILE})`
  return null
}

function isBestsellerDepartment(url: string): boolean {
  return url.includes(BESTSELLERS_PATH) && url !== amazonBestsellersRootUrl()
}

function parsedPage(site: Retailer, url: string, { status, html }: FetchedPage): ParsedPage<unknown> {
  if (site === 'kabum') return parseKabumListing(status, html, url, new Date())
  if (url.includes(SEARCH_PATH)) return parseAmazonSearch(status, html)
  if (isBestsellerDepartment(url)) return parseAmazonBestsellers(status, html, url)
  return parseAmazonBestsellerRoot(status, html)
}

function summarize(site: Retailer, url: string, fetched: FetchedPage): PageSummary {
  if (site === 'kabum' && url === kabumSitemapIndexUrl()) {
    const slugs = parseKabumSitemapIndex(fetched.status, fetched.html)
    if (slugs) return { kind: 'sitemap', detail: `${slugs.length} departamentos` }
    const failure = statusFailure(fetched.status)
    return { kind: failure?.kind ?? 'unknown', detail: failure?.reason ?? NO_SLUGS }
  }
  const parsed = parsedPage(site, url, fetched)
  return parsed.kind === 'results' ? { kind: 'results', detail: `${parsed.offers.length} ofertas` } : { kind: parsed.kind, detail: parsed.reason }
}

async function capture(site: Retailer, url: string): Promise<FetchedPage> {
  if (site === 'kabum') return fetchMarketPage(url)
  return withAmazonBrowser((page) => amazonPageLoader(page)(url, isBestsellerDepartment(url)))
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { site: { type: 'string' }, url: { type: 'string' }, out: { type: 'string' } } })
  const { site, url, out } = values
  if (!isRetailer(site) || !url || !out || !url.startsWith(`${ORIGINS[site]}/`)) {
    console.error(USAGE)
    process.exit(1)
  }
  const vpn = await vpnCheck()
  if (vpn.held) {
    console.error(`VPN ${vpn.state}: desconecte a VPN antes de capturar`)
    process.exit(1)
  }
  const counts = await readCounts()
  const refused = refusal(site, counts[site])
  if (refused) {
    console.error(refused)
    process.exit(1)
  }
  counts[site] = { ...counts[site], requests: counts[site].requests + 1 }
  await writeFile(COUNT_FILE, JSON.stringify(counts))
  const fetched = await capture(site, url)
  const summary = summarize(site, url, fetched)
  if (summary.kind === 'wall') {
    counts[site] = { ...counts[site], walled: true }
    await writeFile(COUNT_FILE, JSON.stringify(counts))
  }
  const file = resolve(out)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, fetched.html)
  const reason = fetched.reason ? ` (${fetched.reason})` : ''
  console.log(`status ${fetched.status}${reason}, ${Buffer.byteLength(fetched.html)} bytes, ${summary.kind}: ${summary.detail}, ${file}`)
  console.log(`${site}: ${counts[site].requests} de ${SITE_LIMIT} capturas usadas`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
