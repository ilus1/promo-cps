import { describe, expect, it } from 'vitest'
import { classifyBuscaInput, classifyMlUrl, EMPTY_SEARCH_TEXT, isMlHost, searchSlug, listingLandingKept, safeMlUrl } from './ml-url'

const UNSAFE_URLS = [
  'http://lista.mercadolivre.com.br/x', 'https://evil.com/x', 'not a url',
  'https://mercadolivre.com.br.evil.com/x',
  'https://lista.mercadolivre.com.br/gz/account-verification?go=x',
  'https://www.mercadolivre.com.br/login',
  'https://www.mercadolivre.com.br/captcha',
  'https://user:pw@lista.mercadolivre.com.br/x',
  'https://lista.mercadolivre.com.br:8443/x',
]

describe('isMlHost', () => {
  it.each([
    ['mercadolivre.com.br', true], ['lista.mercadolivre.com.br', true],
    ['evilmercadolivre.com.br', false], ['mercadolivre.com.br.evil.com', false],
  ])('%s -> %s', (host, ok) => expect(isMlHost(host)).toBe(ok))
})

describe('safeMlUrl', () => {
  it('lowercases the host and drops the fragment', () => {
    expect(safeMlUrl(' https://LISTA.MERCADOLIVRE.COM.BR/pagina/x/?coupon_campaign_id=1#top ')).toBe(
      'https://lista.mercadolivre.com.br/pagina/x/?coupon_campaign_id=1',
    )
  })
  it('accepts an ML page that is neither a search nor a product', () => {
    expect(safeMlUrl('https://www.mercadolivre.com.br/cupons')).toBe('https://www.mercadolivre.com.br/cupons')
  })
  it.each(UNSAFE_URLS)('rejects %s', (u) => expect(safeMlUrl(u)).toBeNull())
})

describe('classifyMlUrl', () => {
  it('search page', () => {
    expect(classifyMlUrl('https://lista.mercadolivre.com.br/ssd-nvme-1tb')).toEqual({
      kind: 'search', url: 'https://lista.mercadolivre.com.br/ssd-nvme-1tb',
    })
  })
  it('catalog product page', () => {
    expect(classifyMlUrl('https://www.mercadolivre.com.br/ssd-x/p/MLB54122980')).toMatchObject({ kind: 'product' })
  })
  it('item page', () => {
    expect(classifyMlUrl('https://produto.mercadolivre.com.br/MLB-1234567890-ssd-_JM')).toMatchObject({ kind: 'product' })
  })
  it('drops the fragment', () => {
    expect(classifyMlUrl('https://lista.mercadolivre.com.br/ssd#D[A:ssd]')).toEqual({
      kind: 'search', url: 'https://lista.mercadolivre.com.br/ssd',
    })
  })
  it('accepts an uppercase host', () => {
    expect(classifyMlUrl('https://LISTA.MERCADOLIVRE.COM.BR/x')).toEqual({
      kind: 'search', url: 'https://lista.mercadolivre.com.br/x',
    })
  })
  it.each([...UNSAFE_URLS, 'https://www.mercadolivre.com.br/cupons'])('rejects %s', (u) => {
    expect(classifyMlUrl(u)).toHaveProperty('error')
  })
})

describe('listingLandingKept', () => {
  const host = 'https://lista.mercadolivre.com.br'
  const listing = `${host}/_Container_X?coupon_campaign_id=123`
  const storeListing = `${host}/_CustId_55_Container_X?coupon_campaign_id=123`
  const keeps = (from: string, to: string) => listingLandingKept(from, to)

  it('keeps a landing that carries the same campaign, whatever its path', () => {
    expect(keeps(listing, `${listing}&page=2`)).toBe(true)
    expect(keeps(listing, `${host}/other?coupon_campaign_id=123`)).toBe(true)
  })

  it('rejects a landing with another campaign value', () => {
    expect(keeps(listing, `${host}/_Container_X?coupon_campaign_id=999`)).toBe(false)
  })

  it('keeps a store listing sent to a store path', () => {
    expect(keeps(storeListing, `${host}/pagina/onstylee/`)).toBe(true)
    expect(keeps(storeListing, `${host}/loja/x?a=1`)).toBe(true)
  })

  it('rejects a store listing landing anywhere else', () => {
    expect(keeps(storeListing, `${host}/other`)).toBe(false)
    expect(keeps(storeListing, `${host}/pagina`)).toBe(false)
    expect(keeps(storeListing, 'https://www.mercadolivre.com.br/pagina/x')).toBe(false)
  })

  it('keeps a container listing landing on the same container without the param', () => {
    const live = `${host}/_Container_FH-Cupom-Boost-16?coupon_campaign_id=14633544`
    expect(keeps(live, `${host}/_Container_fh-cupom-boost-16`)).toBe(true)
    expect(keeps(listing, `${host}/_container_x/`)).toBe(true)
  })

  it('rejects a container listing landing on another container or host', () => {
    expect(keeps(listing, `${host}/_Container_Y`)).toBe(false)
    expect(keeps(listing, 'https://www.mercadolivre.com.br/_Container_X')).toBe(false)
    expect(keeps(listing, `${host}/pagina/store`)).toBe(false)
  })

  it('rejects a listing with a param but neither marker when the param is lost', () => {
    expect(keeps(`${host}/plain?coupon_campaign_id=123`, `${host}/plain`)).toBe(false)
  })

  it('requires the same origin and path when the listing names no campaign', () => {
    const plain = `${host}/x`
    expect(keeps(plain, `${plain}?page=2`)).toBe(true)
    expect(keeps(plain, `${host}/X/`)).toBe(true)
    expect(keeps(plain, `${host}/y`)).toBe(false)
    expect(keeps(plain, 'https://www.mercadolivre.com.br/x')).toBe(false)
  })

  it('rejects unparsable urls on either side', () => {
    expect(keeps(listing, 'not a url')).toBe(false)
    expect(keeps('', listing)).toBe(false)
    expect(keeps(listing, '')).toBe(false)
  })
})

describe('classifyMlUrl product shapes', () => {
  it.each([
    'https://www.mercadolivre.com.br/ssd-x/p/MLB54122980',
    'https://www.mercadolivre.com.br/ssd-x/p/MLB54122980/',
    'https://www.mercadolivre.com.br/p/MLB54122980',
    'https://www.mercadolivre.com.br/ssd-x/p/MLB54122980?pdp_filters=item_id%3AMLB1',
    'https://www.mercadolivre.com.br/ssd-x/up/MLBU3456789012',
    'https://www.mercadolivre.com.br/up/MLBU3456789012?pdp_filters=item_id%3AMLB1',
    'https://produto.mercadolivre.com.br/MLB-1234567890-ssd-_JM',
    'https://produto.mercadolivre.com.br/MLB1234567890',
  ])('product: %s', (u) => expect(classifyMlUrl(u)).toMatchObject({ kind: 'product' }))

  it.each([
    'https://www.mercadolivre.com.br/ssd-x/p/MLB54122980/extra',
    'https://www.mercadolivre.com.br/ssd-x/p/MLBabc',
    'https://www.mercadolivre.com.br/ssd-x/p/MLB',
    'https://www.mercadolivre.com.br/a/b/p/MLB54122980',
    'https://www.mercadolivre.com.br/ssd-x/up/MLB54122980',
    'https://www.mercadolivre.com.br/ssd-x/up/MLBU1/extra',
    'https://www.mercadolivre.com.br/noticias/p/MLB54122980x',
    'https://produto.mercadolivre.com.br/',
    'https://produto.mercadolivre.com.br/ofertas',
    'https://produto.mercadolivre.com.br/MLB-123/extra',
    'https://www.mercadolivre.com.br/MLB-1234567890-ssd-_JM',
  ])('not a product: %s', (u) => expect(classifyMlUrl(u)).toHaveProperty('error'))
})

describe('searchSlug', () => {
  it.each([
    ['fone bluetooth', 'fone-bluetooth'],
    ['  Fone   de  Ouvido ', 'fone-de-ouvido'],
    ['Pão de açúcar', 'pao-de-acucar'],
    ['ssd 1TB (nvme)', 'ssd-1tb-nvme'],
    ['a/b?c=d&e', 'a-b-c-d-e'],
    ['fone/headset', 'fone-headset'],
    ['1/2 polegada', '1-2-polegada'],
    ['--fone--', 'fone'],
    ['!!! ???', ''],
    ['', ''],
  ])('%j -> %j', (text, slug) => expect(searchSlug(text)).toBe(slug))

  it('cuts a very long term', () => {
    expect(searchSlug('a '.repeat(100)).length).toBeLessThanOrEqual(80)
  })
})

describe('classifyBuscaInput', () => {
  it('builds the search url from a typed term', () => {
    expect(classifyBuscaInput('Fone Bluetooth')).toEqual({ kind: 'search', url: 'https://lista.mercadolivre.com.br/fone-bluetooth' })
  })

  it('rejects an empty slug', () => {
    expect(classifyBuscaInput('?!')).toEqual({ error: EMPTY_SEARCH_TEXT })
    expect(classifyBuscaInput('   ')).toEqual({ error: EMPTY_SEARCH_TEXT })
  })

  it('treats a host without a scheme as a url, whatever its case', () => {
    expect(classifyBuscaInput('Lista.MercadoLivre.com.br/ssd')).toEqual({ kind: 'search', url: 'https://lista.mercadolivre.com.br/ssd' })
    expect(classifyBuscaInput('lista.mercadolivre.com.br/ssd')).toEqual({ kind: 'search', url: 'https://lista.mercadolivre.com.br/ssd' })
    expect(classifyBuscaInput('www.mercadolivre.com.br/cupons')).toHaveProperty('error')
  })

  it('leaves a pasted url to the url rules', () => {
    const url = 'https://lista.mercadolivre.com.br/ssd'
    expect(classifyBuscaInput(url)).toEqual(classifyMlUrl(url))
    expect(classifyBuscaInput('https://evil.com/x')).toEqual(classifyMlUrl('https://evil.com/x'))
    expect(classifyBuscaInput('http://lista.mercadolivre.com.br/x')).toHaveProperty('error')
  })
})
