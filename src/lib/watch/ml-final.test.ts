import { describe, expect, it } from 'vitest'
import type { ObservedCard } from '@/ingestion/ml/observed-card'
import type { CouponHint } from '../coupon-hint'
import { mlCandidate, mlFinalCents, mlQuote } from './ml-final'

const PRICE = 19_990

const hint = (over: Partial<CouponHint>): CouponHint => ({
  text: 'Cupom', percentOff: null, amountOffCents: null, priceAfterCents: null, ...over,
})

function card(over: Partial<ObservedCard> = {}): ObservedCard {
  return {
    id: 'MLB5163773802',
    productId: 'MLB25454950',
    title: 'Fone de Ouvido JBL Tune 520BT Preto',
    thumbnail: null,
    url: 'https://www.mercadolivre.com.br/fone-jbl/p/MLB25454950',
    isPad: false,
    priceCents: PRICE,
    basisText: null,
    basis: 'none',
    listPriceCents: 29_990,
    mlDiscountPct: 33,
    soldQuantity: null,
    full: null,
    freeShipping: null,
    categoryId: null,
    domainId: null,
    sellerLabel: 'Por JBL',
    couponHint: null,
    ...over,
  }
}

describe('mlFinalCents', () => {
  it('keeps the price without a coupon hint', () => {
    expect(mlFinalCents(PRICE, null)).toBe(PRICE)
  })

  it('applies a percent coupon, rounded to the cent', () => {
    expect(mlFinalCents(PRICE, hint({ percentOff: 10 }))).toBe(17_991)
    expect(mlFinalCents(PRICE, hint({ percentOff: 12.5 }))).toBe(17_491)
  })

  it('applies an amount coupon', () => {
    expect(mlFinalCents(PRICE, hint({ amountOffCents: 2_000 }))).toBe(17_990)
  })

  it('takes the price after the coupon', () => {
    expect(mlFinalCents(PRICE, hint({ priceAfterCents: 17_900 }))).toBe(17_900)
  })

  it('prefers the price after the coupon, then the percent, then the amount', () => {
    expect(mlFinalCents(PRICE, hint({ priceAfterCents: 17_900, percentOff: 50, amountOffCents: 5_000 }))).toBe(17_900)
    expect(mlFinalCents(PRICE, hint({ percentOff: 10, amountOffCents: 5_000 }))).toBe(17_991)
  })

  it('keeps the price for a hint without a value', () => {
    expect(mlFinalCents(PRICE, hint({}))).toBe(PRICE)
  })

  it('ignores a discount that is not below the price or not positive', () => {
    expect(mlFinalCents(PRICE, hint({ amountOffCents: PRICE }))).toBe(PRICE)
    expect(mlFinalCents(PRICE, hint({ amountOffCents: 30_000 }))).toBe(PRICE)
    expect(mlFinalCents(PRICE, hint({ percentOff: 100 }))).toBe(PRICE)
    expect(mlFinalCents(PRICE, hint({ priceAfterCents: PRICE }))).toBe(PRICE)
    expect(mlFinalCents(PRICE, hint({ priceAfterCents: 25_000 }))).toBe(PRICE)
    expect(mlFinalCents(PRICE, hint({ priceAfterCents: 0 }))).toBe(PRICE)
  })

  it.each([
    ['10% OFF', { percentOff: 10 }, 17_991],
    ['R$ 20 OFF', { amountOffCents: 2_000 }, 17_990],
    ['R$ 179,00 com cupom', { priceAfterCents: 17_900 }, 17_900],
  ])('reads the hint "%s"', (_, parts, finalCents) => {
    expect(mlFinalCents(PRICE, hint(parts))).toBe(finalCents)
  })
})

describe('mlCandidate', () => {
  it('turns a card into a candidate', () => {
    expect(mlCandidate(card())).toEqual({
      retailer: 'ml',
      ref: 'MLB5163773802',
      url: 'https://www.mercadolivre.com.br/fone-jbl/p/MLB25454950',
      title: 'Fone de Ouvido JBL Tune 520BT Preto',
      ean: null,
      merchant: 'Por JBL',
      priceCents: PRICE,
      listPriceCents: 29_990,
      inStock: true,
    })
  })

  it('builds the item url for a card without one and cleans the text', () => {
    expect(mlCandidate(card({ url: null, title: 'Fone\u0000 JBL', sellerLabel: null }))).toMatchObject({
      url: 'https://produto.mercadolivre.com.br/MLB-5163773802', title: 'Fone JBL', merchant: null,
    })
  })
})

describe('mlQuote', () => {
  it('quotes the card with its coupon price', () => {
    expect(mlQuote(card({ couponHint: hint({ percentOff: 10 }) }))).toEqual({
      ref: 'MLB5163773802',
      merchant: 'Por JBL',
      title: 'Fone de Ouvido JBL Tune 520BT Preto',
      priceCents: PRICE,
      listPriceCents: 29_990,
      finalCents: 17_991,
      inStock: true,
    })
  })

  it('quotes the price without a hint', () => {
    expect(mlQuote(card()).finalCents).toBe(PRICE)
  })

  it.each(['coupon', 'pix_coupon'] as const)('does not discount again a card whose %s price already has the coupon', (basis) => {
    expect(mlQuote(card({ basis, couponHint: hint({ percentOff: 10 }) })).finalCents).toBe(PRICE)
  })

  it('applies the hint on a PIX price', () => {
    expect(mlQuote(card({ basis: 'pix', couponHint: hint({ amountOffCents: 2_000 }) })).finalCents).toBe(17_990)
  })
})
