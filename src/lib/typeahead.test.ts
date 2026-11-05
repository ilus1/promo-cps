import { describe, expect, it } from 'vitest'
import { typeaheadChoices, typeaheadSummary } from './typeahead'

const options = [
  { value: 'MLB-NOTEBOOKS', label: 'Notebooks' },
  { value: 'MLB-HARD_DRIVES_AND_SSDS', label: 'Hard drives and ssds' },
  { value: 'MLB-CAMERAS', label: 'Câmeras' },
  { value: 'MLB-HEADPHONES', label: 'Headphones' },
  { value: 'MLB-N2', label: 'Item 2 notebooks' },
]
const values = (list: { value: string }[]) => list.map((o) => o.value)

describe('typeaheadChoices', () => {
  it('shows everything in order for an empty or blank term, up to the limit', () => {
    expect(values(typeaheadChoices(options, '', 3).shown)).toEqual(['MLB-NOTEBOOKS', 'MLB-HARD_DRIVES_AND_SSDS', 'MLB-CAMERAS'])
    expect(typeaheadChoices(options, '   ', 3).hidden).toBe(2)
    expect(typeaheadChoices(options, '', 10).hidden).toBe(0)
  })

  it('matches the label ignoring case and accents, every word in any order', () => {
    expect(values(typeaheadChoices(options, 'CAMERA', 10).matches)).toEqual(['MLB-CAMERAS'])
    expect(values(typeaheadChoices(options, 'ssds hard', 10).matches)).toEqual(['MLB-HARD_DRIVES_AND_SSDS'])
    expect(values(typeaheadChoices(options, 'note', 10).matches)).toEqual(['MLB-NOTEBOOKS', 'MLB-N2'])
  })

  it('matches the label only, never the value or a count', () => {
    expect(typeaheadChoices(options, 'MLB', 10).matches).toEqual([])
    expect(typeaheadChoices([{ value: 'x', label: 'Notebooks (12)' }], '12', 10).matches).toHaveLength(1)
    expect(typeaheadChoices([{ value: 'x', label: 'Notebooks' }], '12', 10).matches).toEqual([])
  })

  it('pins the selected value first only when there is no term', () => {
    expect(values(typeaheadChoices(options, '', 10, 'MLB-N2').shown)[0]).toBe('MLB-N2')
    expect(values(typeaheadChoices(options, '  ', 10, 'MLB-N2').shown)[0]).toBe('MLB-N2')
  })

  it('with a term the first visible row is the first match, which is what Enter picks', () => {
    const result = typeaheadChoices(options, 'note', 10, 'MLB-N2')
    expect(values(result.shown)).toEqual(['MLB-NOTEBOOKS', 'MLB-N2'])
    expect(result.shown[0]).toBe(result.matches[0])
  })

  it('does not add a selected value that the term filtered out', () => {
    expect(values(typeaheadChoices(options, 'camera', 10, 'MLB-NOTEBOOKS').shown)).toEqual(['MLB-CAMERAS'])
  })

  it('counts what the limit hides', () => {
    const result = typeaheadChoices(options, 'note', 1)
    expect(result.shown).toHaveLength(1)
    expect(result.hidden).toBe(1)
  })
})

describe('typeaheadSummary', () => {
  it('says what is shown, with thousands separators', () => {
    expect(typeaheadSummary(typeaheadChoices([], 'x', 5))).toBe('Nenhum resultado.')
    expect(typeaheadSummary(typeaheadChoices(options.slice(0, 1), '', 5))).toBe('1 resultado.')
    expect(typeaheadSummary(typeaheadChoices(options, '', 5))).toBe('5 resultados.')
    const many = Array.from({ length: 2615 }, (_, i) => ({ value: String(i), label: `Tipo ${i}` }))
    expect(typeaheadSummary(typeaheadChoices(many, '', 100))).toBe('Mostrando 100 de 2.615. Digite para filtrar.')
  })
})
