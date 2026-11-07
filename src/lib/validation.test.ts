import { describe, expect, it } from 'vitest'
import { CreateWatch, INVALID_EAN, PATCH_EMPTY, UpdateWatch } from './validation'
import { NAME_TOO_LONG_TEXT, UNKNOWN_LINK_TEXT, WATCH_NAME_MAX } from './watch/input-rules'

const EAN = '7891234567895'
const messages = (result: { success: false; error: { issues: { message: string }[] } }) => result.error.issues.map((i) => i.message)

describe('CreateWatch', () => {
  it('takes a typed name as both the name and no link', () => {
    expect(CreateWatch.parse({ nameOrLink: '  Fone JBL Tune 520BT ' })).toEqual({ nameOrLink: { name: 'Fone JBL Tune 520BT', link: null } })
  })

  it('takes a store link, naming the product by its canonical link until the title is read', () => {
    const parsed = CreateWatch.parse({ nameOrLink: 'https://www.kabum.com.br/produto/925350/fone-jbl?x=1', ean: ` ${EAN} `, targetPriceCents: 29_990 })
    expect(parsed).toEqual({
      nameOrLink: { name: 'https://www.kabum.com.br/produto/925350', link: { retailer: 'kabum', ref: '925350', url: 'https://www.kabum.com.br/produto/925350' } },
      ean: EAN,
      targetPriceCents: 29_990,
    })
  })

  it.each([
    ['an unknown store link', { nameOrLink: 'https://www.magazineluiza.com.br/fone/p/123' }, UNKNOWN_LINK_TEXT],
    ['a bare www address', { nameOrLink: 'www.example.com/fone' }, UNKNOWN_LINK_TEXT],
    ['a name over the limit', { nameOrLink: 'x'.repeat(WATCH_NAME_MAX + 1) }, NAME_TOO_LONG_TEXT],
    ['a bad barcode', { nameOrLink: 'fone', ean: '7891234567890' }, INVALID_EAN],
  ])('rejects %s with its message', (_, body, message) => {
    const result = CreateWatch.safeParse(body)
    expect(result.success).toBe(false)
    if (!result.success) expect(messages(result)).toEqual([message])
  })

  it.each([
    ['a blank name', { nameOrLink: '   ' }],
    ['a missing name', {}],
    ['a zero target', { nameOrLink: 'fone', targetPriceCents: 0 }],
    ['a fractional target', { nameOrLink: 'fone', targetPriceCents: 10.5 }],
    ['a target as text', { nameOrLink: 'fone', targetPriceCents: '100' }],
    ['a drop of 0', { nameOrLink: 'fone', dropPercent: 0 }],
    ['a drop of 91', { nameOrLink: 'fone', dropPercent: 91 }],
    ['an unknown key', { nameOrLink: 'fone', query: 'x' }],
    ['a null body', null],
  ])('rejects %s', (_, body) => expect(CreateWatch.safeParse(body).success).toBe(false))

  it('accepts a name of exactly the limit and a drop at both ends', () => {
    expect(CreateWatch.safeParse({ nameOrLink: 'x'.repeat(WATCH_NAME_MAX) }).success).toBe(true)
    expect(CreateWatch.safeParse({ nameOrLink: 'fone', dropPercent: 1 }).success).toBe(true)
    expect(CreateWatch.safeParse({ nameOrLink: 'fone', dropPercent: 90 }).success).toBe(true)
  })
})

describe('UpdateWatch', () => {
  it.each([
    [{ name: 'Fone' }, { name: 'Fone' }],
    [{ ean: EAN }, { ean: EAN }],
    [{ ean: null }, { ean: null }],
    [{ targetPriceCents: null }, { targetPriceCents: null }],
    [{ dropPercent: 15 }, { dropPercent: 15 }],
    [{ active: false }, { active: false }],
  ])('accepts the single field %j', (body, parsed) => expect(UpdateWatch.parse(body)).toEqual(parsed))

  it('rejects an empty patch and one holding only undefined', () => {
    const result = UpdateWatch.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) expect(messages(result)).toEqual([PATCH_EMPTY])
    expect(UpdateWatch.safeParse({ name: undefined }).success).toBe(false)
  })

  it.each([{ name: '' }, { name: 'https://www.kabum.com.br/produto/1' }, { ean: '123' }, { active: 'no' }, { query: 'x' }, null])(
    'rejects %j', (body) => expect(UpdateWatch.safeParse(body).success).toBe(false),
  )
})
