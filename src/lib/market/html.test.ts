import { describe, expect, it } from 'vitest'
import { amountCentsOf, markerText, textOf } from './html'

describe('textOf', () => {
  it('drops tags, decodes entities and collapses spaces', () => {
    expect(textOf('<h2><span>Fone&nbsp;JBL</span>\n<b>Tune</b> &amp; 6.7&quot; &#233;&#x41;</span></h2>')).toBe('Fone JBL Tune & 6.7" éA')
  })
  it('keeps unknown entities as they are', () => {
    expect(textOf('a &bogus; b')).toBe('a &bogus; b')
  })
})

describe('amountCentsOf', () => {
  it('reads a pt-BR amount after R$', () => {
    expect(amountCentsOf('R$ 1.311,98')).toBe(131_198)
    expect(amountCentsOf('R$ 18,9')).toBe(1890)
    expect(amountCentsOf('R$ 5.949')).toBe(594_900)
  })
  it('gives null without an amount', () => {
    expect(amountCentsOf('Ver opções de compra')).toBeNull()
  })
})

describe('markerText', () => {
  it('lowercases the page without scripts and styles', () => {
    expect(markerText('<title>Algo  Deu</title><script>x = "captcha"</script><style>.a{}</style>&amp;')).toBe('<title>algo deu</title> &')
  })
})
