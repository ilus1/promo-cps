import { describe, expect, it } from 'vitest'
import listing from './__fixtures__/listing.json'
import { cardsOfResults, findPolycards, mergeCards, parseCard, type Polycard } from './cards'

const ITEM_URL = 'www.mercadolivre.com.br/item/p/MLB9'
const ITEM_PARAMS = '?pdp_filters=item_id%3AMLB1'
const SPONSORED: Polycard['metadata'] = {
  is_pad: 'true', url: 'click1.mercadolivre.com.br/mclics/clicks/external/MLB/count', url_params: '?a=TOKEN',
}

const titleComponent = (text = 'Item') => ({ type: 'title', title: { text } })
const priceComponent = (value: unknown, extra: object = {}) => ({ type: 'price', price: { current_price: { value }, ...extra } })
const polycard = (components: unknown[] = [], metadata: Polycard['metadata'] = {}): Polycard => ({
  metadata: { id: 'MLB1', is_pad: 'false', url: ITEM_URL, url_params: ITEM_PARAMS, ...metadata },
  components: [titleComponent(), priceComponent(100), ...components],
})
const withOnly = (...components: unknown[]): Polycard => ({ ...polycard(), components })

const shipping = (...entries: unknown[]) => ({ type: 'shipping_v2', shipping_v2: entries })
const pill = (key: string, text: string) => ({ type: 'pill', key, pill: { text } })
const freePill = pill('free_shipping_single', '{shipping_truck_quiet_icon} Grátis')
const newBuyer = { type: 'label', key: 'new_buyer', label: { text: 'por ser sua primeira compra' } }
const fullIcon = { type: 'icon', key: 'full_icon', icon: { key: 'vpp_full_icon', alt_text: 'Enviado pelo FULL' } }
const perkEntry = { text: '{free_shipping_single} {new_buyer}', values: [freePill, newBuyer] }
const bareFreeEntry = { text: 'Frete grátis' }

const promotion = (text: string, values: unknown[] = [], type = 'coupon') =>
  ({ type: 'promotions', promotions: [{ type, text, values }] })
const priceValue = (key: string, value: number) => ({ key, type: 'price', price: { value, currency: 'BRL' } })
const hintOf = (text: string, values: unknown[] = []) => parseCard(polycard([promotion(text, values)]))?.couponHint

const seller = (text: string, values: unknown[] = []) => ({ type: 'seller', seller: { text, values } })
const cockade = { key: 'icon_cockade', type: 'icon', icon: { key: 'icon_cockade' } }
const label = (key: string, text: string) => ({ key, type: 'label', label: { text } })

describe('cards in the coupon listing fixture', () => {
  const cards = findPolycards(listing).map(parseCard).filter((c) => c !== null)
  const byId = (id: string) => cards.find((c) => c.id === id)

  it('reads every card in the fixture', () => expect(cards.length).toBe(3))

  it('organic coupon card', () => {
    const c = cards.find((x) => x.basisText === 'com Cupom')!
    expect(c).toMatchObject({ isPad: false, basis: 'coupon' })
    expect(c.priceCents).toBeGreaterThan(0)
    expect(c.url).toMatch(/^https:\/\/www\.mercadolivre\.com\.br\/.+\?pdp_filters=/)
  })

  it('reads every field of the organic coupon card', () => {
    expect(byId('MLB5290670816')).toEqual({
      id: 'MLB5290670816',
      productId: null,
      title: 'Sala De Jantar Mesa Tampo Madeira 4 Cadeiras Tina Madesa Rp',
      thumbnail: 'https://http2.mlstatic.com/D_Q_NP_2X_888205-MLB110648926926_052026-E.webp',
      url: 'https://www.mercadolivre.com.br/sala-de-jantar-mesa-tampo-madeira-4-cadeiras-tina-madesa-rp/up/MLBU3023247720?pdp_filters=deal%3AMLB1890691-1',
      isPad: false,
      priceCents: 31999,
      basisText: 'com Cupom',
      basis: 'coupon',
      listPriceCents: 75292,
      mlDiscountPct: 57,
      soldQuantity: 25,
      full: false,
      freeShipping: false,
      categoryId: 'MLB1627',
      domainId: 'MLB-DINING_KITS',
      sellerLabel: 'MADESA por Madesa moveis',
      couponHint: null,
    })
  })

  it('sponsored card keeps the displayed price and has no url', () => {
    expect(byId('MLB5423723154')).toMatchObject({
      isPad: true, url: null, productId: 'MLB47587989', priceCents: 122300, listPriceCents: 302104,
      basisText: 'no Pix com Cupom', basis: 'pix_coupon', full: null, freeShipping: null, sellerLabel: 'CARRARO',
      soldQuantity: 50,
    })
  })

  it('organic Pix card carries a fixed amount coupon hint', () => {
    expect(byId('MLB3659223609')).toMatchObject({
      isPad: false, productId: 'MLB35802200', priceCents: 34959, basis: 'pix', basisText: 'no Pix',
      url: 'https://www.mercadolivre.com.br/conjunto-2-cadeiras-de-jantar-1736-carraro-caramelo-rose/p/MLB35802200?pdp_filters=deal%3AMLB1890691-1',
      couponHint: { text: 'R$ 200 OFF com Cupom', percentOff: null, amountOffCents: 20000, priceAfterCents: null },
    })
  })

  it('merges into unique ids without click tracker urls', () => {
    const merged = mergeCards(cards)
    expect(new Set(merged.map((c) => c.id)).size).toBe(merged.length)
    expect(merged.every((c) => !c.url || !c.url.includes('click1.'))).toBe(true)
  })
})

describe('findPolycards', () => {
  it('finds each search card twice in the streamed page state', () => {
    const results = () => [{ polycard: polycard([], { id: 'MLB1' }) }, { polycard: polycard([], { id: 'MLB2' }) }]
    const page = {
      getResultsPromise: {
        value: { optimizedResponse: { results: results() }, sharedState: { search: { results: results() } } },
      },
    }
    const found = findPolycards(page)
    expect(found.map((p) => p.metadata?.id)).toEqual(['MLB1', 'MLB2', 'MLB1', 'MLB2'])
    const merged = mergeCards(found.map(parseCard).filter((c) => c !== null))
    expect(merged.map((c) => c.id)).toEqual(['MLB1', 'MLB2'])
  })
  it('skips polycard values that are not objects', () => {
    expect(findPolycards({ a: { polycard: null }, b: [{ polycard: 'x' }, { polycard: [] }], c: 5 })).toEqual([])
    expect(findPolycards(null)).toEqual([])
  })
  it('walks very deep state without recursion', () => {
    let deep: unknown = { polycard: polycard() }
    for (let i = 0; i < 100000; i++) deep = { child: deep }
    expect(findPolycards(deep)).toHaveLength(1)
  })
  it('visits each object once in cyclic state', () => {
    const card = polycard()
    const root: Record<string, unknown> = { polycard: card }
    root.self = root
    root.list = [root, { back: root }]
    card.components = [...(card.components as unknown[]), { type: 'cycle', root }]
    const found = findPolycards(root)
    expect(found).toHaveLength(1)
    expect(found[0]).toBe(card)
  })
})

describe('parseCard required fields', () => {
  it('missing fields stay null', () => {
    expect(parseCard({ metadata: { id: 'MLB1' }, components: [] })).toBeNull()
  })
  it.each<[string, Polycard]>([
    ['no metadata', { components: polycard().components }],
    ['an empty id', polycard([], { id: '' })],
    ['a numeric id', polycard([], { id: 1 })],
    ['no title', withOnly(priceComponent(100))],
    ['a blank title', withOnly(titleComponent('  '), priceComponent(100))],
    ['no price', withOnly(titleComponent())],
    ['a text price', withOnly(titleComponent(), priceComponent('100'))],
    ['a zero price', withOnly(titleComponent(), priceComponent(0))],
    ['components that are not a list', { ...polycard(), components: titleComponent() }],
  ])('returns null with %s', (_, p) => {
    expect(parseCard(p)).toBeNull()
  })
  it('reads a minimal card with every optional field null', () => {
    expect(parseCard({ metadata: { id: 'MLB1' }, components: [titleComponent(' Item '), priceComponent(1223)] })).toEqual({
      id: 'MLB1', productId: null, title: 'Item', thumbnail: null, url: null, isPad: false, priceCents: 122300,
      basisText: null, basis: 'none', listPriceCents: null, mlDiscountPct: null, soldQuantity: null, full: null,
      freeShipping: null, categoryId: null, domainId: null, sellerLabel: null, couponHint: null,
    })
  })
  it('rounds the displayed price to whole centavos', () => {
    expect(parseCard(withOnly(titleComponent(), priceComponent(319.99)))?.priceCents).toBe(31999)
  })
})

describe('parseCard shipping', () => {
  it('true free shipping from a bare text entry', () => {
    expect(parseCard(polycard([shipping(bareFreeEntry)]))).toMatchObject({ freeShipping: true, full: false })
  })
  it('a free shipping pill without the first purchase perk is free', () => {
    expect(parseCard(polycard([shipping({ text: '{free_shipping_single}', values: [freePill] })]))?.freeShipping).toBe(true)
  })
  it('the first purchase perk is not free shipping', () => {
    expect(parseCard(polycard([shipping(perkEntry)]))).toMatchObject({ freeShipping: false, full: false })
  })
  it('FULL from the vpp_full_icon icon', () => {
    const entry = {
      text: '{next_day_free_shipping} {full_icon} {new_buyer}',
      values: [pill('next_day_free_shipping', 'Chegará grátis amanhã'), fullIcon, newBuyer],
    }
    expect(parseCard(polycard([shipping(entry)]))).toMatchObject({ full: true, freeShipping: false })
  })
  it('the perk only applies to its own entry', () => {
    expect(parseCard(polycard([shipping(perkEntry, { text: 'Frete gratis' })]))?.freeShipping).toBe(true)
  })
  it('paid shipping is neither free nor FULL', () => {
    expect(parseCard(polycard([shipping({ text: 'Chegará amanhã', values: [] })]))).toMatchObject({ freeShipping: false, full: false })
  })
  it('a present but empty shipping component is neither free nor FULL', () => {
    expect(parseCard(polycard([shipping()]))).toMatchObject({ freeShipping: false, full: false })
  })
  it('stays null without a shipping component', () => {
    expect(parseCard(polycard())).toMatchObject({ freeShipping: null, full: null })
  })
})

describe('parseCard coupon hint', () => {
  it('percent off', () => {
    const text = '15% OFF com Cupom'
    expect(hintOf(text)).toEqual({ text, percentOff: 15, amountOffCents: null, priceAfterCents: null })
  })
  it('fixed amount off with centavos', () => {
    expect(hintOf('{amount} OFF com Cupom', [priceValue('amount', 16.99)])).toEqual({
      text: 'R$ 16,99 OFF com Cupom', percentOff: null, amountOffCents: 1699, priceAfterCents: null,
    })
  })
  it('price after the coupon', () => {
    const after = { text: 'R$ 1.674,39 com Cupom', percentOff: null, amountOffCents: null, priceAfterCents: 167439 }
    expect(hintOf('{1} com Cupom', [priceValue('1', 1674.39)])).toEqual(after)
    expect(hintOf('{icon} {1} com Cupom', [{ key: 'icon', type: 'icon' }, priceValue('1', 1674.39)])).toEqual(after)
  })
  it('matches a numeric value key to its placeholder', () => {
    expect(hintOf('{1} com Cupom', [{ key: 1, type: 'price', price: { value: 1674.39 } }])).toEqual({
      text: 'R$ 1.674,39 com Cupom', percentOff: null, amountOffCents: null, priceAfterCents: 167439,
    })
  })
  it('other wording keeps every number null', () => {
    expect(hintOf('Economize {amount} com Cupom', [priceValue('amount', 200)])).toEqual({
      text: 'Economize R$ 200 com Cupom', percentOff: null, amountOffCents: null, priceAfterCents: null,
    })
    expect(hintOf('{1} de volta com Cupom', [priceValue('1', 20)])).toEqual({
      text: 'R$ 20 de volta com Cupom', percentOff: null, amountOffCents: null, priceAfterCents: null,
    })
    expect(hintOf('Ganhe 10% de volta com Cupom')).toEqual({
      text: 'Ganhe 10% de volta com Cupom', percentOff: null, amountOffCents: null, priceAfterCents: null,
    })
  })
  it('replaces every placeholder, dropping icons and unknown keys', () => {
    expect(hintOf('{icon} 10% OFF {missing} com Cupom', [{ key: 'icon', type: 'icon', icon: { key: 'coupon_icon' } }])).toEqual({
      text: '10% OFF com Cupom', percentOff: 10, amountOffCents: null, priceAfterCents: null,
    })
  })
  it('keeps a hint whose value is not recognized', () => {
    const text = 'Cupom especial'
    expect(hintOf(text)).toEqual({ text, percentOff: null, amountOffCents: null, priceAfterCents: null })
  })
  it('ignores promotions that are not coupons', () => {
    expect(parseCard(polycard([promotion('Leve 3 pague 2', [], 'bundle')]))?.couponHint).toBeNull()
  })
})

describe('parseCard seller, thumbnail and url', () => {
  it('renders the seller label and drops icons', () => {
    const sellerOf = (text: string, values: unknown[]) => parseCard(polycard([seller(text, values)]))?.sellerLabel
    expect(sellerOf('{label} {icon_cockade}', [cockade, label('label', 'CARRARO')])).toBe('CARRARO')
    expect(sellerOf('Mobi Phone {icon_cockade}', [cockade])).toBe('Mobi Phone')
    expect(sellerOf('{icon_cockade}', [cockade])).toBeNull()
  })
  it('builds the thumbnail only from a well formed picture id', () => {
    const withPicture = (id: unknown) => parseCard({ ...polycard(), pictures: { pictures: [{ id }] } })?.thumbnail
    expect(withPicture('610870-MLA95657253150_102025')).toBe('https://http2.mlstatic.com/D_Q_NP_2X_610870-MLA95657253150_102025-E.webp')
    expect(withPicture('../x?y')).toBeNull()
    expect(withPicture(5)).toBeNull()
  })
  it('keeps only Mercado Livre urls for organic cards', () => {
    expect(parseCard(polycard())?.url).toBe(`https://${ITEM_URL}${ITEM_PARAMS}`)
    expect(parseCard(polycard([], { url_params: undefined }))?.url).toBe(`https://${ITEM_URL}`)
    expect(parseCard(polycard([], { url: 'evil.example.com/x' }))?.url).toBeNull()
    expect(parseCard(polycard([], { url: 'www.mercadolivre.com.br/login' }))?.url).toBeNull()
  })
  it('sponsored cards have no url', () => {
    expect(parseCard(polycard([], SPONSORED))).toMatchObject({ isPad: true, url: null })
  })
  it('rejects the click tracker host on organic cards', () => {
    expect(parseCard(polycard([], { ...SPONSORED, is_pad: 'false' }))).toMatchObject({ isPad: false, url: null })
  })
  it('accepts only integer discount and sold quantity', () => {
    const p = { ...polycard([], { tracks: { sold_quantity: 2.5 } }), components: [titleComponent(), priceComponent(100, { discount_pct: 12.5 })] }
    expect(parseCard(p)).toMatchObject({ soldQuantity: null, mlDiscountPct: null })
  })
})

describe('mergeCards', () => {
  const sponsored = parseCard(polycard(
    [shipping(bareFreeEntry), seller('{label}', [label('label', 'LOJA')])],
    { ...SPONSORED, id: 'MLB7', product_id: 'MLB70' },
  ))!
  const organic = parseCard({ ...polycard([], { id: 'MLB7' }), components: [titleComponent('Organic'), priceComponent(99.5)] })!
  const other = parseCard(polycard([], { id: 'MLB8' }))!

  it('keeps the organic card and fills its nulls from the sponsored duplicate', () => {
    const merged = mergeCards([sponsored, other, organic])
    expect(merged.map((c) => c.id)).toEqual(['MLB7', 'MLB8'])
    expect(merged[0]).toEqual({ ...organic, productId: 'MLB70', freeShipping: true, full: false, sellerLabel: 'LOJA' })
    expect(merged[0]).toMatchObject({ isPad: false, url: organic.url, title: 'Organic', priceCents: 9950 })
  })
  it('gives the same result whichever copy comes first', () => {
    expect(mergeCards([organic, sponsored])).toEqual(mergeCards([sponsored, organic]))
  })
  it('keeps the first of two organic copies', () => {
    expect(mergeCards([organic, { ...organic, title: 'Copy' }])).toEqual([organic])
  })

  const couponPriced = (value: number) => priceComponent(value, {
    discount_complement: { text: '{discount_complement}', values: [label('discount_complement', 'com Cupom')] },
    price_labels: [{ text: '{previous_price}', values: [{ key: 'previous_price', type: 'price', price: { value: 120, previous: true } }] }],
    discount_pct: 20,
  })
  const adAt = (value: number) => parseCard({
    ...polycard([], { ...SPONSORED, id: 'MLB7' }),
    components: [titleComponent('Ad'), couponPriced(value), promotion('15% OFF com Cupom'), seller('{label}', [label('label', 'LOJA')])],
  })!
  const organicAt100 = parseCard({ ...polycard([], { id: 'MLB7' }), components: [titleComponent('Organic'), priceComponent(100)] })!

  it('does not mix price-coupled fields from a duplicate at another price', () => {
    expect(adAt(80)).toMatchObject({ priceCents: 8000, basis: 'coupon', listPriceCents: 12000, mlDiscountPct: 20 })
    expect(mergeCards([organicAt100, adAt(80)])).toEqual([{ ...organicAt100, sellerLabel: 'LOJA' }])
  })
  it('fills price-coupled fields from a duplicate at the same price', () => {
    const ad = adAt(100)
    expect(mergeCards([ad, organicAt100])).toEqual([{
      ...organicAt100, sellerLabel: 'LOJA', basisText: 'com Cupom', basis: 'coupon', couponHint: ad.couponHint,
      listPriceCents: 12000, mlDiscountPct: 20,
    }])
  })
})

describe('cardsOfResults', () => {
  it('reads the fixture listing results', () => {
    const read = cardsOfResults(listing.initialState.results)
    expect(read.cards).toHaveLength(3)
    expect(read).toMatchObject({ found: 3, dropped: 0 })
  })

  it('merges a card listed twice and counts every polycard found', () => {
    const card = polycard([titleComponent(), priceComponent(10)])
    const read = cardsOfResults([{ polycard: card }, { polycard: card }])
    expect(read.cards).toHaveLength(1)
    expect(read).toMatchObject({ found: 2, dropped: 0 })
  })

  it('counts polycards that do not parse', () => {
    const read = cardsOfResults([{ polycard: {} }, { polycard: polycard([titleComponent(), priceComponent(10)]) }])
    expect(read).toMatchObject({ found: 2, dropped: 1 })
    expect(read.cards).toHaveLength(1)
  })

  it('reads an empty results list without failing', () => {
    expect(cardsOfResults([])).toEqual({ cards: [], found: 0, dropped: 0 })
  })

  it('ignores a carousel nested inside a result', () => {
    const card = polycard([titleComponent(), priceComponent(10)])
    expect(cardsOfResults([{ polycard: card, carousel: [{ polycard: card }] }])).toMatchObject({ found: 1 })
  })
})
