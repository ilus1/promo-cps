import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  amazonBestsellersRootUrl, amazonSearchUrl, parseAmazonBestsellerRoot, parseAmazonBestsellers, parseAmazonSearch,
} from './parse-amazon'
import type { MarketOffer, ParsedPage } from './types'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const SEARCH = fixture('amazon-search-a55.html')
const BESTSELLERS = fixture('amazon-bestsellers-electronics.html')
const ELECTRONICS = 'https://www.amazon.com.br/gp/bestsellers/electronics'
const NODE = `${ELECTRONICS}/16243803011`

function offersOf<Extra>(page: ParsedPage<Extra>): MarketOffer[] {
  if (page.kind !== 'results') throw new Error(page.reason)
  return page.offers
}

function extraOf<Extra>(page: ParsedPage<Extra>): Extra {
  if (page.kind !== 'results') throw new Error(page.reason)
  return page.extra
}

describe('parseAmazonSearch on the Galaxy A55 search', () => {
  const page = parseAmazonSearch(200, SEARCH)
  const offers = offersOf(page)
  const byAsin = (asin: string) => offers.find((offer) => offer.listingId === asin)

  it('reads one offer per distinct ASIN among the 60 cards', () => {
    expect(offers).toHaveLength(59)
    expect(extraOf(page)).toEqual({ resultCount: 59 })
  })

  it('maps a sponsored card with its displayed price and the struck De price', () => {
    expect(offers[0]).toEqual({
      retailer: 'amazon',
      listingId: 'B0DYVNRG3B',
      title: 'Celular Samsung Galaxy A36 5G 128GB, 6GB RAM, Câmera 50MP, IP67, Super AMOLED 6.7", Recursos AI, Branco',
      brand: null,
      seller: null,
      priceCents: 131_198,
      listPriceCents: 269_900,
      regularPriceCents: null,
      priceUntil: null,
      inStock: true,
      url: 'https://www.amazon.com.br/dp/B0DYVNRG3B',
      source: 'amazon_search',
    })
  })

  it('takes the list price only from a struck price, never from the installment', () => {
    expect(byAsin('B0CTKSWNW6')).toMatchObject({ priceCents: 13_451, listPriceCents: null })
    expect(byAsin('B0CW3K5N69')).toMatchObject({ priceCents: 1890, listPriceCents: null })
    expect(byAsin('B0FTMTB7HB')).toMatchObject({ priceCents: 120_555, listPriceCents: 126_900 })
  })

  it('gives every offer a title, a positive price and a product URL', () => {
    for (const offer of offers) {
      expect(offer.title.length).toBeGreaterThan(0)
      expect(offer.priceCents).toBeGreaterThan(0)
      expect(offer.url).toBe(`https://www.amazon.com.br/dp/${offer.listingId}`)
    }
  })

  it('drops a card without a title or a displayed price but still counts it as a result', () => {
    const card = (asin: string, inner: string) => `<div data-asin="${asin}" data-component-type="s-search-result">${inner}</div>`
    const price = '<span class="a-price" data-a-size="xl"><span class="a-offscreen">R$&nbsp;18,90</span></span>'
    const installment = '<span class="a-price a-text-price"><span class="a-offscreen">R$&nbsp;9,45</span></span>'
    const page = parseAmazonSearch(200, [
      card('B000000001', `<h2><span>Capa A55</span></h2>${price}`),
      card('B000000002', `<h2><span>Capa A55 Preta</span></h2>${installment}`),
      card('B000000003', price),
      card('', `<h2><span>Sem ASIN</span></h2>${price}`),
    ].join(''))
    expect(offersOf(page).map((offer) => [offer.listingId, offer.priceCents])).toEqual([['B000000001', 1890]])
    expect(extraOf(page)).toEqual({ resultCount: 3 })
  })

  it('ends the last card at the pagination, so later widgets lend it no price', () => {
    const card = '<div data-asin="B000000001" data-component-type="s-search-result"><h2><span>Capa A55</span></h2></div>'
    const priced = '<div data-asin="B000000002" data-component-type="s-search-result"><h2><span>Capa A55 Preta</span></h2><span class="a-price"><span class="a-offscreen">R$&nbsp;18,90</span></span></div>'
    const widget = '<span class="a-price"><span class="a-offscreen">R$&nbsp;9,99</span></span>'
    const pagination = '<div role="navigation" data-component-type="s-pagination"></div>'
    expect(offersOf(parseAmazonSearch(200, `${priced}${card}${pagination}${widget}`)).map((offer) => offer.listingId)).toEqual(['B000000002'])
    expect(offersOf(parseAmazonSearch(200, `${priced}${card}${widget}`)).map((offer) => offer.listingId)).toEqual(['B000000002', 'B000000001'])
  })

  it('is unknown when the cards are there but no offer can be read', () => {
    const noTitles = SEARCH.replaceAll('<h2', '<h3').replaceAll('</h2>', '</h3>')
    const noPrices = SEARCH.replaceAll('a-offscreen', 'a-price-whole-x')
    expect(parseAmazonSearch(200, noTitles)).toEqual({ kind: 'unknown', reason: 'cards ilegíveis' })
    expect(parseAmazonSearch(200, noPrices)).toEqual({ kind: 'unknown', reason: 'cards ilegíveis' })
  })

  it('strips NUL decoded from an entity and drops a price too big to store', () => {
    const card = (asin: string, title: string, amount: string) =>
      `<div data-asin="${asin}" data-component-type="s-search-result"><h2><span>${title}</span></h2><span class="a-price"><span class="a-offscreen">R$&nbsp;${amount}</span></span></div>`
    const page = parseAmazonSearch(200, `${card('B000000001', 'Capa&#0; A55', '18,90')}${card('B000000002', 'Capa A55 Preta', '99.999.999,99')}`)
    expect(offersOf(page).map((offer) => [offer.listingId, offer.title])).toEqual([['B000000001', 'Capa A55']])
  })

  it('ignores wall words inside scripts', () => {
    const page = parseAmazonSearch(200, `${SEARCH}<script>var t = "Algo deu errado. Digite os caracteres"</script>`)
    expect(offersOf(page)).toHaveLength(59)
  })
})

describe('parseAmazonSearch page kinds', () => {
  it.each([403, 429, 503])('is a wall on %i', (status) => {
    expect(parseAmazonSearch(status, fixture('amazon-503.html'))).toEqual({ kind: 'wall', reason: `HTTP ${status}` })
  })
  it('is a wall on the captcha form', () => {
    expect(parseAmazonSearch(200, fixture('amazon-captcha.html'))).toEqual({ kind: 'wall', reason: 'captcha' })
    expect(parseAmazonSearch(200, '<form action="/errors/validateCaptcha"></form>')).toEqual({ kind: 'wall', reason: 'captcha' })
  })
  it('is a wall on the "Algo deu errado" page served as 200', () => {
    expect(parseAmazonSearch(200, fixture('amazon-503.html'))).toEqual({ kind: 'wall', reason: 'página de erro' })
  })
  it('is empty on "Nenhum resultado para"', () => {
    expect(parseAmazonSearch(200, fixture('amazon-empty.html'))).toEqual({ kind: 'empty', reason: 'nenhum resultado' })
  })
  it('is unknown with no result cards', () => {
    expect(parseAmazonSearch(200, fixture('magalu-403.html'))).toEqual({ kind: 'unknown', reason: 'página desconhecida' })
  })
  it('is missing on 404 and unknown on no response', () => {
    expect(parseAmazonSearch(404, '')).toEqual({ kind: 'missing', reason: 'HTTP 404' })
    expect(parseAmazonSearch(0, '')).toEqual({ kind: 'unknown', reason: 'sem resposta' })
  })
})

describe('amazonSearchUrl', () => {
  it('joins the encoded query words with +', () => {
    expect(amazonSearchUrl('samsung galaxy a55')).toBe('https://www.amazon.com.br/s?k=samsung+galaxy+a55')
    expect(amazonSearchUrl(' pão & queijo ')).toBe('https://www.amazon.com.br/s?k=p%C3%A3o+%26+queijo')
  })
})

describe('parseAmazonBestsellers on the electronics page', () => {
  const page = parseAmazonBestsellers(200, BESTSELLERS, ELECTRONICS)
  const offers = offersOf(page)

  it('reads the 29 priced cards of the 30 ranked, in rank order', () => {
    expect(offers).toHaveLength(29)
    expect(offers.map((offer) => offer.listingId).slice(0, 3)).toEqual(['B0754J12RW', 'B0C9RVFRZD', 'B0FPYYNQ7Y'])
    expect(offers.some((offer) => offer.listingId === 'B0H1YB1WCT')).toBe(false)
  })

  it('maps a ranked card to an offer', () => {
    expect(offers[0]).toEqual({
      retailer: 'amazon',
      listingId: 'B0754J12RW',
      title: 'Pilha Alcalina, Elgin, Palito AAA, Blister com 4',
      brand: null,
      seller: null,
      priceCents: 666,
      listPriceCents: null,
      regularPriceCents: null,
      priceUntil: null,
      inStock: true,
      url: 'https://www.amazon.com.br/dp/B0754J12RW',
      source: 'amazon_bestsellers',
    })
  })

  it('gives the pg=2 link and the subcategory nodes without ref segments', () => {
    const extra = extraOf(page)
    expect(extra.nextPageUrl).toBe(`${ELECTRONICS}?ie=UTF8&pg=2`)
    expect(extra.nodeUrls).toHaveLength(15)
    expect(extra.nodeUrls[0]).toBe(`${ELECTRONICS}/16243793011`)
    expect(extra.nodeUrls.every((url) => /^https:\/\/www\.amazon\.com\.br\/gp\/bestsellers\/electronics\/\d+$/.test(url))).toBe(true)
  })

  it('gives the pg=2 link also when the URL says pg=1, and none from pg=2', () => {
    expect(extraOf(parseAmazonBestsellers(200, BESTSELLERS, `${ELECTRONICS}?ie=UTF8&pg=1`)).nextPageUrl).toBe(`${ELECTRONICS}?ie=UTF8&pg=2`)
    expect(extraOf(parseAmazonBestsellers(200, BESTSELLERS, `${ELECTRONICS}?ie=UTF8&pg=2`)).nextPageUrl).toBeNull()
  })

  it('leaves the page itself out of the nodes', () => {
    const nodePage = BESTSELLERS.replaceAll('/gp/bestsellers/electronics/ref=zg_bs_pg_', '/gp/bestsellers/electronics/16243803011/ref=zg_bs_pg_')
    const extra = extraOf(parseAmazonBestsellers(200, nodePage, NODE))
    expect(extra.nodeUrls).not.toContain(NODE)
    expect(extra.nodeUrls).toHaveLength(14)
    expect(extra.nextPageUrl).toBe(`${NODE}?ie=UTF8&pg=2`)
  })

  it('uses the same wall rules as the search', () => {
    expect(parseAmazonBestsellers(503, BESTSELLERS, ELECTRONICS)).toEqual({ kind: 'wall', reason: 'HTTP 503' })
    expect(parseAmazonBestsellers(200, fixture('amazon-captcha.html'), ELECTRONICS)).toEqual({ kind: 'wall', reason: 'captcha' })
  })

  it('is unknown with no ranked cards', () => {
    expect(parseAmazonBestsellers(200, fixture('magalu-403.html'), ELECTRONICS)).toEqual({ kind: 'unknown', reason: 'página desconhecida' })
  })
})

describe('parseAmazonBestsellerRoot', () => {
  const ROOT = [
    '<a href="/gp/bestsellers/?ref_=nav_cs_bestsellers">Mais vendidos</a>',
    '<a href="/gp/bestsellers/electronics/ref=zg_bs_nav_electronics_0">Eletrônicos</a>',
    '<a href="/gp/bestsellers/kitchen/ref=zg_bs_nav_kitchen_0">Cozinha</a>',
    '<a href="https://www.amazon.com.br/gp/bestsellers/books/">Livros</a>',
    '<a href="/gp/bestsellers/electronics/16243803011/ref=zg_bs_nav_electronics_1">Celulares</a>',
    '<a href="/gp/new-releases/electronics/ref=zg_bsnr_tab">Novidades</a>',
    '<a href="/gp/bestsellers/kitchen?ie=UTF8&amp;ref_=sv_megamenu">Cozinha</a>',
  ].join('')

  it('gives each department once, without the root, nodes or other lists', () => {
    expect(extraOf(parseAmazonBestsellerRoot(200, ROOT))).toEqual({
      nextPageUrl: null,
      nodeUrls: [
        'https://www.amazon.com.br/gp/bestsellers/electronics',
        'https://www.amazon.com.br/gp/bestsellers/kitchen',
        'https://www.amazon.com.br/gp/bestsellers/books',
      ],
    })
  })
  it('also reads any ranked cards on the page', () => {
    const page = parseAmazonBestsellerRoot(200, BESTSELLERS)
    expect(offersOf(page)).toHaveLength(29)
    expect(extraOf(page).nodeUrls).toEqual([ELECTRONICS])
  })
  it('is unknown with no department links, and follows the wall rules', () => {
    expect(parseAmazonBestsellerRoot(200, '<html></html>')).toEqual({ kind: 'unknown', reason: 'sem departamentos' })
    expect(parseAmazonBestsellerRoot(200, fixture('amazon-captcha.html'))).toEqual({ kind: 'wall', reason: 'captcha' })
  })
  it('has a fixed root URL', () => {
    expect(amazonBestsellersRootUrl()).toBe('https://www.amazon.com.br/gp/bestsellers/')
  })
})
