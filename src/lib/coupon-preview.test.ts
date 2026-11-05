import { describe, expect, it } from 'vitest'
import { COUPON_PREVIEW_COUNT, safeImageUrl, selectPreviews } from './coupon-preview'

describe('safeImageUrl', () => {
  it('accepts an https image on the Mercado Livre image host', () => {
    const url = 'https://http2.mlstatic.com/D_NQ_NP_810630-MLA118151002444_102026-V.webp'
    expect(safeImageUrl(url)).toBe(url)
    expect(safeImageUrl(`  ${url} `)).toBe(url)
  })

  it.each([
    'ftp://http2.mlstatic.com/a.webp',
    'https://evil.example/a.webp',
    'https://http2.mlstatic.com.evil.example/a.webp',
    'https://evil.example/http2.mlstatic.com/a.webp',
    'https://user:pw@http2.mlstatic.com/a.webp',
    'https://http2.mlstatic.com:8443/a.webp',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//http2.mlstatic.com/a.webp',
    'not a url',
    '',
  ])('rejects %j', (input) => {
    expect(safeImageUrl(input)).toBeNull()
  })

  it('upgrades the plain http form Mercado Livre sometimes stores to https', () => {
    expect(safeImageUrl('http://http2.mlstatic.com/D_771456-MLB118013903425_092026-V.webp'))
      .toBe('https://http2.mlstatic.com/D_771456-MLB118013903425_092026-V.webp')
    expect(safeImageUrl('http://evil.example/a.webp')).toBeNull()
  })

  it('rejects a missing value', () => {
    expect(safeImageUrl(null)).toBeNull()
    expect(safeImageUrl(undefined)).toBeNull()
  })
})

describe('selectPreviews', () => {
  const host = 'https://http2.mlstatic.com'
  const preview = (n: number, altText: string, imageUrl: string | null = `${host}/img-${n}.webp`) => ({ imageUrl, altText })
  const six = [
    preview(1, 'Cadeira gamer'), preview(2, 'Mesa de escritorio'), preview(3, 'Notebook Dell'),
    preview(4, 'Fone Bluetooth JBL'), preview(5, 'Notebook Gamer Acer'), preview(6, 'Mouse'),
  ]

  it('ranks a word at the start of a word above the same letters inside another word', () => {
    const list = [preview(1, 'Microfone Lapela'), preview(2, 'Fone JBL'), preview(3, 'Mouse')]
    expect(selectPreviews(list, 'fone').map((p) => p.alt)).toEqual(['Fone JBL', 'Microfone Lapela', 'Mouse'])
  })

  it('keeps the first four in order without a text', () => {
    expect(selectPreviews(six).map((p) => p.alt)).toEqual(['Cadeira gamer', 'Mesa de escritorio', 'Notebook Dell', 'Fone Bluetooth JBL'])
    expect(selectPreviews(six, '').map((p) => p.alt)).toHaveLength(COUPON_PREVIEW_COUNT)
  })

  it('puts the matching products first, the best match before the others, and still shows four', () => {
    expect(selectPreviews(six, 'notebook gamer').map((p) => p.alt))
      .toEqual(['Notebook Gamer Acer', 'Cadeira gamer', 'Notebook Dell', 'Mesa de escritorio'])
  })

  it('ignores case and accents in both the text and the alt text', () => {
    const list = [preview(1, 'Mouse'), preview(2, 'Câmera Digital')]
    expect(selectPreviews(list, 'CAMERA')[0].alt).toBe('Câmera Digital')
  })

  it('drops unsafe images before choosing, so a bad one never takes a slot', () => {
    const list = [preview(1, 'Notebook', 'https://evil.example/a.webp'), preview(2, 'Mouse'), preview(3, 'Teclado', null), preview(4, 'Notebook 2')]
    expect(selectPreviews(list, 'notebook').map((p) => p.alt)).toEqual(['Notebook 2', 'Mouse'])
  })

  it('has nothing for no previews', () => {
    expect(selectPreviews([], 'a')).toEqual([])
  })
})
