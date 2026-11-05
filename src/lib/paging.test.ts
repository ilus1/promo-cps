import { describe, expect, it } from 'vitest'
import { PAGE_SIZE } from './constants'
import { clampPage, MAX_PAGE, pageFromParams, pageOffset } from './paging'

describe('clampPage', () => {
  it('keeps a page in range', () => expect(clampPage(3)).toBe(3))
  it('floors a fractional page', () => expect(clampPage(2.7)).toBe(2))
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('reads %s as page 1', (page) => {
    expect(clampPage(page)).toBe(1)
  })
  it.each([MAX_PAGE + 1, 1e18])('caps %s at the last allowed page', (page) => {
    expect(clampPage(page)).toBe(MAX_PAGE)
  })
})

describe('pageOffset', () => {
  it('starts page 1 at zero', () => expect(pageOffset(1)).toBe(0))
  it('skips whole pages before the requested one', () => expect(pageOffset(3)).toBe(2 * PAGE_SIZE))
  it('never reaches past the last allowed page', () => {
    expect(pageOffset(1e18)).toBe((MAX_PAGE - 1) * PAGE_SIZE)
  })
  it('reads an invalid page as page 1', () => expect(pageOffset(Number.NaN)).toBe(0))
})

describe('pageFromParams', () => {
  it('reads the page and falls back to 1', () => {
    expect(pageFromParams({ pagina: '3' })).toBe(3)
    expect(pageFromParams({})).toBe(1)
    expect(pageFromParams({ pagina: 'x' })).toBe(1)
    expect(pageFromParams({ pagina: ['2'] })).toBe(1)
    expect(pageFromParams({ pagina: '-2' })).toBe(1)
  })
})

describe('pageOffset with a limit', () => {
  it('multiplies by the given limit', () => {
    expect(pageOffset(3, 10)).toBe(20)
    expect(pageOffset(1, 10)).toBe(0)
  })
})
