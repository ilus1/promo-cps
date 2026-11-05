import { describe, expect, it } from 'vitest'
import { RUN_EVERY_HOURS_OPTIONS } from './constants'
import { EMPTY_SEARCH_TEXT, INVALID_ML_URL } from './ml-url'
import { BUSCA_NAME_MAX } from './busca-rules'
import { CreateBusca, PATCH_EMPTY, RUN_EVERY_HOURS_INVALID, UpdateBusca } from './validation'

const SEARCH_URL = 'https://lista.mercadolivre.com.br/ssd-nvme-1tb'
const PRODUCT_URL = 'https://www.mercadolivre.com.br/ssd/p/MLB1'
const messages = (result: { success: false; error: { issues: { message: string }[] } }) => result.error.issues.map((i) => i.message)

describe('CreateBusca', () => {
  it('accepts the minimum and classifies the url', () => {
    expect(CreateBusca.parse({ name: ' Teste ', url: SEARCH_URL })).toEqual({
      name: 'Teste', url: { kind: 'search', url: SEARCH_URL },
    })
    expect(CreateBusca.parse({ name: 'P', url: PRODUCT_URL }).url.kind).toBe('product')
  })

  it('accepts every allowed interval and a boolean enabled', () => {
    for (const hours of RUN_EVERY_HOURS_OPTIONS) {
      expect(CreateBusca.parse({ name: 'a', url: SEARCH_URL, runEveryHours: hours, enabled: false }))
        .toMatchObject({ runEveryHours: hours, enabled: false })
    }
  })

  it.each([
    ['missing name', { url: SEARCH_URL }],
    ['empty name', { name: '', url: SEARCH_URL }],
    ['blank name', { name: '   ', url: SEARCH_URL }],
    ['numeric name', { name: 1, url: SEARCH_URL }],
    ['name over the limit', { name: 'x'.repeat(BUSCA_NAME_MAX + 1), url: SEARCH_URL }],
    ['missing url', { name: 'a' }],
    ['numeric url', { name: 'a', url: 1 }],
    ['unknown key', { name: 'a', url: SEARCH_URL, kind: 'search' }],
    ['interval 0', { name: 'a', url: SEARCH_URL, runEveryHours: 0 }],
    ['interval 2', { name: 'a', url: SEARCH_URL, runEveryHours: 2 }],
    ['interval as text', { name: 'a', url: SEARCH_URL, runEveryHours: '3' }],
    ['interval null', { name: 'a', url: SEARCH_URL, runEveryHours: null }],
    ['enabled as text', { name: 'a', url: SEARCH_URL, enabled: 'true' }],
    ['null body', null],
    ['array body', []],
  ])('rejects %s', (_, body) => expect(CreateBusca.safeParse(body).success).toBe(false))

  it('accepts a name of exactly the limit', () => {
    expect(CreateBusca.safeParse({ name: 'x'.repeat(BUSCA_NAME_MAX), url: SEARCH_URL }).success).toBe(true)
  })

  it.each(['https://evil.com/x', 'http://lista.mercadolivre.com.br/x', 'https://www.mercadolivre.com.br/cupons'])(
    'rejects url %j with INVALID_ML_URL',
    (url) => {
      const result = CreateBusca.safeParse({ name: 'a', url })
      expect(result.success).toBe(false)
      if (!result.success) expect(messages(result)).toEqual([INVALID_ML_URL])
    },
  )

  it('turns a typed term into a search url and rejects an empty term', () => {
    expect(CreateBusca.parse({ name: 'a', url: 'Fone Bluetooth' }).url)
      .toEqual({ kind: 'search', url: 'https://lista.mercadolivre.com.br/fone-bluetooth' })
    const result = CreateBusca.safeParse({ name: 'a', url: '  ' })
    expect(result.success).toBe(false)
    if (!result.success) expect(messages(result)).toEqual([EMPTY_SEARCH_TEXT])
  })

  it('names the allowed intervals in the interval error', () => {
    const result = CreateBusca.safeParse({ name: 'a', url: SEARCH_URL, runEveryHours: 5 })
    if (!result.success) expect(messages(result)).toEqual([RUN_EVERY_HOURS_INVALID])
  })
})

describe('UpdateBusca', () => {
  it.each([
    { name: 'a' }, { url: SEARCH_URL }, { runEveryHours: 6 }, { enabled: false },
  ])('accepts the single field %j', (body) => expect(UpdateBusca.safeParse(body).success).toBe(true))

  it('rejects an empty patch and one holding only undefined', () => {
    const result = UpdateBusca.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) expect(messages(result)).toEqual([PATCH_EMPTY])
    expect(UpdateBusca.safeParse({ name: undefined }).success).toBe(false)
  })

  it.each([{ name: '' }, { url: 'nope' }, { runEveryHours: 7 }, { enabled: 1 }, { id: 'x', name: 'a' }, null])(
    'rejects %j', (body) => expect(UpdateBusca.safeParse(body).success).toBe(false),
  )
})
