import { describe, expect, it } from 'vitest'
import { AMERICANAS_ORIGIN, BUSCAPE_ORIGIN, mlItemUrl, parseProductLink } from './links'

const ML_CATALOG_URL = 'https://www.mercadolivre.com.br/p/MLB25454950'
const ML_ITEM_URL = 'https://produto.mercadolivre.com.br/MLB-5163773802'
const AMAZON_URL = 'https://www.amazon.com.br/dp/B0C3V5X3QT'
const KABUM_URL = 'https://www.kabum.com.br/produto/925350'
const AMERICANAS_SLUG = 'fone-de-ouvido-bluetooth-jbl-tune-520bt-preto-7460187432'
const BUSCAPE_REF = 'fone-de-ouvido-e-headset/headphone-bluetooth-com-microfone-jbl-tune-520bt'

describe('parseProductLink for Mercado Livre', () => {
  it.each([
    ['a catalog page', 'https://www.mercadolivre.com.br/fone-de-ouvido-jbl-tune-520bt/p/MLB25454950'],
    ['a catalog page with tracking', 'https://www.mercadolivre.com.br/fone-jbl/p/MLB25454950?pdp_filters=item_id:MLB5163773802#reco_item_pos=1'],
    ['a bare catalog path', 'mercadolivre.com.br/p/mlb25454950'],
  ])('reads %s', (_name, url) => {
    expect(parseProductLink(url)).toEqual({ retailer: 'ml', ref: 'MLB25454950', url: ML_CATALOG_URL })
  })

  it.each([
    ['an item page', 'https://produto.mercadolivre.com.br/MLB-5163773802-fone-de-ouvido-jbl-tune-520bt-_JM'],
    ['an item page with tracking', 'https://produto.mercadolivre.com.br/MLB-5163773802-fone-_JM?searchVariation=123#position=2&type=item'],
    ['an item id without hyphen', 'https://produto.mercadolivre.com.br/MLB5163773802'],
    ['a user product with wid', 'https://www.mercadolivre.com.br/fone-jbl/up/MLBU3045447385#polycard_client=search&wid=MLB5163773802&sid=search'],
    ['a user product with an item filter', 'https://www.mercadolivre.com.br/fone-jbl/up/MLBU3045447385?pdp_filters=item_id%3AMLB5163773802'],
  ])('reads %s', (_name, url) => {
    expect(parseProductLink(url)).toEqual({ retailer: 'ml', ref: 'MLB5163773802', url: ML_ITEM_URL })
  })

  it.each([
    ['a search', 'https://lista.mercadolivre.com.br/fone-jbl-tune-520bt'],
    ['a category id', 'https://lista.mercadolivre.com.br/celulares/_CategoryID_MLB1055'],
    ['a user product without an item', 'https://www.mercadolivre.com.br/fone-jbl/up/MLBU3045447385'],
    ['the coupons page', 'https://www.mercadolivre.com.br/cupons'],
  ])('ignores %s', (_name, url) => {
    expect(parseProductLink(url)).toBeNull()
  })

  it('builds an item url from a ref', () => {
    expect(mlItemUrl('MLB5163773802')).toBe(ML_ITEM_URL)
  })
})

describe('parseProductLink for Amazon', () => {
  it.each([
    ['a detail page', 'https://www.amazon.com.br/JBL-Fone-Ouvido-Tune-520BT/dp/B0C3V5X3QT/ref=sr_1_1?keywords=6925281963650&qid=1'],
    ['a bare detail page', 'https://www.amazon.com.br/dp/B0C3V5X3QT'],
    ['a lowercase asin', 'https://amazon.com.br/dp/b0c3v5x3qt?th=1'],
    ['a gp/product page', 'https://www.amazon.com.br/gp/product/B0C3V5X3QT/ref=ox_sc_act_title_1'],
    ['a mobile page', 'https://www.amazon.com.br/gp/aw/d/B0C3V5X3QT'],
  ])('reads %s', (_name, url) => {
    expect(parseProductLink(url)).toEqual({ retailer: 'amazon', ref: 'B0C3V5X3QT', url: AMAZON_URL })
  })

  it.each([
    ['a search', 'https://www.amazon.com.br/s?k=jbl+tune+520bt'],
    ['a short asin', 'https://www.amazon.com.br/dp/B0C3V5X3'],
    ['a long asin', 'https://www.amazon.com.br/dp/B0C3V5X3QTX'],
    ['another country', 'https://www.amazon.com/dp/B0C3V5X3QT'],
  ])('ignores %s', (_name, url) => {
    expect(parseProductLink(url)).toBeNull()
  })
})

describe('parseProductLink for Kabum', () => {
  it.each([
    ['a product page', 'https://www.kabum.com.br/produto/925350/iphone-17-pro-apple-512gb'],
    ['a product page with tracking', 'https://www.kabum.com.br/produto/925350?utm_source=google#reviews'],
    ['a bare product page', 'kabum.com.br/produto/925350'],
  ])('reads %s', (_name, url) => {
    expect(parseProductLink(url)).toEqual({ retailer: 'kabum', ref: '925350', url: KABUM_URL })
  })

  it.each([
    ['a search', 'https://www.kabum.com.br/busca/jbl-tune-520bt'],
    ['a department', 'https://www.kabum.com.br/celular-smartphone/smartphones'],
    ['a nested product path', 'https://www.kabum.com.br/promocao/produto/925350'],
    ['a non-numeric code', 'https://www.kabum.com.br/produto/abc'],
  ])('ignores %s', (_name, url) => {
    expect(parseProductLink(url)).toBeNull()
  })
})

describe('parseProductLink for Americanas', () => {
  const expected = { retailer: 'americanas', ref: AMERICANAS_SLUG, url: `${AMERICANAS_ORIGIN}/${AMERICANAS_SLUG}/p` }

  it.each([
    ['a product page', `https://www.americanas.com.br/${AMERICANAS_SLUG}/p`],
    ['a product page with a trailing slash and tracking', `https://www.americanas.com.br/${AMERICANAS_SLUG}/p/?skuId=3984675&utm_source=x`],
  ])('reads %s', (_name, url) => {
    expect(parseProductLink(url)).toEqual(expected)
  })

  it.each([
    ['a search', 'https://www.americanas.com.br/s?q=jbl'],
    ['a category', 'https://www.americanas.com.br/fones-de-ouvido'],
    ['a nested path', `https://www.americanas.com.br/categoria/${AMERICANAS_SLUG}/p`],
  ])('ignores %s', (_name, url) => {
    expect(parseProductLink(url)).toBeNull()
  })
})

describe('parseProductLink for Buscapé', () => {
  it.each([
    ['a product page', `https://www.buscape.com.br/${BUSCAPE_REF}`],
    ['a product page with tracking', `https://www.buscape.com.br/${BUSCAPE_REF}?_lc=88&searchterm=jbl#ofertas`],
    ['an uppercase path with a trailing slash', `https://www.buscape.com.br/${BUSCAPE_REF.toUpperCase()}/`],
  ])('reads %s', (_name, url) => {
    expect(parseProductLink(url)).toEqual({ retailer: 'buscape', ref: BUSCAPE_REF, url: `${BUSCAPE_ORIGIN}/${BUSCAPE_REF}` })
  })

  it.each([
    ['a search', 'https://www.buscape.com.br/search?q=jbl'],
    ['an offer redirect', 'https://www.buscape.com.br/lead?oid=1581482214&channel=86'],
    ['a category', 'https://www.buscape.com.br/fone-de-ouvido-e-headset'],
    ['the coupons section', 'https://www.buscape.com.br/cupons/amazon'],
    ['a three-level path', `https://www.buscape.com.br/${BUSCAPE_REF}/ofertas`],
  ])('ignores %s', (_name, url) => {
    expect(parseProductLink(url)).toBeNull()
  })
})

describe('parseProductLink on junk input', () => {
  it.each([
    ['plain text', 'JBL Tune 520BT preto'],
    ['an empty string', ''],
    ['blank space', '   '],
    ['a single word', 'jbl'],
    ['an unknown store', 'https://www.magazineluiza.com.br/fone-jbl/p/237446700/'],
    ['a look-alike host', 'https://www.kabum.com.br.example.com/produto/925350'],
    ['a host with the store as a prefix', 'https://evilkabum.com.br/produto/925350'],
    ['credentials pointing elsewhere', 'https://www.kabum.com.br@example.com/produto/925350'],
    ['a non-web protocol', 'ftp://www.kabum.com.br/produto/925350'],
    ['a script url', 'javascript:alert(1)'],
    ['a broken url', 'https://exa mple.com/produto/1'],
  ])('ignores %s', (_name, text) => {
    expect(parseProductLink(text)).toBeNull()
  })

  it('accepts surrounding spaces and http', () => {
    expect(parseProductLink('  http://www.kabum.com.br/produto/925350  ')).toEqual({ retailer: 'kabum', ref: '925350', url: KABUM_URL })
  })
})
