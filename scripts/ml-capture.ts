import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import type { BrowserContext, Locator, Page, Request as BrowserRequest } from 'playwright'
import { withMlBrowser } from '@/ingestion/browser'
import { firstLine, isRunStop } from '@/ingestion/errors'
import { canApply, clickApply, prepareApply, type CouponEntry } from '@/ingestion/ml/activate-click'
import { findPolycards } from '@/ingestion/ml/cards'
import { compareStrength, parseCouponPage } from '@/ingestion/ml/coupons'
import { loadPageProps, type LoadedPage, type PageProps } from '@/ingestion/ml/page-state'
import { safeMlUrl } from '@/lib/ml-url'

const CAPTURE_DIR = resolve('src/ingestion/ml/__fixtures__/captured')
const CAPTURE_NAME = /^[a-z0-9-]+$/
const DEFAULT_NAME = 'capture'
const STRONGEST = 'strongest'
const STRONGEST_CANDIDATES = 5
const ACTIVATE_CODE_PARAM = 'coupon_activate_code'
const CODE_KEY = 'code'
const SETTLE_MS = 3000
const BODY_LIMIT = 2000
const DROPPED_HEADER = 'cookie'
const TOKEN_HEADER = /csrf|xsrf|token/i
const REDACTED = '<redacted>'
const USAGE = 'Uso: ml-capture <url do Mercado Livre> [nome] [--activate <campaign_id|strongest>]'

function pathOf(node: unknown, value: string, path = ''): string | null {
  if (node === value) return path
  if (typeof node !== 'object' || node === null) return null
  for (const [key, child] of Object.entries(node)) {
    const found = pathOf(child, value, path ? `${path}.${key}` : key)
    if (found !== null) return found
  }
  return null
}

function readFirstImage(page: Page) {
  return page.evaluate(() => {
    const img = document.querySelector('.poly-card img')
    return img ? { src: img.getAttribute('src'), dataSrc: img.getAttribute('data-src') } : null
  })
}

async function saveFallback(page: Page, name: string) {
  if (page.isClosed()) return
  await writeFile(join(CAPTURE_DIR, `${name}.html`), await page.content())
  const state = await page.evaluate(() => ({
    scripts: Array.from(document.querySelectorAll('script'))
      .filter((s) => s.id || (s.type && s.type !== 'text/javascript' && s.type !== 'module'))
      .map((s) => ({ id: s.id, type: s.type, length: (s.textContent ?? '').length })),
    globals: Object.keys(window).filter((k) => k.startsWith('_')),
  }))
  console.log(`final URL: ${page.url()}`)
  console.log(`state scripts: ${JSON.stringify(state.scripts)}`)
  console.log(`underscore globals: ${state.globals.join(', ')}`)
  console.log(`saved ${name}.html only`)
}

function printSummary(finalUrl: string, pageProps: PageProps, image: unknown) {
  const cards = findPolycards(pageProps)
  console.log(`final URL: ${finalUrl}`)
  console.log(`pageProps keys: ${Object.keys(pageProps).join(', ')}`)
  console.log(`polycards: ${cards.length}`)
  const first = cards[0]
  if (first) {
    console.log(`first card metadata: ${JSON.stringify(first.metadata)}`)
    const components: { type?: unknown }[] = Array.isArray(first.components) ? first.components : []
    console.log(`first card components: ${components.map((c) => String(c?.type)).join(', ')}`)
  }
  console.log(`first card image: ${JSON.stringify(image)}`)
}

function applicableCoupons(pageProps: PageProps, wanted: string, now: Date): CouponEntry[] {
  const ready = parseCouponPage(pageProps).coupons.filter((coupon) => canApply(coupon, now))
  if (wanted !== STRONGEST) return ready.filter(({ parsed }) => parsed.campaignId === wanted)
  return ready
    .sort((a, b) => compareStrength(a.parsed, b.parsed))
    .slice(0, STRONGEST_CANDIDATES)
}

function redactedUrl(url: string): string {
  const u = new URL(url)
  if (u.searchParams.has(ACTIVATE_CODE_PARAM)) u.searchParams.set(ACTIVATE_CODE_PARAM, REDACTED)
  return u.toString()
}

function redactedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) =>
    [k, TOKEN_HEADER.test(k) || v.includes(ACTIVATE_CODE_PARAM) ? REDACTED : v]))
}

function parsedBody(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) => key === CODE_KEY && typeof value === 'string' && value !== '' ? REDACTED : value)
  } catch {
    return text.slice(0, BODY_LIMIT)
  }
}

function bodyShape(body: unknown): string {
  if (typeof body === 'string') return `not JSON, ${body.length} chars kept`
  return typeof body === 'object' && body !== null ? `keys ${Object.keys(body).join(', ')}` : typeof body
}

async function clickAndRecord(
  page: Page, context: BrowserContext, pageProps: PageProps, html: string, target: CouponEntry, button: Locator,
) {
  const otherRequests: { method: string; url: string }[] = []
  const onRequest = (r: BrowserRequest) => {
    if (r.method() !== 'GET') otherRequests.push({ method: r.method(), url: redactedUrl(r.url()) })
  }
  page.on('request', onRequest)
  const response = await clickApply(page, button, target.parsed.campaignId).catch((e: unknown) => {
    console.log(`click failed: ${firstLine(e)}`)
    return null
  })
  await sleep(SETTLE_MS)
  page.off('request', onRequest)
  const record: Record<string, unknown> = {
    campaignId: target.parsed.campaignId,
    title: target.parsed.title,
    scope: target.parsed.scopeLabel,
    urlAfter: page.url(),
    otherRequests,
  }
  console.log(`url after click: ${page.url()}`)
  console.log(`non-GET requests after click: ${otherRequests.map((r) => `${r.method} ${new URL(r.url).pathname}`).join(', ')}`)
  if (!response) {
    console.log('activate: no activation response within the timeout')
  } else {
    const request = response.request()
    const headers = Object.fromEntries(Object.entries(await request.allHeaders()).filter(([k]) => k !== DROPPED_HEADER))
    const body = parsedBody(await response.text().catch(() => ''))
    const cookies = await context.cookies()
    const tokenSources = Object.entries(headers).filter(([k]) => TOKEN_HEADER.test(k)).map(([header, value]) => ({
      header,
      length: value.length,
      pageProps: pathOf(pageProps, value),
      inHtml: html.includes(value),
      cookieNames: cookies.filter((c) => c.value === value || c.value === encodeURIComponent(value)).map((c) => c.name),
    }))
    record.request = { method: request.method(), url: redactedUrl(request.url()), headers: redactedHeaders(headers), postData: request.postData() }
    record.response = { status: response.status(), body }
    record.tokenSources = tokenSources
    console.log(`request: ${request.method()} ${redactedUrl(request.url())}`)
    console.log(`request headers: ${Object.keys(headers).join(', ')}`)
    console.log(`post data: ${request.postData() === null ? 'none' : `${request.postData()?.length} chars`}`)
    console.log(`token headers: ${JSON.stringify(tokenSources)}`)
    console.log(`response: ${response.status()}, ${bodyShape(body)}`)
  }
  await writeFile(join(CAPTURE_DIR, 'activation.json'), JSON.stringify(record, null, 2))
  console.log('saved activation.json')
}

async function captureActivation(page: Page, context: BrowserContext, pageProps: PageProps, html: string, wanted: string) {
  const candidates = applicableCoupons(pageProps, wanted, new Date())
  for (const candidate of candidates) {
    const prepared = await prepareApply(page, candidate)
    console.log(`activate candidate ${candidate.parsed.campaignId} "${candidate.parsed.title}" | ${candidate.parsed.scopeLabel}: ${prepared.ok ? 'one matching button' : prepared.error}`)
    if (prepared.ok) return clickAndRecord(page, context, pageProps, html, candidate, prepared.button)
  }
  console.log('activate: no candidate with exactly one matching button, nothing clicked')
}

async function capture(page: Page, context: BrowserContext, url: string, name: string, wanted: string | undefined) {
  console.log(`startup pages: ${context.pages().map((p) => p.url()).join(', ')}`)
  let loaded: LoadedPage
  try {
    loaded = await loadPageProps(page, url)
  } catch (e) {
    if (!isRunStop(e)) await saveFallback(page, name).catch(() => undefined)
    throw e
  }
  const image = await readFirstImage(page)
  const html = await page.content()
  await writeFile(join(CAPTURE_DIR, `${name}.json`), JSON.stringify(loaded.pageProps, null, 2))
  await writeFile(join(CAPTURE_DIR, `${name}.html`), html)
  printSummary(loaded.finalUrl, loaded.pageProps, image)
  console.log(`saved ${name}.json and ${name}.html`)
  if (wanted) await captureActivation(page, context, loaded.pageProps, html, wanted)
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { activate: { type: 'string' } } })
  const [input, name = DEFAULT_NAME] = positionals
  const url = input ? safeMlUrl(input) : null
  if (!url || !CAPTURE_NAME.test(name)) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  await mkdir(CAPTURE_DIR, { recursive: true })
  await withMlBrowser('hidden', (page, context) => capture(page, context, url, name, values.activate))
}

main().catch((e: unknown) => {
  console.error(isRunStop(e) ? `STOP ${e.status}: ${e.message}` : e)
  process.exitCode = 1
})
