import { describe, expect, it } from 'vitest'
import { ML_COUPONS_URL } from './constants'
import { closedOutcome, verifyPhase, verifyTarget } from './ml-verify'

const LISTING = 'https://lista.mercadolivre.com.br/ssd?coupon_campaign_id=14633544'

describe('verifyPhase', () => {
  it('reads the logged-in captcha wall as walled', () => {
    expect(verifyPhase(`https://www.mercadolivre.com.br/captcha/wall/logged?go_url=${encodeURIComponent(LISTING)}`)).toBe('walled')
  })

  it('reads the account verification page as walled', () => {
    expect(verifyPhase('https://www.mercadolivre.com.br/gz/account-verification')).toBe('walled')
  })

  it('reads an ordinary ML page as cleared', () => {
    expect(verifyPhase(LISTING)).toBe('cleared')
    expect(verifyPhase(ML_COUPONS_URL)).toBe('cleared')
  })

  it('does not count the login page as cleared', () => {
    expect(verifyPhase('https://www.mercadolivre.com.br/login/identification')).toBe('other')
  })

  it('does not count a foreign host or a blank page as cleared', () => {
    expect(verifyPhase('https://example.com/')).toBe('other')
    expect(verifyPhase('about:blank')).toBe('other')
    expect(verifyPhase('not a url')).toBe('other')
  })
})

describe('verifyPhase with a response status', () => {
  it.each([403, 429])('reads status %i on an ordinary ML page as walled', (status) => {
    expect(verifyPhase(LISTING, status)).toBe('walled')
  })

  it.each([200, 302, 404, null])('keeps an ordinary ML page cleared for status %s', (status) => {
    expect(verifyPhase(LISTING, status)).toBe('cleared')
  })

  it('does not let a blocking status turn an unparsable URL into a wall', () => {
    expect(verifyPhase('not a url', 403)).toBe('other')
  })
})

describe('verifyTarget', () => {
  it('uses the first target listing url', () => {
    expect(verifyTarget([{ listingUrl: LISTING }, { listingUrl: 'https://lista.mercadolivre.com.br/x' }])).toBe(LISTING)
  })

  it('falls back to the coupons page without targets', () => {
    expect(verifyTarget([])).toBe(ML_COUPONS_URL)
  })
})

describe('closedOutcome', () => {
  it('counts a window closed after the wall cleared as cleared', () => {
    expect(closedOutcome('cleared')).toBe('cleared')
  })

  it('counts a window closed while walled, elsewhere or unseen as closed', () => {
    expect(closedOutcome('walled')).toBe('closed')
    expect(closedOutcome('other')).toBe('closed')
    expect(closedOutcome(null)).toBe('closed')
  })
})
