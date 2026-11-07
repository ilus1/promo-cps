import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { candidateConfidence, chooseMatch } from './choose-match'
import { parseAmazonCandidates } from './parse-amazon-product'
import { parseAmericanasSearch } from './parse-americanas'
import { parseKabumSearch } from './parse-kabum-search'
import type { ListingCandidate, SourcePage } from './types'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const NAME = 'Fone de Ouvido JBL Tune 520BT Preto'
const EAN = '6925281963650'
const UPC = '036000291452'
const OTHER_EAN = '6925281939938'
const MEDIUM_TITLE = 'Fone de Ouvido JBL Tune 520BT Preto 40mm'
const UNRELATED_TITLE = 'Fone de Ouvido Sony WH-CH520 Preto'
const NOW = new Date('2026-11-06T12:00:00Z')
const BY_EAN = { searchedByEan: true }
const BY_TEXT = { searchedByEan: false }

let nextRef = 0

function candidate(over: Partial<ListingCandidate>): ListingCandidate {
  nextRef += 1
  return {
    retailer: 'kabum',
    ref: String(nextRef),
    url: `https://www.kabum.com.br/produto/${nextRef}`,
    title: NAME,
    ean: null,
    merchant: null,
    priceCents: 30_000,
    listPriceCents: null,
    inStock: true,
    ...over,
  }
}

function valueOf(page: SourcePage<ListingCandidate[]>): ListingCandidate[] {
  if (page.kind !== 'ok') throw new Error(page.reason)
  return page.value
}

describe('candidateConfidence', () => {
  it('rates a candidate title against the product name', () => {
    expect(candidateConfidence(NAME, candidate({}))).toBe('high')
    expect(candidateConfidence(NAME, candidate({ title: MEDIUM_TITLE }))).toBe('medium')
    expect(candidateConfidence(NAME, candidate({ title: UNRELATED_TITLE }))).toBeNull()
  })

  it('rejects a candidate of another color', () => {
    expect(candidateConfidence(NAME, candidate({ title: 'Fone de Ouvido JBL Tune 520BT Azul' }))).toBeNull()
    expect(candidateConfidence(NAME, candidate({ title: 'Fone de Ouvido JBL Tune 520BT' }))).toBe('high')
    expect(candidateConfidence('Fone de Ouvido JBL Tune 520BT', candidate({ title: 'Fone de Ouvido JBL Tune 520BT Azul' }))).toBe('high')
  })
})

describe('chooseMatch by barcode', () => {
  it('takes a candidate carrying the same EAN, whatever its title or price', () => {
    const exact = candidate({ title: 'Headset sem nome', ean: EAN, priceCents: 50_000 })
    const cheaper = candidate({ priceCents: 20_000 })
    expect(chooseMatch({ name: NAME, ean: EAN }, [cheaper, exact], BY_TEXT)).toEqual({ candidate: exact, match: 'barcode' })
  })

  it('takes the cheapest in-stock candidate among several with the EAN', () => {
    const outOfStock = candidate({ ean: EAN, priceCents: 10_000, inStock: false })
    const cheapest = candidate({ ean: EAN, priceCents: 30_000 })
    const dearer = candidate({ ean: EAN, priceCents: 40_000 })
    expect(chooseMatch({ name: NAME, ean: EAN }, [dearer, outOfStock, cheapest], BY_TEXT)?.candidate).toBe(cheapest)
  })

  it('takes the cheapest when none is in stock', () => {
    const cheapest = candidate({ ean: EAN, priceCents: 10_000, inStock: false })
    const dearer = candidate({ ean: EAN, priceCents: 30_000, inStock: false })
    expect(chooseMatch({ name: NAME, ean: EAN }, [dearer, cheapest], BY_TEXT)?.candidate).toBe(cheapest)
  })

  it('compares UPC and EAN forms of the same code', () => {
    const exact = candidate({ title: 'Outro', ean: `0${UPC}` })
    expect(chooseMatch({ name: NAME, ean: UPC }, [exact], BY_TEXT)).toEqual({ candidate: exact, match: 'barcode' })
  })

  it('normalizes the product EAN and ignores an invalid one', () => {
    const exact = candidate({ title: 'Outro', ean: EAN })
    expect(chooseMatch({ name: NAME, ean: ' 6925-2819-6365-0 ' }, [exact], BY_TEXT)?.match).toBe('barcode')
    expect(chooseMatch({ name: NAME, ean: '6925281963651' }, [candidate({ title: 'Outro', ean: '6925281963651' })], BY_TEXT)).toBeNull()
  })
})

describe('chooseMatch after a search by EAN', () => {
  it('takes the top candidate when it matches the name at least at medium', () => {
    const top = candidate({ title: MEDIUM_TITLE, priceCents: 40_000 })
    const cheaper = candidate({ priceCents: 20_000 })
    expect(chooseMatch({ name: NAME, ean: EAN }, [top, cheaper], BY_EAN)).toEqual({ candidate: top, match: 'barcode' })
  })

  it('takes a high top candidate as barcode too', () => {
    const top = candidate({})
    expect(chooseMatch({ name: NAME, ean: EAN }, [top], BY_EAN)).toEqual({ candidate: top, match: 'barcode' })
  })

  it('falls back to an automatic match when the top candidate does not match the name', () => {
    const high = candidate({ priceCents: 35_000 })
    expect(chooseMatch({ name: NAME, ean: EAN }, [candidate({ title: UNRELATED_TITLE }), high], BY_EAN)).toEqual({ candidate: high, match: 'auto' })
  })

  it('rejects a top candidate that carries another EAN', () => {
    expect(chooseMatch({ name: NAME, ean: EAN }, [candidate({ ean: OTHER_EAN })], BY_EAN)).toBeNull()
  })

  it('rejects a top candidate of another color', () => {
    expect(chooseMatch({ name: NAME, ean: EAN }, [candidate({ title: 'Fone de Ouvido JBL Tune 520BT Branco 40mm' })], BY_EAN)).toBeNull()
  })

  it('gives nothing for an empty search', () => {
    expect(chooseMatch({ name: NAME, ean: EAN }, [], BY_EAN)).toBeNull()
  })
})

describe('chooseMatch automatically', () => {
  it('does not accept a medium match without an EAN search', () => {
    expect(chooseMatch({ name: NAME, ean: EAN }, [candidate({ title: MEDIUM_TITLE })], BY_TEXT)).toBeNull()
  })

  it('takes the cheapest high match, preferring stock', () => {
    const outOfStock = candidate({ priceCents: 10_000, inStock: false })
    const cheapest = candidate({ priceCents: 25_000 })
    const medium = candidate({ title: MEDIUM_TITLE, priceCents: 5_000 })
    const unrelated = candidate({ title: UNRELATED_TITLE, priceCents: 1_000 })
    expect(chooseMatch({ name: NAME, ean: null }, [outOfStock, medium, unrelated, cheapest, candidate({})], BY_TEXT))
      .toEqual({ candidate: cheapest, match: 'auto' })
  })

  it('skips candidates that carry another EAN', () => {
    const other = candidate({ ean: OTHER_EAN, priceCents: 10_000 })
    const unknown = candidate({ priceCents: 30_000 })
    expect(chooseMatch({ name: NAME, ean: EAN }, [other, unknown], BY_TEXT)?.candidate).toBe(unknown)
    expect(chooseMatch({ name: NAME, ean: null }, [other, unknown], BY_TEXT)?.candidate).toBe(other)
  })

  it('skips another color and prefers the same color over an unstated one', () => {
    const white = candidate({ title: 'Fone de Ouvido JBL Tune 520BT Branco', priceCents: 10_000 })
    const unstated = candidate({ title: 'Fone de Ouvido JBL Tune 520BT', priceCents: 20_000 })
    const black = candidate({ title: 'Fone de Ouvido JBL Tune 520BT - Black', priceCents: 30_000 })
    expect(chooseMatch({ name: NAME, ean: null }, [white, unstated, black], BY_TEXT)?.candidate).toBe(black)
    expect(chooseMatch({ name: NAME, ean: null }, [white, unstated], BY_TEXT)?.candidate).toBe(unstated)
    expect(chooseMatch({ name: NAME, ean: null }, [white], BY_TEXT)).toBeNull()
  })

  it('reads colors in either gender and with accents', () => {
    const name = 'Smartphone Samsung Galaxy A17 128GB Preta'
    const black = candidate({ title: 'Smartphone Samsung Galaxy A17 128GB Preto', priceCents: 90_000 })
    const lilac = candidate({ title: 'Smartphone Samsung Galaxy A17 128GB Lilás', priceCents: 80_000 })
    expect(chooseMatch({ name, ean: null }, [lilac, black], BY_TEXT)?.candidate).toBe(black)
  })

  it('takes the cheapest high match when the name has no color', () => {
    const white = candidate({ title: 'Fone de Ouvido JBL Tune 520BT Branco', priceCents: 10_000 })
    const black = candidate({ title: 'Fone de Ouvido JBL Tune 520BT Preto', priceCents: 30_000 })
    expect(chooseMatch({ name: 'Fone de Ouvido JBL Tune 520BT', ean: null }, [black, white], BY_TEXT)?.candidate).toBe(white)
  })

  it('gives nothing without a high match', () => {
    expect(chooseMatch({ name: NAME, ean: null }, [candidate({ title: UNRELATED_TITLE })], BY_TEXT)).toBeNull()
    expect(chooseMatch({ name: NAME, ean: null }, [], BY_TEXT)).toBeNull()
  })
})

describe('chooseMatch on the probe captures', () => {
  it('finds the black 520BT among the Kabum search results', () => {
    const chosen = chooseMatch({ name: NAME, ean: null }, valueOf(parseKabumSearch(200, fixture('kabum-search.html'), NOW)), BY_TEXT)
    expect(chosen?.match).toBe('auto')
    expect(chosen?.candidate).toMatchObject({ ref: '486547', title: 'Fone De Ouvido JBL Tune 520bt, Bluetooth 5.3, Preto' })
  })

  it('finds the Americanas listing by its EAN', () => {
    const chosen = chooseMatch({ name: NAME, ean: EAN }, valueOf(parseAmericanasSearch(200, fixture('americanas-search.json'))), BY_TEXT)
    expect(chosen).toMatchObject({ match: 'barcode', candidate: { ref: '3738039:3984675' } })
  })

  it('takes the only Amazon result of the EAN search as barcode', () => {
    const chosen = chooseMatch({ name: NAME, ean: EAN }, valueOf(parseAmazonCandidates(200, fixture('amazon-ean-search.html'))), BY_EAN)
    expect(chosen).toMatchObject({ match: 'barcode', candidate: { ref: 'B0C3V5X3QT' } })
  })
})
