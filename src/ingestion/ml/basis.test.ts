import { describe, expect, it } from 'vitest'
import { basisFromComplement } from './basis'

describe('basisFromComplement', () => {
  it.each([
    [undefined, 'none'], ['', 'none'], ['  ', 'none'],
    ['com Cupom', 'coupon'], ['no Pix', 'pix'], ['no Pix com Cupom', 'pix_coupon'],
    ['no PIX', 'pix'], ['no Pix com Cupom de desconto', 'pix_coupon'], ['pixel', 'other'],
    ['em 10x', 'other'],
  ])('%s -> %s', (text, basis) => expect(basisFromComplement(text)).toBe(basis))
})
