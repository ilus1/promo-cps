import { describe, expect, it } from 'vitest'
import { NAME_TOO_LONG_TEXT, nameOrLinkIssue, UNKNOWN_LINK_TEXT, URL_LIKE, WATCH_NAME_MAX } from './input-rules'

describe('nameOrLinkIssue', () => {
  it('accepts a plain name up to the limit and a link from a supported store', () => {
    expect(nameOrLinkIssue('Fone JBL Tune 520BT')).toBeNull()
    expect(nameOrLinkIssue('x'.repeat(WATCH_NAME_MAX))).toBeNull()
    expect(nameOrLinkIssue('https://www.kabum.com.br/produto/925350')).toBeNull()
    expect(nameOrLinkIssue(`https://www.amazon.com.br/dp/B0C1234567?${'x'.repeat(WATCH_NAME_MAX)}`)).toBeNull()
  })

  it('refuses a link it cannot read and a name over the limit', () => {
    expect(nameOrLinkIssue('https://www.magazineluiza.com.br/fone/p/123')).toBe(UNKNOWN_LINK_TEXT)
    expect(nameOrLinkIssue('www.exemplo.com/fone')).toBe(UNKNOWN_LINK_TEXT)
    expect(nameOrLinkIssue('x'.repeat(WATCH_NAME_MAX + 1))).toBe(NAME_TOO_LONG_TEXT)
  })

  it('treats a scheme or a leading www as a link', () => {
    expect(URL_LIKE.test('ftp://x')).toBe(true)
    expect(URL_LIKE.test('WWW.x.com')).toBe(true)
    expect(URL_LIKE.test('fone www')).toBe(false)
  })
})
