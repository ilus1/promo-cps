import { describe, expect, it, vi } from 'vitest'
import {
  digestsOf, DIGEST_SAMPLE_COUNT, sessionAlertFor, titleName, TITLE_NAME_MAX_CHARS, viewHref,
  type AlertHit,
} from './alert-digest'

const BASE = 'http://127.0.0.1:8510'
const hit = (id: string): AlertHit => ({ id, title: `Item ${id}`, priceCents: 1000, mlDiscountPct: 10, dropRatio: null })

describe('titleName', () => {
  it('keeps a short name and caps a long one with an ellipsis within the limit', () => {
    expect(titleName('notebooks')).toBe('notebooks')
    const capped = titleName('x'.repeat(TITLE_NAME_MAX_CHARS * 2))
    expect(capped).toHaveLength(TITLE_NAME_MAX_CHARS)
    expect(capped.endsWith('...')).toBe(true)
  })
})

describe('viewHref', () => {
  it('joins the base url, the offers route and the stored query, always with offers only', () => {
    expect(viewHref(BASE, 'busca=b1&queda=1')).toBe(`${BASE}/?busca=b1&queda=1&ofertas=1`)
    expect(viewHref(BASE, '')).toBe(`${BASE}/?ofertas=1`)
    expect(viewHref('', 'q=fone')).toBe('/?q=fone&ofertas=1')
  })
})

describe('digestsOf', () => {
  const a = { name: 'A', query: 'cupom=1' }
  const b = { name: 'B', query: '' }

  it('counts every hit, samples the first few, builds the url', () => {
    const hits = ['1', '2', '3', '4', '5'].map(hit)
    expect(digestsOf([{ alert: a, hits }], BASE)).toEqual([{
      alertName: 'A', count: 5, samples: hits.slice(0, DIGEST_SAMPLE_COUNT), url: `${BASE}/?cupom=1&ofertas=1`,
    }])
  })

  it('no alerts or no hits: no digests', () => {
    expect(digestsOf([], BASE)).toEqual([])
    expect(digestsOf([{ alert: a, hits: [] }], BASE)).toEqual([])
  })

  it('an item is announced once, under the first alert, and a digest left empty is skipped', () => {
    const result = digestsOf([
      { alert: a, hits: [hit('1'), hit('2')] },
      { alert: b, hits: [hit('2'), hit('3')] },
      { alert: { name: 'C', query: '' }, hits: [hit('1'), hit('3')] },
    ], BASE)
    expect(result.map((d) => [d.alertName, d.count, d.samples.map((s) => s.title)])).toEqual([
      ['A', 2, ['Item 1', 'Item 2']],
      ['B', 1, ['Item 3']],
    ])
  })

  it('caps the alert name in the title', () => {
    const [digest] = digestsOf([{ alert: { name: 'n'.repeat(200), query: '' }, hits: [hit('1')] }], BASE)
    expect(digest.alertName).toHaveLength(TITLE_NAME_MAX_CHARS)
  })
})

describe('sessionAlertFor', () => {
  const run = (status: string | null) => ({ kind: 'cycle' as const, status: status as never, error: 'x', startedAt: new Date(0) })
  const previously = (status: string | null) => vi.fn(async () => status as never)

  it('notifies a problem the previous run did not have, including a first run', async () => {
    expect((await sessionAlertFor(run('blocked'), previously('ok'), BASE))?.title).toBe('Promo CPS: acesso bloqueado pelo Mercado Livre')
    expect(await sessionAlertFor(run('session_expired'), previously(null), BASE)).not.toBeNull()
    expect((await sessionAlertFor(run('failed'), previously('blocked'), BASE))?.title).toBe('Promo CPS: o ciclo falhou')
  })

  it('stays quiet when the problem repeats', async () => {
    expect(await sessionAlertFor(run('blocked'), previously('blocked'), BASE)).toBeNull()
  })

  it('healthy runs never look up the previous run', async () => {
    const load = previously('blocked')
    expect(await sessionAlertFor(run('ok'), load, BASE)).toBeNull()
    expect(await sessionAlertFor(run('partial'), load, BASE)).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('looks the previous run up before the current one started', async () => {
    const load = previously('ok')
    await sessionAlertFor(run('blocked'), load, BASE)
    expect(load).toHaveBeenCalledWith('cycle', new Date(0))
  })
})
