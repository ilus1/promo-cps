import { beforeEach, expect, test, vi } from 'vitest'
import type { FetchedPage } from '../market/fetched-page'
import { createSiteGate } from './site-gate'
import { watchSources, type WatchSources } from './sources'

const NOW = new Date('2026-11-06T12:00:00Z')
const WALL: FetchedPage = { status: 503, html: '' }

let http: ReturnType<typeof vi.fn<(url: string) => Promise<FetchedPage>>>
let chrome: ReturnType<typeof vi.fn<(url: string, scroll: boolean) => Promise<FetchedPage>>>
let closeChrome: ReturnType<typeof vi.fn<() => Promise<void>>>
let idle: boolean
let sources: WatchSources

beforeEach(() => {
  idle = true
  http = vi.fn(async () => WALL)
  chrome = vi.fn(async () => WALL)
  closeChrome = vi.fn(async () => undefined)
  const gate = createSiteGate({
    now: () => NOW, sleep: async () => undefined, hold: async () => null, idle: () => idle, random: () => 0, log: () => undefined,
  })
  sources = watchSources({ gate, http, chrome: { load: chrome, close: closeChrome }, now: () => NOW })
})

test.each([
  ['americanasByEan', '7891234567895', 'https://www.americanas.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:7891234567895'],
  ['americanasByText', 'fone jbl', 'https://www.americanas.com.br/api/catalog_system/pub/products/search?ft=fone%20jbl'],
  ['americanasLink', 'fone-jbl', 'https://www.americanas.com.br/api/catalog_system/pub/products/search/fone-jbl/p'],
  ['americanasQuote', '123:456', 'https://www.americanas.com.br/api/catalog_system/pub/products/search?fq=productId:123'],
  ['kabumQuote', '925350', 'https://www.kabum.com.br/produto/925350'],
  ['buscapeSearch', 'fone jbl', 'https://www.buscape.com.br/search?q=fone+jbl'],
] as const)('%s goes over plain HTTP to its own URL', async (operation, input, url) => {
  const result = await sources[operation](input)
  expect(http).toHaveBeenCalledWith(url)
  expect(chrome).not.toHaveBeenCalled()
  expect(result.kind).toBe('wall')
})

test.each([
  ['amazonSearch', '7891234567895', 'https://www.amazon.com.br/s?k=7891234567895', false],
  ['amazonQuote', 'B0C1234567', 'https://www.amazon.com.br/dp/B0C1234567', false],
  ['kabumSearch', 'fone jbl', 'https://www.kabum.com.br/busca/fone-jbl', true],
] as const)('%s goes through Chrome', async (operation, input, url, scroll) => {
  const result = await sources[operation](input)
  expect(chrome).toHaveBeenCalledWith(url, scroll)
  expect(http).not.toHaveBeenCalled()
  expect(result.kind).toBe('wall')
})

test('the Chrome sources wait while an ML job runs, closing the browser, and the HTTP ones do not', async () => {
  idle = false
  expect(await sources.amazonSearch('fone')).toEqual({ kind: 'skipped', reason: 'ml_busy' })
  expect(await sources.kabumSearch('fone')).toEqual({ kind: 'skipped', reason: 'ml_busy' })
  expect(chrome).not.toHaveBeenCalled()
  expect(closeChrome).toHaveBeenCalledTimes(2)
  expect((await sources.kabumQuote('925350')).kind).toBe('wall')
})

test('a Buscapé product page goes over plain HTTP and keeps only offers of the product', async () => {
  const page = `<link rel="canonical" href="https://www.buscape.com.br/fone-de-ouvido/fone-jbl"><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { initialReduxState: { offers: { offerList: [
      { name: 'Fone de Ouvido JBL Tune 520BT Bluetooth', price: 299.9, sellerName: 'Want Import' },
      { name: 'Geladeira Brastemp Frost Free 375 Litros', price: 2999, sellerName: 'Loja X' },
    ] } } },
  })}</script>`
  http.mockResolvedValue({ status: 200, html: page })
  const result = await sources.buscapeQuotes('fone-de-ouvido/fone-jbl', 'Fone JBL Tune 520BT')
  expect(http).toHaveBeenCalledWith('https://www.buscape.com.br/fone-de-ouvido/fone-jbl')
  expect(chrome).not.toHaveBeenCalled()
  expect(result.kind === 'ok' && result.value.map((quote) => quote.merchant)).toEqual(['Want Import'])
  const unnamed = await sources.buscapeQuotes('fone-de-ouvido/fone-jbl', null)
  expect(unnamed.kind === 'ok' && unnamed.value.map((quote) => quote.merchant)).toEqual(['Want Import', 'Loja X'])
})

test('an Americanas quote reads its SKU from the JSON body', async () => {
  http.mockResolvedValue({ status: 200, html: '[]' })
  expect(await sources.americanasQuote('123:456')).toEqual({ kind: 'missing', reason: 'nenhum produto' })
})
