import { describe, expect, it } from 'vitest'
import {
  basisLabel, categoryLabel, couponChip, couponPartLine, countsLine, dropsNotice, historyLine, minimumGapLine, sellerLine, couponHintText, discountLine, dropBadge, MAX_COUPON_CHIPS, NO_BASIS_TEXT, observedLine, priceDroppedLine, savingLines, soldLine,
  compareLinkItems, hiddenNote, priceCompareLines, siblingLine, type DealPriceCheck, type SavingRow,
} from './deal-view'
import { formatCents } from './format'

const NOW = new Date('2026-11-02T12:00:00Z')
const coupon = {
  campaignId: 'c1',
  title: '10% OFF',
  isStore: false,
  scopeLabel: null,
  expiresAt: new Date('2026-11-30T12:00:00Z'),
  minPaymentCents: 20000,
  kind: 'percent' as const,
  percentOff: 10,
  amountOffCents: null,
  capCents: null,
}

describe('basisLabel', () => {
  it('uses the stored text or the no-discount text', () => {
    expect(basisLabel('no Pix com Cupom')).toBe('no Pix com Cupom')
    expect(basisLabel(null)).toBe(NO_BASIS_TEXT)
  })
})

describe('discountLine', () => {
  it('shows the percent and the list price', () => {
    expect(discountLine(47, 878600)).toBe('47% OFF, de R$ 8.786')
  })

  it('shows only the percent without a list price', () => {
    expect(discountLine(12, null)).toBe('12% OFF')
  })

  it.each([[null, 1000], [0, 1000], [-5, 1000]])('hides a discount of %s', (pct, list) => {
    expect(discountLine(pct, list)).toBeNull()
  })
})

describe('dropBadge', () => {
  it('rounds the percent with Intl and never floors', () => {
    expect(dropBadge(0.126)).toBe('13% abaixo do menor preço em 30 dias')
    expect(dropBadge(0.124)).toBe('12% abaixo do menor preço em 30 dias')
  })

  it('has no badge without a drop', () => {
    expect(dropBadge(null)).toBeNull()
    expect(dropBadge(0)).toBeNull()
    expect(dropBadge(-0.1)).toBeNull()
  })
})

describe('couponChip', () => {
  it('names the coupon, its minimum and its validity', () => {
    expect(couponChip(coupon, 25000)).toEqual({
      text: 'na lista do cupom: 10% OFF (mín. R$ 200, até 30/11/2026)', minimum: null,
    })
  })

  it('warns about the minimum only when the price is below it, without repeating the value', () => {
    expect(couponChip(coupon, 19999).minimum).toBe('abaixo do pedido mínimo')
    expect(couponChip(coupon, 19999).text).toContain('mín. R$ 200')
    expect(couponChip(coupon, 20000).minimum).toBeNull()
  })

  it('handles no expiry and no minimum', () => {
    expect(couponChip({ ...coupon, expiresAt: null, minPaymentCents: null }, 100))
      .toEqual({ text: 'na lista do cupom: 10% OFF (sem validade)', minimum: null })
    expect(couponChip({ ...coupon, minPaymentCents: 0 }, 100).text).toBe('na lista do cupom: 10% OFF (até 30/11/2026)')
  })

  it('leaves the minimum out when the Faltam line already states it', () => {
    expect(couponChip(coupon, 25000, true).text).toBe('na lista do cupom: 10% OFF (até 30/11/2026)')
    expect(couponChip(coupon, 19999, true).minimum).toBe('abaixo do pedido mínimo')
  })

  it('tells two coupons with the same label apart by their minimum', () => {
    const first = { ...coupon, minPaymentCents: 9900 }
    const second = { ...coupon, minPaymentCents: 19900 }
    expect(couponChip(first, 25000).text).not.toBe(couponChip(second, 25000).text)
  })
})

describe('soldLine', () => {
  it('hides a missing or zero sold count', () => {
    expect(soldLine(null)).toBeNull()
    expect(soldLine(0)).toBeNull()
    expect(soldLine(1)).toBe('1 vendido')
    expect(soldLine(1500)).toBe('1.500 vendidos')
  })
})

describe('categoryLabel', () => {
  it('makes the domain id readable', () => {
    expect(categoryLabel('MLB-HARD_DRIVES_AND_SSDS')).toBe('Hard drives and ssds')
    expect(categoryLabel('MLB-NECKLACES')).toBe('Necklaces')
  })

  it('keeps a value that is not a domain id as typed', () => {
    expect(categoryLabel('MLB1672')).toBe('MLB1672')
    expect(categoryLabel('MLB-')).toBe('MLB-')
  })
})

describe('couponChip with a store coupon', () => {
  it('names the store after the title', () => {
    const store = { ...coupon, isStore: true, scopeLabel: 'Em produtos de Loja X' }
    expect(couponChip(store, 25000).text).toBe('na lista do cupom: 10% OFF - Loja X (mín. R$ 200, até 30/11/2026)')
  })
})

describe('countsLine', () => {
  it('counts items and offers with the right plural', () => {
    expect(countsLine(1500, 20)).toBe('1.500 itens, 20 ofertas')
    expect(countsLine(1, 1)).toBe('1 item, 1 oferta')
    expect(countsLine(0, 0)).toBe('0 itens, 0 ofertas')
  })
})

describe('sellerLine', () => {
  it('shows the seller only when there is one', () => {
    expect(sellerLine('YAMADA por Mons Bike')).toBe('Vendido por Mons Bike')
    expect(sellerLine('BUDDEMEYER por Mercado Livre')).toBe('Vendido por Mercado Livre')
    expect(sellerLine('MJ ENXOVAIS por UP MARKETPLACES')).toBe('Vendido por UP MARKETPLACES')
    expect(sellerLine('ASICS por YouCan Sports')).toBe('Vendido por YouCan Sports')
    expect(sellerLine('PENALTY por D&A')).toBe('Vendido por D&A')
  })

  it('shows nothing for a bare brand, a bare store or a placeholder', () => {
    expect(sellerLine('EXBIAN')).toBeNull()
    expect(sellerLine('SEM MARCA')).toBeNull()
    expect(sellerLine('Loja Mensageiros')).toBeNull()
    expect(sellerLine('LOJA DO MAGO')).toBeNull()
    expect(sellerLine(null)).toBeNull()
    expect(sellerLine('')).toBeNull()
    expect(sellerLine('   ')).toBeNull()
  })

  it('shows nothing when the store part is empty or the word is only inside a name', () => {
    expect(sellerLine('MARCA por ')).toBeNull()
    expect(sellerLine('MARCA por   ')).toBeNull()
    expect(sellerLine('PORTO SEGURO')).toBeNull()
    expect(sellerLine('Sapatos porque sim')).toBeNull()
  })
})

describe('couponHintText', () => {
  it('strips a trailing "com Cupom" in any case and leaves the rest', () => {
    expect(couponHintText('15% OFF com Cupom')).toBe('15% OFF')
    expect(couponHintText('R$ 711,42 com cupom')).toBe('R$ 711,42')
    expect(couponHintText('Cupom exclusivo')).toBe('Cupom exclusivo')
    expect(couponHintText('com Cupom e frete')).toBe('com Cupom e frete')
  })
})

describe('savingLines', () => {
  const row = (extra: Partial<SavingRow> = {}): SavingRow => ({
    priceCents: 10000, listPriceCents: null, basis: 'none', couponHint: null, coupons: [], ...extra,
  })
  const qualifying = { ...coupon, minPaymentCents: null }

  it('shows the saving against the list price for a price that already has the coupon', () => {
    expect(savingLines(row({ basis: 'coupon', priceCents: 2852, listPriceCents: 6629 }))).toEqual({
      saving: 'Economia total: R$ 37,77 (57,0%)', couponPrice: null, hint: null,
    })
  })

  it('counts a linked coupon on top of the list price and marks it estimated', () => {
    const lines = savingLines(row({ listPriceCents: 12500, coupons: [qualifying] }))
    expect(lines.couponPrice).toBe('Preço com cupom: R$ 90 (estimado, -R$ 10)')
    expect(lines.saving).toBe('Economia total: R$ 35 (28,0%)')
  })

  it('shows a hint as text only, with no invented number', () => {
    expect(savingLines(row({ couponHint: 'R$ 120 OFF com Cupom', priceCents: 1500, listPriceCents: 3500 }))).toEqual({
      saving: 'Economia total: R$ 20 (57,1%)',
      couponPrice: null,
      hint: 'Cupom no anúncio: R$ 120 OFF (condições não informadas)',
    })
  })

  it('shows the hint text when the linked coupon fails its minimum', () => {
    const lines = savingLines(row({ couponHint: '15% OFF com Cupom', coupons: [coupon] }))
    expect(lines.couponPrice).toBeNull()
    expect(lines.saving).toBeNull()
    expect(lines.hint).toBe('Cupom no anúncio: 15% OFF (condições não informadas)')
  })

  it('shows a price hint as a price after the coupon, not as a coupon', () => {
    const lines = savingLines(row({ couponHint: 'R$ 1.257 com Cupom', priceCents: 150000 }))
    expect(lines.hint).toBe('Preço com cupom no anúncio: R$ 1.257')
    expect(lines.hint).not.toContain('condições')
  })

  it('hides the hint line when a shown chip has the same kind and value', () => {
    const fixedCoupon = { ...coupon, kind: 'fixed' as const, percentOff: null, amountOffCents: 2000, minPaymentCents: 99900 }
    expect(savingLines(row({ couponHint: '10% OFF com Cupom', coupons: [coupon] })).hint).toBeNull()
    expect(savingLines(row({ couponHint: 'R$ 20 OFF com Cupom', coupons: [fixedCoupon] })).hint).toBeNull()
    expect(savingLines(row({ couponHint: 'R$ 20 OFF com Cupom', coupons: [coupon] })).hint)
      .toBe('Cupom no anúncio: R$ 20 OFF (condições não informadas)')
    expect(savingLines(row({ couponHint: '15% OFF com Cupom', coupons: [coupon] })).hint)
      .toBe('Cupom no anúncio: 15% OFF (condições não informadas)')
    expect(savingLines(row({ couponHint: 'R$ 2.000 OFF com Cupom', coupons: [fixedCoupon] })).hint)
      .toBe('Cupom no anúncio: R$ 2.000 OFF (condições não informadas)')
  })

  it('keeps the hint line when the matching coupon is not among the chips shown', () => {
    const others = Array.from({ length: MAX_COUPON_CHIPS }, (_, i) => ({ ...coupon, campaignId: `o${i}`, percentOff: 20 }))
    const rows = row({ couponHint: '10% OFF com Cupom', coupons: [...others, coupon] })
    expect(savingLines(rows).hint).toBe('Cupom no anúncio: 10% OFF (condições não informadas)')
  })

  it('hides the hint when an estimate from a linked coupon is shown', () => {
    expect(savingLines(row({ couponHint: '15% OFF com Cupom', coupons: [qualifying] })).hint).toBeNull()
  })

  it('shows no lines when there is nothing to save', () => {
    expect(savingLines(row())).toEqual({ saving: null, couponPrice: null, hint: null })
    expect(savingLines(row({ listPriceCents: 5000 }))).toEqual({ saving: null, couponPrice: null, hint: null })
  })
})

describe('observedLine', () => {
  it('always says read, never seen, because Visto is a status', () => {
    expect(observedLine(new Date('2026-11-02T07:00:00Z'), NOW)).toBe('lido há 5 h')
    expect(observedLine(NOW, NOW)).toBe('lido agora')
    expect(observedLine(new Date('2026-10-30T11:59:59Z'), NOW)).toBe('lido há 3 d')
    expect(observedLine(new Date('2026-10-27T12:00:00Z'), NOW)).toBe('lido há 6 d')
  })
})

describe('priceDroppedLine', () => {
  it('shows the price it was seen at, on a Novos card that is now cheaper', () => {
    expect(priceDroppedLine('NOT_SEEN', 10000, 9000)).toBe('Preço caiu desde que você viu: era R$ 100')
  })

  it('is absent without a stored price, at the same or a higher price, and outside Novos', () => {
    expect(priceDroppedLine('NOT_SEEN', null, 9000)).toBeNull()
    expect(priceDroppedLine('NOT_SEEN', 9000, 9000)).toBeNull()
    expect(priceDroppedLine('NOT_SEEN', 8000, 9000)).toBeNull()
    expect(priceDroppedLine('SAVED', 10000, 9000)).toBeNull()
    expect(priceDroppedLine('SEEN', 10000, 9000)).toBeNull()
  })
})

describe('historyLine', () => {
  const base = {
    segments: 3, lowestCents: 8990, highestCents: 12990,
    firstReadAt: new Date('2026-11-02T17:00:00Z'), currentSince: new Date('2026-11-05T12:00:00Z'),
  }

  it('shows the range and the unchanged-since date with several segments', () => {
    expect(historyLine(base)).toBe('Desde 02/11: menor R$ 89,90, maior R$ 129,90 - mesmo preço desde 05/11')
  })

  it('shows only the unchanged-since date with one segment', () => {
    expect(historyLine({ ...base, segments: 1 })).toBe('Mesmo preço desde 05/11')
  })

  it('shows only the unchanged-since date when every segment has the same price', () => {
    expect(historyLine({ ...base, segments: 2, lowestCents: 8990, highestCents: 8990 })).toBe('Mesmo preço desde 05/11')
  })

  it('drops the range when no segment is inside the window', () => {
    expect(historyLine({ ...base, lowestCents: null, highestCents: null })).toBe('Desde 02/11 - mesmo preço desde 05/11')
  })

  it('is empty without history', () => {
    expect(historyLine(null)).toBeNull()
  })
})

describe('dropsNotice', () => {
  const earliest = new Date('2026-11-02T16:50:00Z')

  it('names the first day a real drop can exist while it is in the future', () => {
    expect(dropsNotice(earliest, new Date('2026-11-09T16:49:59Z'))).toBe('Quedas reais aparecem a partir de 09/11 (7 dias de histórico)')
  })

  it('goes away once the history is long enough', () => {
    expect(dropsNotice(earliest, new Date('2026-11-09T16:50:00Z'))).toBeNull()
  })

  it('is empty without any segment', () => {
    expect(dropsNotice(null, NOW)).toBeNull()
  })
})

describe('couponPartLine', () => {
  const row = (extra: Partial<SavingRow> = {}): SavingRow => ({
    priceCents: 9000, listPriceCents: 12000, basis: 'coupon', couponHint: null, coupons: [coupon], ...extra,
  })

  it('shows the coupon and the seller parts', () => {
    expect(couponPartLine(row())).toBe('Cupom: -R$ 10 (estimado) - desconto do vendedor: -R$ 20')
  })

  it('leaves the seller out when there is none', () => {
    expect(couponPartLine(row({ listPriceCents: 10000 }))).toBe('Cupom: -R$ 10 (estimado)')
  })

  it('is empty outside the coupon basis', () => {
    expect(couponPartLine(row({ basis: 'pix_coupon' }))).toBeNull()
  })
})

describe('minimumGapLine', () => {
  const cheap = { priceCents: 8000, basis: 'none' as const }

  it('names the minimum, the coupon and what the units are worth', () => {
    expect(minimumGapLine(cheap, [coupon])).toEqual({
      text: 'Faltam R$ 120 para o pedido mínimo de R$ 200 (cupom 10% OFF); com 3 unidades o cupom vale R$ 24 (R$ 8 cada)',
      couponId: 'c1',
    })
  })

  it('is empty when no quantity up to the limit reaches the minimum', () => {
    expect(minimumGapLine(cheap, [{ ...coupon, minPaymentCents: 30000 }])).toBeNull()
  })

  it('is empty when the coupon is not worth the trivial saving', () => {
    expect(minimumGapLine(cheap, [{ ...coupon, percentOff: 1, minPaymentCents: 20000 }])).toBeNull()
  })

  it('is empty when the basis already includes a coupon', () => {
    expect(minimumGapLine({ ...cheap, basis: 'coupon' }, [coupon])).toBeNull()
  })
})

describe('priceCompareLines', () => {
  const check = (over: Partial<DealPriceCheck> = {}): DealPriceCheck => ({
    status: 'matched', confidence: 'high', marketLowCents: 1266, marketStore: 'Magazine Luiza', storeCount: 3,
    finalCents: 1201, inflated: false, realSavingCents: 65, ...over,
  })

  it('has nothing without a check, and for a failed or blocked one', () => {
    expect(priceCompareLines(null)).toEqual({ inflated: false, line: null, noEquivalent: false })
    expect(priceCompareLines(check({ status: 'failed' })).line).toBeNull()
    expect(priceCompareLines(check({ status: 'blocked' })).line).toBeNull()
  })

  it('says there is no equivalent for a no_match check', () => {
    expect(priceCompareLines(check({ status: 'no_match', confidence: null, marketLowCents: null }))).toEqual({
      inflated: false, line: null, noEquivalent: true,
    })
  })

  it('inflated: the outside price, the store count and the price here', () => {
    expect(priceCompareLines(check({ inflated: true, finalCents: 1300, realSavingCents: -34 }))).toEqual({
      inflated: true,
      line: `Fora do ML: ${formatCents(1266)} na Magazine Luiza (3 lojas); aqui ${formatCents(1300)}`,
      noEquivalent: false,
    })
  })

  it('inflated by one store: no store count, with the seller in the store name', () => {
    expect(priceCompareLines(check({ inflated: true, marketStore: 'Kabum (Magalu)', storeCount: 1, finalCents: 1300, realSavingCents: -34 })).line)
      .toBe(`Fora do ML: ${formatCents(1266)} na Kabum (Magalu); aqui ${formatCents(1300)}`)
  })

  it('a positive real saving shows the value, the one-decimal share of the market low and the store', () => {
    expect(priceCompareLines(check()).line).toBe(`Economia real: ${formatCents(65)} (5,1%) vs ${formatCents(1266)} na Magazine Luiza`)
  })

  it('a zero or negative real saving on a non-inflated item is worded as no saving', () => {
    const none = `Sem economia real: ${formatCents(1266)} na Magazine Luiza`
    expect(priceCompareLines(check({ realSavingCents: 0 })).line).toBe(none)
    expect(priceCompareLines(check({ realSavingCents: -9 })).line).toBe(none)
    expect(priceCompareLines(check({ realSavingCents: 1 })).line).toContain('Economia real')
  })

  it('medium confidence is only a possible equivalent', () => {
    expect(priceCompareLines(check({ confidence: 'medium', realSavingCents: null }))).toEqual({
      inflated: false, line: `Possível equivalente fora do ML: ${formatCents(1266)} na Magazine Luiza`, noEquivalent: false,
    })
  })

  it('drops the store when it is unknown', () => {
    expect(priceCompareLines(check({ marketStore: null, realSavingCents: 0 })).line).toBe(`Sem economia real: ${formatCents(1266)}`)
  })
})

describe('siblingLine', () => {
  it('is null without a cheaper sibling', () => {
    expect(siblingLine(null)).toBeNull()
  })

  it('names the price and carries the listing url', () => {
    expect(siblingLine({ id: 'MLB2', url: 'https://x', priceCents: 8196 })).toEqual({
      text: `Mais barato em outro anúncio: ${formatCents(8196)}`, url: 'https://x',
    })
  })
})

describe('compareLinkItems', () => {
  it('lists the four sites in order, from the cleaned title', () => {
    const items = compareLinkItems('Fone JBL Tune 520BT')
    expect(items.map((i) => i.label)).toEqual(['Buscapé', 'Google Shopping', 'Amazon', 'Magalu'])
    expect(items[0].href).toBe('https://www.buscape.com.br/search?q=fone+jbl+tune+520bt')
  })

  it('has no links for a title without words', () => {
    expect(compareLinkItems('')).toEqual([])
  })
})

describe('hiddenNote', () => {
  it('agrees in number and groups thousands', () => {
    expect(hiddenNote(1)).toEqual({ link: '1 oculto', rest: '(desconto inflado ou anúncio igual mais barato)' })
    expect(hiddenNote(1507).link).toBe('1.507 ocultos')
  })
})
