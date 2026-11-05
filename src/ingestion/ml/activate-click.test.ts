import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/coupons-page.json'
import {
  ACTIVATION_OTHER_COUPON, ACTIVATION_REFUSED, activationOutcome, activationStop, APPLY_BUTTON_AMBIGUOUS,
  APPLY_BUTTON_NOT_FOUND, applyTarget, canApply, chooseApplyButton, isActivateResponse, matchOnPage,
  type ApplyButton, type CouponEntry,
} from './activate-click'
import { COUPON_ACTION_LINK, COUPON_STATUS_ACTIVE, parseCoupon, parseCouponPage, type RawCoupon } from './coupons'

const NOW = new Date('2026-11-02T12:00Z')
const READY = '14565378'
const ALREADY_ACTIVE = '14633544'
const pageCoupons = parseCouponPage(fixture).coupons

function fixtureCoupon(campaignId: string): CouponEntry {
  const found = pageCoupons.find(({ parsed }) => parsed.campaignId === campaignId)
  if (!found) throw new Error(`O fixture não tem o cupom ${campaignId}`)
  return found
}

const ready = fixtureCoupon(READY)

function variant(over: Partial<RawCoupon>): CouponEntry {
  const raw = { ...ready.raw, ...over }
  return { parsed: parseCoupon(raw), raw }
}

describe('canApply', () => {
  it('accepts an inactive EU_QUERO coupon with an Aplicar button that has started', () => {
    expect(canApply(ready, NOW)).toBe(true)
  })
  it('rejects a coupon that has not started yet', () => {
    expect(canApply(ready, new Date('2026-10-22T12:29Z'))).toBe(false)
  })
  it('accepts a coupon without a start date', () => {
    expect(canApply(variant({ future_coupon_info: {} }), NOW)).toBe(true)
  })
  it('rejects an active coupon', () => {
    expect(canApply(variant({ status: { id: COUPON_STATUS_ACTIVE } }), NOW)).toBe(false)
  })
  it('rejects an automatic coupon', () => {
    expect(canApply(variant({ activation_type: 'AUTOMATIC' }), NOW)).toBe(false)
  })
  it('rejects a coupon without an activation code', () => {
    expect(canApply(variant({ code: ' ' }), NOW)).toBe(false)
  })
  it('rejects a coupon whose action is not the Aplicar button', () => {
    expect(canApply(variant({ action: { type: 'link', text: 'Conferir' } }), NOW)).toBe(false)
    expect(canApply(variant({ action: { type: 'button', text: 'Usar' } }), NOW)).toBe(false)
  })
})

describe('matchOnPage', () => {
  const c = (campaignId: string) => ({ campaignId })
  const second = variant({ campaign_id: '777' })
  const match = matchOnPage([c('777'), c('missing'), c(ALREADY_ACTIVE), c(READY)], [...pageCoupons, second], NOW)
  it('keeps candidates whose Aplicar button is on the page, in candidate order', () => {
    expect(match.applicable.map(({ candidate, coupon }) => [candidate.campaignId, coupon.parsed.campaignId])).toEqual([
      ['777', '777'], [READY, READY],
    ])
  })
  it('lists candidates whose card is on the page without an Aplicar button', () => {
    expect(match.notApplicable).toEqual([c(ALREADY_ACTIVE)])
  })
  it('leaves out candidates whose card is not on the page', () => {
    const all = [...match.applicable.map((m) => m.candidate), ...match.notApplicable]
    expect(all).not.toContainEqual(c('missing'))
  })
  it('finds nothing on a page without coupons', () => {
    expect(matchOnPage([c(READY)], [], NOW)).toEqual({ applicable: [], notApplicable: [] })
  })
})

describe('activationOutcome', () => {
  const activated = JSON.stringify({
    coupon: {
      campaignId: ALREADY_ACTIVE, code: '',
      action: { text: 'Conferir', type: COUPON_ACTION_LINK, value: 'https://lista.mercadolivre.com.br/_Container_FH-Cupom-Boost-16?coupon_campaign_id=14633544' },
    },
  })
  it('succeeds on HTTP 200 whose coupon action became a link', () => {
    expect(activationOutcome(200, activated, ALREADY_ACTIVE)).toEqual({ ok: true })
  })
  it('compares a numeric campaignId as a string', () => {
    const numeric = JSON.stringify({ coupon: { campaignId: Number(ALREADY_ACTIVE), action: { type: COUPON_ACTION_LINK } } })
    expect(activationOutcome(200, numeric, ALREADY_ACTIVE)).toEqual({ ok: true })
  })
  it('fails when the response is for another coupon', () => {
    expect(activationOutcome(200, activated, READY)).toEqual({ ok: false, error: ACTIVATION_OTHER_COUPON })
  })
  it('fails when the response has no campaignId', () => {
    const anonymous = JSON.stringify({ coupon: { action: { type: COUPON_ACTION_LINK } } })
    expect(activationOutcome(200, anonymous, READY)).toEqual({ ok: false, error: ACTIVATION_OTHER_COUPON })
  })
  it('fails on HTTP 200 whose coupon action is still a button', () => {
    expect(activationOutcome(200, JSON.stringify({ coupon: { campaignId: READY, action: { type: 'button' } } }), READY))
      .toEqual({ ok: false, error: `${ACTIVATION_REFUSED} (HTTP 200)` })
  })
  it('stores the message ML sends with an error', () => {
    expect(activationOutcome(400, JSON.stringify({ message: ' Cupom esgotado ', error: 'bad_request' }), READY))
      .toEqual({ ok: false, error: 'Cupom esgotado (HTTP 400)' })
  })
  it('falls back to the error field', () => {
    expect(activationOutcome(403, JSON.stringify({ error: 'forbidden' }), READY))
      .toEqual({ ok: false, error: 'forbidden (HTTP 403)' })
  })
  it('fails on a body that is not JSON', () => {
    expect(activationOutcome(200, '<html>', READY)).toEqual({ ok: false, error: `${ACTIVATION_REFUSED} (HTTP 200)` })
    expect(activationOutcome(502, '', READY)).toEqual({ ok: false, error: `${ACTIVATION_REFUSED} (HTTP 502)` })
  })
  it('fails on a link shape with a status other than 200', () => {
    expect(activationOutcome(201, activated, ALREADY_ACTIVE)).toEqual({ ok: false, error: `${ACTIVATION_REFUSED} (HTTP 201)` })
  })
  it('caps a long ML error text', () => {
    const outcome = activationOutcome(400, JSON.stringify({ message: 'x'.repeat(500) }), READY)
    expect(outcome).toEqual({ ok: false, error: `${'x'.repeat(200)} (HTTP 400)` })
  })
})

function percentCoupon(campaignId: string, title: string, srLabel: string): CouponEntry {
  return variant({
    campaign_id: campaignId,
    title: { text: title, accessibility: { title: { fractional_amount: '15', decimal_amount: '0' } } },
    action: { type: 'button', text: 'Aplicar', accessibility: { sr_label: srLabel } },
  })
}

const plain = percentCoupon('13410523', '15% OFF ', 'Aplicar cupom 15 por cento OFF Em produtos selecionados')
const fashion = percentCoupon('14422618', '15% OFF em Fashion', 'Aplicar cupom 15 por cento OFF em Fashion Em produtos selecionados')

function buttonFor({ raw }: CouponEntry, index: number, extraText = ''): ApplyButton {
  return {
    ariaLabel: raw.action?.accessibility?.sr_label ?? null,
    cardText: `${raw.title?.text ?? ''} ${raw.initial_subtitle?.text ?? ''} Está esgotando! ${extraText} Aplicar`,
    index,
  }
}

const withoutSrLabel = (coupon: CouponEntry) => ({ ...applyTarget(coupon), srLabel: '' })

describe('chooseApplyButton', () => {
  const fixtureButtons = pageCoupons.filter((c) => canApply(c, NOW)).map((c, i) => buttonFor(c, i * 2))
  const buttons = [...fixtureButtons, buttonFor(plain, 20), buttonFor(fashion, 21)]

  it('finds the button of a committed fixture coupon by its exact aria-label', () => {
    expect(fixtureButtons.length).toBeGreaterThan(0)
    expect(chooseApplyButton(buttons, applyTarget(ready))).toEqual({ ok: true, index: 0 })
  })
  it('resolves 15% OFF to exactly one button although 15% OFF em Fashion contains its title', () => {
    expect(chooseApplyButton(buttons, applyTarget(plain))).toEqual({ ok: true, index: 20 })
    expect(chooseApplyButton(buttons, applyTarget(fashion))).toEqual({ ok: true, index: 21 })
  })
  it('still resolves the pair when each card text also holds the other title', () => {
    const wide = [buttonFor(plain, 3, fashion.parsed.title), buttonFor(fashion, 4, plain.parsed.title)]
    expect(chooseApplyButton(wide, applyTarget(plain))).toEqual({ ok: true, index: 3 })
    expect(chooseApplyButton(wide, applyTarget(fashion))).toEqual({ ok: true, index: 4 })
  })
  it('without an srLabel falls back to title and scope and refuses an ambiguous match', () => {
    expect(chooseApplyButton(buttons, withoutSrLabel(plain))).toEqual({ ok: false, error: APPLY_BUTTON_AMBIGUOUS })
    expect(chooseApplyButton(buttons, withoutSrLabel(fashion))).toEqual({ ok: true, index: 21 })
  })
  it('does not click a button whose aria-label matches when the card does not confirm the title', () => {
    const elsewhere = { ...buttonFor(plain, 5), cardText: 'R$ 50 OFF Em produtos selecionados Aplicar' }
    expect(chooseApplyButton([elsewhere], applyTarget(plain))).toEqual({ ok: false, error: APPLY_BUTTON_NOT_FOUND })
  })
  it('reports no button on a page without Aplicar buttons', () => {
    expect(chooseApplyButton([], applyTarget(plain))).toEqual({ ok: false, error: APPLY_BUTTON_NOT_FOUND })
  })
  it('reports two buttons with the same aria-label as ambiguous', () => {
    const twice = [buttonFor(plain, 1), buttonFor(plain, 2)]
    expect(chooseApplyButton(twice, applyTarget(plain))).toEqual({ ok: false, error: APPLY_BUTTON_AMBIGUOUS })
  })
})

describe('isActivateResponse', () => {
  const url = (campaignId: string) =>
    `https://www.mercadolivre.com.br/cupons/api/activate?coupon_activate_code=x&campaign_id=${campaignId}&origin=filter`
  it('matches the activate response of the clicked coupon', () => {
    expect(isActivateResponse(url(READY), READY)).toBe(true)
  })
  it('ignores the activate response of another coupon', () => {
    expect(isActivateResponse(url(ALREADY_ACTIVE), READY)).toBe(false)
  })
  it('ignores other requests', () => {
    expect(isActivateResponse(`https://www.mercadolivre.com.br/cupons/api/terms?campaign_id=${READY}`, READY)).toBe(false)
  })
})

describe('activationStop', () => {
  it.each([[403, 'blocked'], [429, 'blocked'], [401, 'session_expired']])('stops the run on HTTP %i', (status, stop) => {
    expect(activationStop(status)).toBe(stop)
  })
  it.each([200, 400, 404, 500])('lets HTTP %i be recorded', (status) => {
    expect(activationStop(status)).toBeNull()
  })
})
