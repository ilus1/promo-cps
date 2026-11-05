import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KABUM_DEPARTMENTS, KABUM_PAGE_SIZE, KABUM_SITEMAP_EXCLUDED } from '../constants'
import { kabumListingUrl, kabumSitemapIndexUrl, parseKabumListing, parseKabumSitemapIndex } from './parse-kabum'

const URL = 'https://www.kabum.com.br/celular-smartphone/smartphones?page_number=1&page_size=60'
const NOW = new Date('2026-11-04T21:00:00Z')
const CAMPAIGN_START = 1_793_791_560
const CAMPAIGN_END = 1_795_521_600
const atSecond = (seconds: number) => new Date(seconds * 1000)
const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const SMARTPHONES = fixture('kabum-smartphones.html')

const PRODUCT = {
  code: 123,
  name: 'Fone JBL Tune 520BT',
  friendlyName: 'fone-jbl-tune-520bt',
  sellerName: 'KaBuM!',
  manufacturer: { name: 'JBL' },
  price: 299.9,
  priceWithDiscount: 269.91,
  oldPrice: 399.9,
  available: true,
  flags: { isOpenbox: false },
}
const CAMPAIGN = { startsAt: CAMPAIGN_START, endsAt: CAMPAIGN_END, price: 249.9, priceWithDiscount: 224.91 }

function kabumPage(products: unknown[], meta: unknown = { totalItemsCount: 61, totalPagesCount: 2, page: { number: 2 } }): string {
  const data = JSON.stringify({ catalogServer: { meta, data: products } })
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data } } })}</script></body></html>`
}

function offersOf(html: string, now: Date = NOW) {
  const page = parseKabumListing(200, html, URL, now)
  if (page.kind !== 'results') throw new Error(page.reason)
  return page.offers
}

describe('parseKabumListing on the smartphones page', () => {
  const page = parseKabumListing(200, SMARTPHONES, URL, NOW)

  it('reads all 60 products and the page meta', () => {
    expect(page.kind).toBe('results')
    if (page.kind !== 'results') return
    expect(page.offers).toHaveLength(60)
    expect(page.extra).toEqual({ page: 1, totalPages: 44, totalItems: 2599 })
  })

  it('maps a product to an offer at the PIX price', () => {
    expect(offersOf(SMARTPHONES)[0]).toEqual({
      regularPriceCents: null,
      priceUntil: null,
      retailer: 'kabum',
      listingId: '927085',
      title: 'Smartphone Samsung Galaxy A17, 128GB, RAM 4GB, Câmera Tripla 50MP + Selfie 13MP, Tela 6.7", Preto - Sm-A175fzklzto',
      brand: 'Samsung',
      seller: 'STI COMPUTADORES',
      priceCents: 84_238,
      listPriceCents: null,
      inStock: true,
      url: 'https://www.kabum.com.br/produto/927085/smartphone-ssg-glxy-a17-4g-128gb-sm-a175fzklzto-preto',
      source: 'kabum_catalog',
    })
  })

  it('keeps marketplace sellers, and lists the card price under a campaign at the regular PIX price', () => {
    const offer = offersOf(SMARTPHONES).find((item) => item.listingId === '921218')
    expect(offer).toMatchObject({ seller: 'Magalu', priceCents: 79_830, regularPriceCents: 79_830, listPriceCents: 88_700 })
  })

  it('uses the AGORA OU NUNCA price while the campaign runs', () => {
    expect(offersOf(SMARTPHONES).find((item) => item.listingId === '925350')).toMatchObject({
      priceCents: 849_999,
      regularPriceCents: 1_299_900,
      listPriceCents: 1_444_333,
      priceUntil: atSecond(CAMPAIGN_END),
    })
  })

  it('uses the regular PIX price before the campaign starts', () => {
    const before = offersOf(SMARTPHONES, atSecond(CAMPAIGN_START - 1)).find((item) => item.listingId === '925350')
    expect(before).toMatchObject({ priceCents: 1_299_900, regularPriceCents: null, priceUntil: null, listPriceCents: null })
  })

  it('gives every offer a product URL and a positive price', () => {
    for (const offer of offersOf(SMARTPHONES)) {
      expect(offer.url.startsWith(`https://www.kabum.com.br/produto/${offer.listingId}/`)).toBe(true)
      expect(offer.priceCents).toBeGreaterThan(0)
    }
  })
})

describe('parseKabumListing on a department root', () => {
  it('reads the hardware root like a subcategory page', () => {
    const page = parseKabumListing(200, fixture('kabum-hardware.html'), 'https://www.kabum.com.br/hardware?page_number=1&page_size=60', NOW)
    expect(page.kind).toBe('results')
    if (page.kind !== 'results') return
    expect(page.extra).toEqual({ page: 1, totalPages: 144, totalItems: 8632 })
    expect(page.offers).toHaveLength(60)
    expect(page.offers.every((offer) => offer.source === 'kabum_catalog' && offer.priceCents > 0)).toBe(true)
  })
})

describe('parseKabumListing product rules', () => {
  it('uses the PIX price and the old price as the list price when it is above the card price', () => {
    expect(offersOf(kabumPage([PRODUCT]))[0]).toMatchObject({ priceCents: 26_991, listPriceCents: 39_990, inStock: true })
  })
  it('falls back to the card price when the PIX price is 0 or missing', () => {
    expect(offersOf(kabumPage([{ ...PRODUCT, priceWithDiscount: 0 }]))[0].priceCents).toBe(29_990)
    expect(offersOf(kabumPage([{ ...PRODUCT, priceWithDiscount: undefined }]))[0].priceCents).toBe(29_990)
  })
  it('gives no list price when the old price is not above the card price', () => {
    expect(offersOf(kabumPage([{ ...PRODUCT, oldPrice: 299.9 }]))[0].listPriceCents).toBeNull()
    expect(offersOf(kabumPage([{ ...PRODUCT, oldPrice: 0 }]))[0].listPriceCents).toBeNull()
  })
  it('uses an active campaign price, keeping the PIX price as the regular one and the card price as the list price', () => {
    expect(offersOf(kabumPage([{ ...PRODUCT, offer: CAMPAIGN }]))[0]).toMatchObject({
      priceCents: 22_491, regularPriceCents: 26_991, listPriceCents: 29_990, priceUntil: atSecond(CAMPAIGN_END),
    })
  })
  it('falls back to the campaign card price when its PIX price is 0', () => {
    expect(offersOf(kabumPage([{ ...PRODUCT, offer: { ...CAMPAIGN, priceWithDiscount: 0 } }]))[0].priceCents).toBe(24_990)
  })
  it('starts the campaign at startsAt and ends it at endsAt', () => {
    const page = kabumPage([{ ...PRODUCT, offer: CAMPAIGN }])
    expect(offersOf(page, atSecond(CAMPAIGN_START))[0].priceCents).toBe(22_491)
    expect(offersOf(page, new Date(atSecond(CAMPAIGN_END).getTime() - 1))[0].priceCents).toBe(22_491)
    expect(offersOf(page, atSecond(CAMPAIGN_END))[0]).toMatchObject({ priceCents: 26_991, regularPriceCents: null, priceUntil: null })
  })
  it('ignores a campaign without dates or prices, or that is not an object', () => {
    for (const offer of [null, 'x', { ...CAMPAIGN, startsAt: undefined }, { ...CAMPAIGN, price: 0, priceWithDiscount: 0 }]) {
      expect(offersOf(kabumPage([{ ...PRODUCT, offer }]))[0]).toMatchObject({ priceCents: 26_991, regularPriceCents: null, priceUntil: null })
    }
  })
  it('gives no list price when the card price is not above the campaign price', () => {
    expect(offersOf(kabumPage([{ ...PRODUCT, price: 224.91, offer: CAMPAIGN }]))[0].listPriceCents).toBeNull()
  })
  it('uses an active campaign price even above the regular PIX price, as Kabum displays it', () => {
    const dearer = { ...CAMPAIGN, price: 349.9, priceWithDiscount: 314.91 }
    expect(offersOf(kabumPage([{ ...PRODUCT, offer: dearer }]))[0]).toMatchObject({
      priceCents: 31_491, regularPriceCents: 26_991, listPriceCents: null, priceUntil: atSecond(CAMPAIGN_END),
    })
  })
  it('uses the regular rule when the campaign end is not a valid date', () => {
    const endless = { ...CAMPAIGN, endsAt: 1e13 }
    expect(offersOf(kabumPage([{ ...PRODUCT, offer: endless }]))[0]).toMatchObject({ priceCents: 26_991, regularPriceCents: null, priceUntil: null })
  })
  it('strips NUL from the texts and drops a price too big to store', () => {
    const offers = offersOf(kabumPage([
      { ...PRODUCT, code: 1, name: 'Fone\u0000 JBL', sellerName: 'Ka\u0000BuM!' },
      { ...PRODUCT, code: 2, price: 30_000_000, priceWithDiscount: 25_000_000 },
    ]))
    expect(offers.map((offer) => [offer.listingId, offer.title, offer.seller])).toEqual([['1', 'Fone JBL', 'KaBuM!']])
  })
  it('skips open-box products', () => {
    const offers = offersOf(kabumPage([{ ...PRODUCT, code: 1, flags: { isOpenbox: true } }, PRODUCT]))
    expect(offers.map((offer) => offer.listingId)).toEqual(['123'])
    const onlyOpenBox = parseKabumListing(200, kabumPage([{ ...PRODUCT, flags: { isOpenbox: true } }]), URL, NOW)
    expect(onlyOpenBox.kind === 'results' && onlyOpenBox.offers).toEqual([])
  })
  it('is out of stock unless available is true', () => {
    expect(offersOf(kabumPage([{ ...PRODUCT, available: false }]))[0].inStock).toBe(false)
    expect(offersOf(kabumPage([{ ...PRODUCT, available: 'true' }]))[0].inStock).toBe(false)
  })
  it('drops products with no name, no code or no positive price, and repeated codes', () => {
    const offers = offersOf(kabumPage([
      { ...PRODUCT, name: ' ' },
      { ...PRODUCT, code: null },
      { ...PRODUCT, price: 0, priceWithDiscount: 0 },
      { ...PRODUCT, price: -1, priceWithDiscount: undefined },
      null,
      PRODUCT,
      { ...PRODUCT, name: 'Outro nome' },
    ]))
    expect(offers.map((offer) => offer.title)).toEqual(['Fone JBL Tune 520BT'])
  })
  it('leaves brand and seller empty when missing, and the URL without a slug when there is no friendly name', () => {
    expect(offersOf(kabumPage([{ ...PRODUCT, manufacturer: null, sellerName: '', friendlyName: undefined }]))[0]).toMatchObject({
      brand: null, seller: null, url: 'https://www.kabum.com.br/produto/123',
    })
  })
  it('reads the meta, and falls back to the URL page when the meta is missing', () => {
    const page = parseKabumListing(200, kabumPage([PRODUCT]), URL, NOW)
    expect(page.kind === 'results' && page.extra).toEqual({ page: 2, totalPages: 2, totalItems: 61 })
    const bare = parseKabumListing(200, kabumPage([PRODUCT], null), 'https://www.kabum.com.br/tv?page_number=7&page_size=60', NOW)
    expect(bare.kind === 'results' && bare.extra).toEqual({ page: 7, totalPages: 7, totalItems: 0 })
  })
})

describe('parseKabumListing page kinds', () => {
  it('is missing on 404', () => {
    expect(parseKabumListing(404, '', URL, NOW)).toEqual({ kind: 'missing', reason: 'HTTP 404' })
  })
  it.each([403, 429, 503])('is a wall on %i', (status) => {
    expect(parseKabumListing(status, fixture('magalu-403.html'), URL, NOW)).toEqual({ kind: 'wall', reason: `HTTP ${status}` })
  })
  it('is unknown on another status or no response', () => {
    expect(parseKabumListing(500, SMARTPHONES, URL, NOW)).toEqual({ kind: 'unknown', reason: 'HTTP 500' })
    expect(parseKabumListing(0, '', URL, NOW)).toEqual({ kind: 'unknown', reason: 'sem resposta' })
  })
  it('is unknown without __NEXT_DATA__', () => {
    expect(parseKabumListing(200, fixture('magalu-403.html'), URL, NOW)).toEqual({ kind: 'unknown', reason: 'sem __NEXT_DATA__' })
  })
  it('is unknown on unparsable JSON, outside or inside the data string', () => {
    const broken = '<script id="__NEXT_DATA__" type="application/json">{"props":</script>'
    expect(parseKabumListing(200, broken, URL, NOW)).toEqual({ kind: 'unknown', reason: 'JSON inválido' })
    const brokenData = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: '{"catalog' } } })}</script>`
    expect(parseKabumListing(200, brokenData, URL, NOW)).toEqual({ kind: 'unknown', reason: 'JSON inválido' })
  })
  it('is unknown when the data has no catalog', () => {
    const noCatalog = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: {} } })}</script>`
    expect(parseKabumListing(200, noCatalog, URL, NOW)).toEqual({ kind: 'unknown', reason: 'sem catálogo' })
  })
  it('is unknown when there are products but none can be read', () => {
    const renamed = SMARTPHONES.replaceAll('\\"name\\":', '\\"title\\":')
    expect(renamed).not.toBe(SMARTPHONES)
    expect(parseKabumListing(200, renamed, URL, NOW)).toEqual({ kind: 'unknown', reason: 'produtos ilegíveis' })
    expect(parseKabumListing(200, kabumPage([{ ...PRODUCT, price: '299,90', priceWithDiscount: null }]), URL, NOW)).toEqual({ kind: 'unknown', reason: 'produtos ilegíveis' })
  })
  it('is empty with 0 products', () => {
    expect(parseKabumListing(200, kabumPage([]), URL, NOW)).toEqual({ kind: 'empty', reason: 'sem produtos' })
  })
})

describe('kabumListingUrl', () => {
  it('asks for one page of the department, with no sort parameter', () => {
    expect(kabumListingUrl('tv', 3)).toBe(`https://www.kabum.com.br/tv?page_number=3&page_size=${KABUM_PAGE_SIZE}`)
  })
  it('covers 26 distinct departments', () => {
    expect(new Set(KABUM_DEPARTMENTS).size).toBe(26)
    for (const slug of KABUM_DEPARTMENTS) expect(kabumListingUrl(slug, 1)).not.toContain('sort=')
  })
})

describe('parseKabumSitemapIndex', () => {
  const INDEX = fixture('kabum-sitemap-index.xml')
  const entry = (loc: string) => `<sitemap><loc>${loc}</loc><lastmod>2026-11-04</lastmod></sitemap>`

  it('gives the product departments of the live index, which are the fallback list', () => {
    expect(parseKabumSitemapIndex(200, INDEX)).toEqual(KABUM_DEPARTMENTS)
  })
  it('leaves out the institutional, search, promotion, store, brand and service sitemaps', () => {
    const departments = parseKabumSitemapIndex(200, INDEX)
    for (const slug of KABUM_SITEMAP_EXCLUDED) {
      expect(INDEX).toContain(`https://www.kabum.com.br/sitemap/${slug}.xml`)
      expect(departments).not.toContain(slug)
    }
  })
  it('keeps index order, skips other URLs and repeats', () => {
    const xml = [
      entry(' https://www.kabum.com.br/sitemap/tv.xml '),
      entry('https://www.kabum.com.br/sitemap/hardware.xml'),
      entry('https://www.kabum.com.br/sitemap/tv.xml'),
      entry('https://www.kabum.com.br/sitemap/marcas.xml'),
      entry('https://www.kabum.com.br/produto/123'),
      entry('https://example.com/sitemap/audio.xml'),
      entry('https://www.kabum.com.br/sitemap/Audio Bad.xml'),
    ].join('')
    expect(parseKabumSitemapIndex(200, `<sitemapindex>${xml}</sitemapindex>`)).toEqual(['tv', 'hardware'])
  })
  it('gives null when no product department remains', () => {
    expect(parseKabumSitemapIndex(200, entry('https://www.kabum.com.br/sitemap/lojas.xml'))).toBeNull()
    expect(parseKabumSitemapIndex(200, entry('https://static.kabum.com.br/sitemap/tv.xml'))).toBeNull()
  })
  it('gives null on another status or with no entries', () => {
    expect(parseKabumSitemapIndex(404, INDEX)).toBeNull()
    expect(parseKabumSitemapIndex(403, INDEX)).toBeNull()
    expect(parseKabumSitemapIndex(0, '')).toBeNull()
    expect(parseKabumSitemapIndex(200, fixture('magalu-403.html'))).toBeNull()
  })
  it('has a fixed index URL', () => {
    expect(kabumSitemapIndexUrl()).toBe('https://www.kabum.com.br/sitemap.xml')
  })
})
