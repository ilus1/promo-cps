import { describe, expect, it } from 'vitest'
import { HOUR_MS, MINUTE_MS } from '../constants'
import { formatCents, formatDayMonthTime } from '../format'
import { NO_VALUE } from '../labels'
import { NAME_TOO_LONG_TEXT, UNKNOWN_LINK_TEXT, WATCH_NAME_MAX } from './input-rules'
import type { WatchListingView, WatchProductView, WatchSourceStatus, WatchStatus } from './types'
import {
  AT_LOW_TEXT, CHECK_NAME_OR_LINK_TEXT, NO_MATCH_TEXT, NO_STORE_FOUND_TEXT, NO_TRACKED_LISTINGS_TEXT, emptyListingsText, INVALID_DROP_TEXT, INVALID_EAN_TEXT, INVALID_PRICE_TEXT, NAME_OR_LINK_REQUIRED_TEXT, NO_ALERT_YET_TEXT, NO_LISTINGS_TEXT,
  NAME_UNREAD_TEXT, NO_PRICE_TEXT, NO_REQUEST_YET_TEXT, NOT_CHECKED_TEXT, PENDING_NAME_TEXT, RUNNING_TEXT, STALE_PRICE_TEXT, STOPPED_TEXT, UNKNOWN_STORE_TITLE, WAITING_FALLBACK_TEXT,
  WAITING_TEXT, WATCH_ADDED_IDLE_TEXT, WATCH_CREATE_FAILED_TEXT, alertsText, centsDraft, checkedText, conflictText, dropPercentOf, eanText, firstInvalidSettingsField,
  firstInvalidWatchField, lastAlertText, listingCountText, listingRows, lowNote, monitorPanel, priceCents, productCheckedText, productHeading, productSummary,
  productsCountLine, removeListingConfirmText, safeListingUrl, settingsDraftOf, settingsResult, sourceStateText, stopConfirmText, storeInText, storeText, targetNote,
  validateWatchDraft, watchCreateFailure, watchRequestOf,
} from './view'

const NOW = new Date('2026-11-06T18:00:00Z')
const VALID_EAN = '7891234567895'

const listing = (over: Partial<WatchListingView> = {}): WatchListingView => ({
  id: 'l1', retailer: 'amazon', merchant: null, title: 'Fone JBL Tune 520BT Preto', url: 'https://www.amazon.com.br/dp/B0C1234567',
  match: 'barcode', priceCents: 22990, listPriceCents: 29990, finalCents: 22990, inStock: true,
  checkedAt: new Date(NOW.getTime() - 2 * HOUR_MS), lastError: null, ...over,
})

const product = (over: Partial<WatchProductView> = {}): WatchProductView => ({
  id: 'p1', name: 'Fone JBL Tune 520BT', query: 'fone jbl tune 520bt', ean: VALID_EAN, eanSource: 'manual',
  targetPriceCents: null, dropPercent: 10,
  best: { listingId: 'l1', retailer: 'amazon', merchant: null, finalCents: 22990, url: 'https://www.amazon.com.br/dp/B0C1234567' },
  low30dCents: 19990, lastCheckedAt: new Date(NOW.getTime() - 2 * HOUR_MS), resolvedAt: null, listings: [listing()], ...over,
})

describe('storeText', () => {
  it('names each store', () => {
    expect(storeText('ml', null)).toBe('Mercado Livre')
    expect(storeText('amazon', 'Amazon.com.br')).toBe('Amazon')
    expect(storeText('kabum', null)).toBe('Kabum')
    expect(storeText('americanas', 'Loja X')).toBe('Americanas')
  })

  it('names the merchant behind a Buscapé offer, and Buscapé alone without one', () => {
    expect(storeText('buscape', 'Magazine Luiza')).toBe('Magazine Luiza (via Buscapé)')
    expect(storeText('buscape', '  ')).toBe('Buscapé')
    expect(storeText('buscape', null)).toBe('Buscapé')
  })
})

describe('storeInText', () => {
  it('puts each store after its preposition, and a Buscapé merchant after "na"', () => {
    expect(storeInText('ml', null)).toBe('no Mercado Livre')
    expect(storeInText('amazon', 'Amazon.com.br')).toBe('na Amazon')
    expect(storeInText('kabum', null)).toBe('na Kabum')
    expect(storeInText('americanas', null)).toBe('na Americanas')
    expect(storeInText('buscape', 'Magazine Luiza')).toBe('na Magazine Luiza (via Buscapé)')
    expect(storeInText('buscape', null)).toBe('no Buscapé')
  })
})

describe('productHeading', () => {
  it('keeps a plain name as the title', () => {
    expect(productHeading('Fone JBL Tune 520BT', null)).toEqual({ title: 'Fone JBL Tune 520BT', pending: null, link: null })
  })

  it('shows the store and that the name is on its way while the name is still the link', () => {
    expect(productHeading('https://www.kabum.com.br/produto/925350', null)).toEqual({
      title: 'Produto da Kabum', pending: PENDING_NAME_TEXT, link: 'https://www.kabum.com.br/produto/925350',
    })
    expect(productHeading('https://www.amazon.com.br/dp/B0C1234567', null).title).toBe('Produto da Amazon')
    expect(productHeading('https://www.buscape.com.br/fone-de-ouvido/fone-jbl-tune-520bt', null).title).toBe('Produto do Buscapé')
    expect(productHeading('https://www.mercadolivre.com.br/fone/p/MLB123456', null).title).toBe('Produto do Mercado Livre')
  })

  it('says the name could not be read once a resolve has finished with the name still the link', () => {
    const resolvedAt = new Date('2026-11-06T12:00:00Z')
    expect(productHeading('https://www.kabum.com.br/produto/925350', resolvedAt)).toEqual({
      title: 'Produto da Kabum', pending: NAME_UNREAD_TEXT, link: 'https://www.kabum.com.br/produto/925350',
    })
    expect(productHeading('https://www.exemplo.com.br/fone', resolvedAt).pending).toBe(NAME_UNREAD_TEXT)
    expect(productHeading('Fone JBL', resolvedAt).pending).toBeNull()
  })

  it('names no store for a link it cannot read, and drops a link that is not https', () => {
    expect(productHeading('https://www.exemplo.com.br/fone', null)).toEqual({ title: UNKNOWN_STORE_TITLE, pending: PENDING_NAME_TEXT, link: 'https://www.exemplo.com.br/fone' })
    expect(productHeading('http://www.exemplo.com.br/fone', null).link).toBeNull()
  })
})

describe('safeListingUrl', () => {
  it('keeps https links and refuses any other scheme or credentials', () => {
    expect(safeListingUrl('https://www.kabum.com.br/produto/925350')).toBe('https://www.kabum.com.br/produto/925350')
    expect(safeListingUrl('http://www.kabum.com.br/produto/925350')).toBeNull()
    expect(safeListingUrl('javascript:alert(1)')).toBeNull()
    expect(safeListingUrl('https://user:pass@example.com/')).toBeNull()
    expect(safeListingUrl('not a url')).toBeNull()
  })
})

describe('productsCountLine', () => {
  it('counts the products and says how often they are checked', () => {
    expect(productsCountLine(0, 3)).toBe('Nenhum produto monitorado. Os preços são verificados a cada 3 h.')
    expect(productsCountLine(1, 3)).toBe('1 produto monitorado. Os preços são verificados a cada 3 h.')
    expect(productsCountLine(12, 3)).toBe('12 produtos monitorados. Os preços são verificados a cada 3 h.')
  })
})

describe('checkedText, productCheckedText and listingCountText', () => {
  const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS)

  it('says how long ago a check worked, or when the last one was tried and failed, or that there was none', () => {
    expect(checkedText({ checkedAt: ago(3), lastError: null }, NOW)).toBe('Verificado há 3 h')
    expect(checkedText({ checkedAt: ago(1), lastError: 'HTTP 503' }, NOW)).toBe('Última tentativa há 1 h')
    expect(checkedText({ checkedAt: null, lastError: null }, NOW)).toBe(NOT_CHECKED_TEXT)
  })

  it('dates a product by its latest check that worked, not by a newer failure', () => {
    const listings = [
      { checkedAt: ago(1), lastError: 'HTTP 503' }, { checkedAt: ago(5), lastError: null }, { checkedAt: ago(2), lastError: null },
    ]
    expect(productCheckedText(listings, null, NOW)).toBe('Verificado há 2 h')
  })

  it('falls back to the latest failed attempt, then to never checked', () => {
    expect(productCheckedText([{ checkedAt: ago(4), lastError: 'x' }, { checkedAt: ago(1), lastError: 'y' }, { checkedAt: null, lastError: null }], null, NOW))
      .toBe('Última tentativa há 1 h')
    expect(productCheckedText([{ checkedAt: null, lastError: null }], null, NOW)).toBe(NOT_CHECKED_TEXT)
    expect(productCheckedText([], null, NOW)).toBe(NOT_CHECKED_TEXT)
  })

  it('says when the stores were last searched while no listing has been checked', () => {
    expect(productCheckedText([], ago(5), NOW)).toBe('Buscado há 5 h')
    expect(productCheckedText([{ checkedAt: null, lastError: null }], ago(1), NOW)).toBe('Buscado há 1 h')
    expect(productCheckedText([{ checkedAt: ago(2), lastError: null }], ago(1), NOW)).toBe('Verificado há 2 h')
  })

  it('agrees the listing count in number, and says nothing for none', () => {
    expect(listingCountText(0)).toBeNull()
    expect(listingCountText(1)).toBe('1 anúncio acompanhado')
    expect(listingCountText(4)).toBe('4 anúncios acompanhados')
  })
})

describe('lowNote', () => {
  it('says the best price is at the 30-day low, or how far above it', () => {
    expect(lowNote(19990, 19990)).toEqual({ text: AT_LOW_TEXT, good: true })
    expect(lowNote(19000, 19990)).toEqual({ text: AT_LOW_TEXT, good: true })
    expect(lowNote(22990, 19990)).toEqual({ text: `${formatCents(3000)} acima do menor preço em 30 dias (${formatCents(19990)})`, good: false })
  })

  it('shows the low alone without a best price, and nothing without history', () => {
    expect(lowNote(null, 19990)).toEqual({ text: `Menor preço em 30 dias: ${formatCents(19990)}`, good: false })
    expect(lowNote(22990, null)).toBeNull()
  })
})

describe('targetNote', () => {
  it('says the target was reached at or below it', () => {
    expect(targetNote(20000, 20000)).toEqual({ text: `Preço alvo de ${formatCents(20000)} atingido`, good: true })
    expect(targetNote(19000, 20000)?.good).toBe(true)
  })

  it('says how much is missing above the target, and only the target without a price', () => {
    expect(targetNote(22990, 20000)).toEqual({ text: `Preço alvo: ${formatCents(20000)} (faltam ${formatCents(2990)})`, good: false })
    expect(targetNote(null, 20000)).toEqual({ text: `Preço alvo: ${formatCents(20000)}`, good: false })
    expect(targetNote(22990, null)).toBeNull()
  })
})

describe('alertsText and eanText', () => {
  it('lists the alerts, with the target only when set', () => {
    expect(alertsText({ targetPriceCents: null, dropPercent: 10 })).toBe('Alertas: novo menor preço em 30 dias, queda de 10%')
    expect(alertsText({ targetPriceCents: 20000, dropPercent: 15 }))
      .toBe(`Alertas: preço alvo de ${formatCents(20000)}, novo menor preço em 30 dias, queda de 15%`)
  })

  it('shows the barcode with where it came from', () => {
    expect(eanText({ ean: VALID_EAN, eanSource: 'manual' })).toBe(`Código de barras: ${VALID_EAN} (digitado)`)
    expect(eanText({ ean: VALID_EAN, eanSource: 'americanas' })).toBe(`Código de barras: ${VALID_EAN} (da Americanas)`)
    expect(eanText({ ean: VALID_EAN, eanSource: null })).toBe(`Código de barras: ${VALID_EAN}`)
    expect(eanText({ ean: null, eanSource: null })).toBeNull()
  })
})

describe('productSummary', () => {
  it('shows the best price, its store, the low, the target and the last check', () => {
    expect(productSummary(product({ targetPriceCents: 20000 }), NOW)).toEqual({
      price: formatCents(22990),
      bestLine: 'Menor preço: Amazon',
      noPrice: null,
      low: { text: `${formatCents(3000)} acima do menor preço em 30 dias (${formatCents(19990)})`, good: false },
      target: { text: `Preço alvo: ${formatCents(20000)} (faltam ${formatCents(2990)})`, good: false },
      checked: 'Verificado há 2 h',
      listings: '1 anúncio acompanhado',
    })
  })

  it('says why there is no price: no listing found yet, or none priced now', () => {
    expect(productSummary(product({ best: null, listings: [] }), NOW)).toMatchObject({ noPrice: NO_LISTINGS_TEXT, listings: null, checked: NOT_CHECKED_TEXT })
    const unpriced = productSummary(product({ best: null, listings: [listing({ inStock: false })] }), NOW)
    expect(unpriced).toMatchObject({ price: null, bestLine: null, noPrice: NO_PRICE_TEXT })
  })

  it('says the stores were searched and found nothing, with what to try, once a search ran', () => {
    const searched = new Date(NOW.getTime() - 3 * HOUR_MS)
    const kindle = product({ name: 'Kindle 11ª geração 16GB Preto', best: null, listings: [], resolvedAt: searched })
    expect(productSummary(kindle, NOW)).toMatchObject({ noPrice: NO_MATCH_TEXT, checked: 'Buscado há 3 h', listings: null })
    expect(NO_MATCH_TEXT).toBe(`${NO_STORE_FOUND_TEXT} Adicione-o de novo com um nome mais completo (modelo e cor) ou com o código de barras, ou use "Buscar agora" mais tarde.`)
    expect(NO_STORE_FOUND_TEXT).toBe('Nenhuma loja encontrou este produto na última busca.')
    expect(emptyListingsText(kindle)).toBe(NO_TRACKED_LISTINGS_TEXT)
  })

  it('keeps the waiting texts before the first search, and gives a link-named product only the plain no-price line', () => {
    const waiting = product({ best: null, listings: [], resolvedAt: null })
    expect(productSummary(waiting, NOW)).toMatchObject({ noPrice: NO_LISTINGS_TEXT, checked: NOT_CHECKED_TEXT })
    expect(emptyListingsText(waiting)).toBe(NO_LISTINGS_TEXT)
    const byLink = product({ name: 'https://www.kabum.com.br/produto/925350', best: null, listings: [], resolvedAt: new Date(NOW.getTime() - HOUR_MS) })
    expect(productSummary(byLink, NOW)).toMatchObject({ noPrice: NO_PRICE_TEXT, checked: 'Buscado há 1 h' })
    expect(emptyListingsText(byLink)).toBe(NO_TRACKED_LISTINGS_TEXT)
    expect(productSummary({ ...byLink, resolvedAt: null }, NOW).noPrice).toBe(NO_LISTINGS_TEXT)
    expect(productHeading(byLink.name, byLink.resolvedAt).pending).toBe(NAME_UNREAD_TEXT)
  })

  it('names the Buscapé merchant of the best offer', () => {
    const best = { listingId: 'l2', retailer: 'buscape', merchant: 'Casas Bahia', finalCents: 21000, url: 'https://www.buscape.com.br/fone/x' } as const
    expect(productSummary(product({ best }), NOW).bestLine).toBe('Menor preço: Casas Bahia (via Buscapé)')
  })

  it('says when the best price needs the ML coupon', () => {
    const ml = listing({ id: 'ml', retailer: 'ml', priceCents: 24990, finalCents: 21990 })
    const best = { listingId: 'ml', retailer: 'ml', merchant: null, finalCents: 21990, url: ml.url } as const
    expect(productSummary(product({ best, listings: [ml] }), NOW)).toMatchObject({
      price: formatCents(21990), bestLine: 'Menor preço: Mercado Livre, com cupom',
    })
  })
})

describe('listingRows', () => {
  const ml = listing({ id: 'ml', retailer: 'ml', match: 'auto', priceCents: 24990, listPriceCents: null, finalCents: 21990, url: 'https://produto.mercadolivre.com.br/MLB-1' })
  const kabum = listing({ id: 'kb', retailer: 'kabum', match: 'link', priceCents: null, listPriceCents: null, finalCents: null, inStock: null, checkedAt: null })
  const amazon = listing({ id: 'am', priceCents: 22990, finalCents: 22990 })

  it('puts the best listing first, then the cheapest, unpriced last', () => {
    const rows = listingRows(product({ best: { listingId: 'ml', retailer: 'ml', merchant: null, finalCents: 21990, url: ml.url }, listings: [kabum, amazon, ml] }), NOW)
    expect(rows.map((row) => row.id)).toEqual(['ml', 'am', 'kb'])
    expect(rows.map((row) => row.best)).toEqual([true, false, false])
  })

  it('shows prices, the list price, the final price with the ML coupon and the match label', () => {
    const [row] = listingRows(product({ best: null, listings: [ml] }), NOW)
    expect(row).toMatchObject({
      store: 'Mercado Livre', removeConfirm: removeListingConfirmText('ml', null), price: formatCents(24990), listPrice: NO_VALUE, finalPrice: `${formatCents(21990)} com cupom`,
      match: 'automático', checked: 'Verificado há 2 h', error: null, outOfStock: false, best: false,
    })
  })

  it('a listing never checked has no prices and says so', () => {
    const [row] = listingRows(product({ best: null, listings: [kabum] }), NOW)
    expect(row).toMatchObject({ price: NO_VALUE, finalPrice: NO_VALUE, match: 'link', checked: NOT_CHECKED_TEXT, outOfStock: false })
  })

  it('shows the barcode label, the stock, and a failed last check as an attempt whose price is older', () => {
    const [row] = listingRows(product({ best: null, listings: [listing({ inStock: false, lastError: 'HTTP 503' })] }), NOW)
    expect(row).toMatchObject({
      match: 'código de barras', outOfStock: true, finalPrice: formatCents(22990), checked: 'Última tentativa há 2 h',
      error: `Falha na última verificação: HTTP 503. ${STALE_PRICE_TEXT}`,
    })
  })

  it('a failed check with no price yet only says it failed', () => {
    const [row] = listingRows(product({ best: null, listings: [{ ...kabum, checkedAt: NOW, lastError: 'sem resposta' }] }), NOW)
    expect(row.error).toBe('Falha na última verificação: sem resposta.')
  })

  it('adds no period after an error that already ends in punctuation', () => {
    const [row] = listingRows(product({ best: null, listings: [{ ...kabum, checkedAt: NOW, lastError: 'Página inesperada. ' }] }), NOW)
    expect(row.error).toBe('Falha na última verificação: Página inesperada.')
    const [asked] = listingRows(product({ best: null, listings: [{ ...kabum, checkedAt: NOW, lastError: 'bloqueado?' }] }), NOW)
    expect(asked.error).toBe('Falha na última verificação: bloqueado?')
  })

  it('drops a link that is not https', () => {
    const [row] = listingRows(product({ best: null, listings: [listing({ url: 'javascript:void(0)' })] }), NOW)
    expect(row.url).toBeNull()
  })
})

describe('priceCents and centsDraft', () => {
  it('reads reais typed with a comma, a dot, thousands dots or the currency sign', () => {
    expect(priceCents('1299,90')).toBe(129990)
    expect(priceCents('1299.9')).toBe(129990)
    expect(priceCents('1.299,90')).toBe(129990)
    expect(priceCents('R$ 250')).toBe(25000)
    expect(priceCents(' 99,5 ')).toBe(9950)
  })

  it('refuses empty, zero, negative and malformed prices', () => {
    expect(priceCents('')).toBeNull()
    expect(priceCents('0')).toBeNull()
    expect(priceCents('-10')).toBeNull()
    expect(priceCents('12,345')).toBeNull()
    expect(priceCents('abc')).toBeNull()
  })

  it('needs groups of 3 digits after each thousands dot', () => {
    expect(priceCents('1.2.3,00')).toBeNull()
    expect(priceCents('12.34,00')).toBeNull()
    expect(priceCents('1234.567,00')).toBeNull()
    expect(priceCents('1.234.567,00')).toBe(123456700)
    expect(priceCents('1.299')).toBeNull()
  })

  it('writes cents back as a draft with a comma', () => {
    expect(centsDraft(129990)).toBe('1299,90')
    expect(centsDraft(25000)).toBe('250,00')
    expect(centsDraft(null)).toBe('')
    expect(priceCents(centsDraft(129990))).toBe(129990)
  })
})

describe('dropPercentOf', () => {
  it('takes a whole percent within the bounds', () => {
    expect(dropPercentOf('10')).toBe(10)
    expect(dropPercentOf(' 1 ')).toBe(1)
    expect(dropPercentOf('90')).toBe(90)
  })

  it('refuses out-of-range, decimal and empty values', () => {
    expect(dropPercentOf('0')).toBeNull()
    expect(dropPercentOf('91')).toBeNull()
    expect(dropPercentOf('7,5')).toBeNull()
    expect(dropPercentOf('')).toBeNull()
  })
})

describe('the add form', () => {
  const draft = { nameOrLink: 'Fone JBL Tune 520BT', ean: '', targetPrice: '' }

  it('needs only the name or link', () => {
    expect(validateWatchDraft(draft)).toEqual({})
    expect(validateWatchDraft({ ...draft, nameOrLink: '   ' })).toEqual({ nameOrLink: NAME_OR_LINK_REQUIRED_TEXT })
  })

  it('takes a supported store link, and refuses any other link or a name that is too long', () => {
    expect(validateWatchDraft({ ...draft, nameOrLink: 'https://www.kabum.com.br/produto/925350' })).toEqual({})
    expect(validateWatchDraft({ ...draft, nameOrLink: 'https://www.magazineluiza.com.br/fone/p/123' }).nameOrLink).toBe(UNKNOWN_LINK_TEXT)
    expect(validateWatchDraft({ ...draft, nameOrLink: 'www.exemplo.com/fone' }).nameOrLink).toBe(UNKNOWN_LINK_TEXT)
    expect(validateWatchDraft({ ...draft, nameOrLink: 'x'.repeat(WATCH_NAME_MAX) })).toEqual({})
    expect(validateWatchDraft({ ...draft, nameOrLink: 'x'.repeat(WATCH_NAME_MAX + 1) }).nameOrLink).toBe(NAME_TOO_LONG_TEXT)
  })

  it('checks the barcode digits and the target price when given', () => {
    expect(validateWatchDraft({ ...draft, ean: '7891234567890' }).ean).toBe(INVALID_EAN_TEXT)
    expect(validateWatchDraft({ ...draft, ean: `789 1234 56789 5` }).ean).toBeUndefined()
    expect(validateWatchDraft({ ...draft, targetPrice: 'abc' }).targetPrice).toBe(INVALID_PRICE_TEXT)
  })

  it('points at the first invalid field in form order', () => {
    expect(firstInvalidWatchField({ targetPrice: 'x', nameOrLink: 'y' })).toBe('nameOrLink')
    expect(firstInvalidWatchField({})).toBeNull()
  })

  it('sends the trimmed name, the normalized barcode and the target in cents, leaving out what is empty', () => {
    expect(watchRequestOf({ nameOrLink: '  https://www.kabum.com.br/produto/925350  ', ean: '', targetPrice: '' }))
      .toEqual({ nameOrLink: 'https://www.kabum.com.br/produto/925350' })
    expect(watchRequestOf({ nameOrLink: 'Fone', ean: '789-1234567895', targetPrice: '199,90' }))
      .toEqual({ nameOrLink: 'Fone', ean: VALID_EAN, targetPriceCents: 19990 })
  })

  it('maps the server field errors onto the form, and anything else to one form error', () => {
    expect(watchCreateFailure(400, { error: 'invalid_request', details: { fieldErrors: { ean: ['x'], targetPriceCents: ['y'] } } }))
      .toEqual({ ean: INVALID_EAN_TEXT, targetPrice: INVALID_PRICE_TEXT })
    expect(watchCreateFailure(400, { error: 'invalid_request', details: { fieldErrors: { nameOrLink: ['x'] } } })).toEqual({ nameOrLink: CHECK_NAME_OR_LINK_TEXT })
    expect(watchCreateFailure(400, { error: 'invalid_request', details: { fieldErrors: { nameOrLink: [UNKNOWN_LINK_TEXT] } } })).toEqual({ nameOrLink: UNKNOWN_LINK_TEXT })
    expect(watchCreateFailure(400, { error: 'invalid_request', details: { fieldErrors: { nameOrLink: [NAME_TOO_LONG_TEXT] } } })).toEqual({ nameOrLink: NAME_TOO_LONG_TEXT })
    expect(watchCreateFailure(400, { error: 'invalid_request', details: { fieldErrors: { other: ['x'] } } })).toEqual({ form: WATCH_CREATE_FAILED_TEXT })
    expect(watchCreateFailure(500, null)).toEqual({ form: WATCH_CREATE_FAILED_TEXT })
  })
})

describe('the alert settings', () => {
  it('starts from the saved target and drop', () => {
    expect(settingsDraftOf({ targetPriceCents: 19990, dropPercent: 15 })).toEqual({ targetPrice: '199,90', dropPercent: '15' })
    expect(settingsDraftOf({ targetPriceCents: null, dropPercent: 10 })).toEqual({ targetPrice: '', dropPercent: '10' })
  })

  it('checks the target and the drop, and gives no patch while either is wrong', () => {
    expect(settingsResult({ targetPrice: 'x', dropPercent: '0' })).toEqual({ patch: null, errors: { targetPrice: INVALID_PRICE_TEXT, dropPercent: INVALID_DROP_TEXT } })
    expect(settingsResult({ targetPrice: '150', dropPercent: '' })).toEqual({ patch: null, errors: { dropPercent: INVALID_DROP_TEXT } })
    expect(settingsResult({ targetPrice: 'x', dropPercent: '10' })).toEqual({ patch: null, errors: { targetPrice: INVALID_PRICE_TEXT } })
  })

  it('sends the target in cents and the drop, an empty target clearing it', () => {
    expect(settingsResult({ targetPrice: '150', dropPercent: '12' })).toEqual({ patch: { targetPriceCents: 15000, dropPercent: 12 }, errors: null })
    expect(settingsResult({ targetPrice: '  ', dropPercent: '10' })).toEqual({ patch: { targetPriceCents: null, dropPercent: 10 }, errors: null })
  })
})

describe('refusals and confirmations', () => {
  it('takes the text of a 409 refusal, such as a hold, and nothing else', () => {
    expect(conflictText(409, { error: 'Requisições pausadas manualmente' })).toBe('Requisições pausadas manualmente')
    expect(conflictText(422, { error: 'x' })).toBeNull()
    expect(conflictText(409, { error: '  ' })).toBeNull()
    expect(conflictText(500, { error: 'internal_error' })).toBeNull()
    expect(conflictText(409, null)).toBeNull()
  })

  it('points at the first invalid alert setting', () => {
    expect(firstInvalidSettingsField({ dropPercent: 'x', targetPrice: 'y' })).toBe('targetPrice')
    expect(firstInvalidSettingsField({ dropPercent: 'x' })).toBe('dropPercent')
    expect(firstInvalidSettingsField({})).toBeNull()
  })

  it('names what is being stopped or removed', () => {
    expect(stopConfirmText(productHeading('Fone JBL', null))).toBe('Parar de monitorar "Fone JBL"? Ele sai da lista e você não recebe mais alertas dele.')
    expect(stopConfirmText(productHeading('https://www.kabum.com.br/produto/925350', null)))
      .toBe('Parar de monitorar este produto? Ele sai da lista e você não recebe mais alertas dele.')
    expect(removeListingConfirmText('amazon', 'Amazon.com.br')).toBe('Remover este anúncio (Amazon)? Ele não será buscado de novo.')
    expect(removeListingConfirmText('buscape', 'Magazine Luiza')).toBe('Remover este anúncio (Magazine Luiza, via Buscapé)? Ele não será buscado de novo.')
    expect(removeListingConfirmText('buscape', null)).toBe('Remover este anúncio (Buscapé)? Ele não será buscado de novo.')
  })
})

describe('the monitor panel', () => {
  const source = (over: Partial<WatchSourceStatus> = {}): WatchSourceStatus => ({
    retailer: 'americanas', state: 'waiting', waitingFor: 'next_refresh', holdText: null, blockedUntil: null, lastError: null,
    lastRequestAt: new Date(NOW.getTime() - 20 * MINUTE_MS), requestsToday: 14, listings: 3, nextRefreshAt: new Date(NOW.getTime() + 2 * HOUR_MS), ...over,
  })
  const status = (over: Partial<WatchStatus> = {}): WatchStatus => ({ products: 2, sources: [source()], lastAlert: null, ...over })

  it('describes each state', () => {
    const until = new Date(NOW.getTime() + 4 * HOUR_MS)
    expect(sourceStateText(source({ state: 'running' }))).toBe(RUNNING_TEXT)
    expect(sourceStateText(source({ state: 'held', holdText: 'VPN conectada' }))).toBe('Em espera: VPN conectada')
    expect(sourceStateText(source({ state: 'held' }))).toBe('Em espera')
    expect(sourceStateText(source({ state: 'blocked', blockedUntil: until, lastError: 'HTTP 403' })))
      .toBe(`Bloqueado até ${formatDayMonthTime(until)} (HTTP 403)`)
    expect(sourceStateText(source({ state: 'blocked' }))).toBe('Bloqueado')
    expect(sourceStateText(source({ state: 'stopped' }))).toBe(STOPPED_TEXT)
    expect(STOPPED_TEXT).toBe('Parado: verificações automáticas desligadas (AUTO_RUN=off)')
    expect(WATCH_ADDED_IDLE_TEXT).toBe('Produto salvo, mas sem busca por enquanto: verificações automáticas desligadas (AUTO_RUN=off).')
    expect(sourceStateText(source({ waitingFor: 'ml_busy' }))).toBe(WAITING_TEXT.ml_busy)
    expect(sourceStateText(source({ waitingFor: 'ml_cycle' }))).toBe('Aguardando o próximo ciclo do Mercado Livre')
    expect(sourceStateText(source({ waitingFor: null }))).toBe(WAITING_FALLBACK_TEXT)
  })

  it('lists the listings, the requests today, the last request and the next check of a store', () => {
    const [panel] = monitorPanel(status(), NOW).sources
    expect(panel).toEqual({
      retailer: 'americanas', label: 'Americanas', state: WAITING_TEXT.next_refresh, alert: false,
      lines: ['Anúncios: 3', 'Requisições hoje: 14', 'Última requisição há 20 min', 'Próxima verificação: em 2 h'],
    })
  })

  it('leaves out the request count of ML, which reads in the cycle, and the next check when none is due', () => {
    const [panel] = monitorPanel(status({ sources: [source({ retailer: 'ml', waitingFor: 'ml_cycle', lastRequestAt: null, nextRefreshAt: null, listings: 0 })] }), NOW).sources
    expect(panel.label).toBe('Mercado Livre')
    expect(panel.lines).toEqual(['Anúncios: 0', NO_REQUEST_YET_TEXT])
  })

  it('flags held, blocked and stopped stores, and shows the last error outside a block', () => {
    const panel = monitorPanel(status({
      sources: [
        source({ state: 'held', holdText: 'VPN conectada' }),
        source({ retailer: 'kabum', state: 'blocked', lastError: 'HTTP 403' }),
        source({ retailer: 'amazon', state: 'stopped' }),
        source({ retailer: 'buscape', lastError: 'página inesperada' }),
      ],
    }), NOW).sources
    expect(panel.map((item) => item.alert)).toEqual([true, true, true, false])
    expect(panel[1].lines).not.toContain('Último erro: HTTP 403')
    expect(panel[3].lines).toContain('Último erro: página inesperada')
  })

  it('sums up the products and the last alert', () => {
    expect(monitorPanel(status(), NOW).summary).toEqual(['Produtos monitorados: 2', NO_ALERT_YET_TEXT])
    const lastAlert = { productName: 'Fone JBL', kind: 'target', priceCents: 19990, sentAt: new Date(NOW.getTime() - 3 * HOUR_MS) } as const
    expect(lastAlertText(lastAlert, NOW)).toBe(`Último alerta há 3 h: Fone JBL por ${formatCents(19990)} (preço alvo)`)
    expect(lastAlertText({ ...lastAlert, kind: 'low_30d' }, NOW)).toContain('menor preço em 30 dias')
    expect(lastAlertText({ ...lastAlert, kind: 'drop' }, NOW)).toContain('queda de preço')
  })
})
