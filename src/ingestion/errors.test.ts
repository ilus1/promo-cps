import { describe, expect, it } from 'vitest'
import { errorText, redactQueries, RunStop } from './errors'

describe('errorText', () => {
  it('a failed query gives the database cause with its code', () => {
    const cause = Object.assign(new Error('deadlock detected\nDETAIL: Process 1 waits'), { code: '40P01' })
    const e = new Error('Failed query: insert into "items" ("id") values ($1)\nparams: x', { cause })
    expect(errorText(e)).toBe('deadlock detected (40P01)')
  })

  it('a plain object cause with a message counts, and a missing code adds nothing', () => {
    expect(errorText(new Error('Failed query: select 1', { cause: { message: 'canceling statement due to lock timeout' } })))
      .toBe('canceling statement due to lock timeout')
    expect(errorText(new Error('fetch failed', { cause: new Error('connect ECONNREFUSED') }))).toBe('connect ECONNREFUSED')
  })

  it('a cause with a non-string code or no message is ignored where it says nothing', () => {
    expect(errorText(new Error('outer', { cause: Object.assign(new Error('inner'), { code: 7 }) }))).toBe('inner')
    expect(errorText(new Error('outer\nmore', { cause: { code: '40P01' } }))).toBe('outer')
    expect(errorText(new Error('outer', { cause: 'text' }))).toBe('outer')
  })

  it('a cause whose first line is empty falls back to the error itself', () => {
    expect(errorText(new Error('Failed query: select 1', { cause: Object.assign(new Error(''), { code: '57014' }) }))).toBe('Failed query: select 1')
    expect(errorText(new Error('Failed query: select 2', { cause: { message: '  \ndetail' } }))).toBe('Failed query: select 2')
  })

  it('a plain error gives its first line', () => {
    expect(errorText(new Error('first\nsecond'))).toBe('first')
  })

  it('a run stop keeps its own message, even with a cause', () => {
    expect(errorText(new RunStop('failed', 'O perfil do navegador já está em uso', { cause: new Error('SingletonLock') })))
      .toBe('O perfil do navegador já está em uso')
  })

  it('a non-error gives its text', () => {
    expect(errorText('boom\nmore')).toBe('boom')
    expect(errorText(42)).toBe('42')
    expect(errorText(undefined)).toBe('undefined')
  })
})

describe('redactQueries', () => {
  it.each([
    ['', ''],
    ['no url here', 'no url here'],
    ['https://www.mercadolivre.com.br/cupons/filter', 'https://www.mercadolivre.com.br/cupons/filter'],
    ['https://a.com.br/p?code=SECRET&x=1', 'https://a.com.br/p'],
    ['https://a.com.br/p#frag', 'https://a.com.br/p'],
    ['Sessão expirada (https://a.com.br/login?go=https%3A%2F%2Fb.com%3Fc%3D1)', 'Sessão expirada (https://a.com.br/login)'],
    ['one https://a.com/x?k=1 and two https://b.com/y?k=2.', 'one https://a.com/x and two https://b.com/y'],
    ['goto "https://a.com/x?k=1" failed', 'goto "https://a.com/x" failed'],
  ])('%j -> %j', (input, output) => {
    expect(redactQueries(input)).toBe(output)
  })
})
