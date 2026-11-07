import { describe, expect, it } from 'vitest'
import { isMlHost, searchSlug, safeMlUrl } from './ml-url'

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
