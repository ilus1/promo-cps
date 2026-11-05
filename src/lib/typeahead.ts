import { formatCount } from './format'
import { foldAccents, searchWords } from './text-search'

export interface TypeaheadOption {
  value: string
  label: string
}

export interface TypeaheadChoices {
  matches: TypeaheadOption[]
  shown: TypeaheadOption[]
  hidden: number
}

const lowerFolded = (text: string) => foldAccents(text).toLowerCase()

export function typeaheadChoices(
  options: readonly TypeaheadOption[], term: string, limit: number, selected?: string,
): TypeaheadChoices {
  const words = searchWords(term).map((word) => word.toLowerCase())
  const matches = words.length === 0
    ? [...options]
    : options.filter((option) => {
      const label = lowerFolded(option.label)
      return words.every((word) => label.includes(word))
    })
  const pinned = words.length === 0 ? matches.find((option) => option.value === selected) : undefined
  const ordered = pinned ? [pinned, ...matches.filter((option) => option !== pinned)] : matches
  const shown = ordered.slice(0, limit)
  return { matches, shown, hidden: matches.length - shown.length }
}

export function typeaheadSummary({ matches, shown, hidden }: TypeaheadChoices): string {
  if (matches.length === 0) return 'Nenhum resultado.'
  if (hidden > 0) return `Mostrando ${formatCount(shown.length)} de ${formatCount(matches.length)}. Digite para filtrar.`
  return `${formatCount(matches.length)} ${matches.length === 1 ? 'resultado' : 'resultados'}.`
}
