import { expect, test } from 'vitest'
import { bulkSeenLabels, BULK_SEEN_CONSEQUENCE_TEXT, markedText, narrowsList } from './bulk-seen-view'
import { dealFiltersFromParams } from './deal-query'

test('filtered: the button, the confirmation and the confirm action carry the count', () => {
  const labels = bulkSeenLabels(48, 1500, true)
  expect(labels.filtered).toBe('Marcar os 1.500 filtrados como vistos')
  expect(labels.confirm).toBe(`Marcar 1.500 itens como vistos? ${BULK_SEEN_CONSEQUENCE_TEXT}`)
  expect(labels.confirmAction).toBe('Marcar os 1.500')
})

test('unfiltered: everything in Novos is named', () => {
  const labels = bulkSeenLabels(48, 1500, false)
  expect(labels.filtered).toBe('Marcar todos os 1.500 de Novos como vistos')
  expect(labels.confirm).toBe(`Marcar todos os 1.500 itens de Novos como vistos? ${BULK_SEEN_CONSEQUENCE_TEXT}`)
  expect(labels.confirmAction).toBe('Marcar os 1.500')
})

test('one item is singular', () => {
  const labels = bulkSeenLabels(0, 1, true)
  expect(labels.confirm).toBe(`Marcar 1 item como visto? ${BULK_SEEN_CONSEQUENCE_TEXT}`)
  expect(labels.confirmAction).toBe('Marcar 1')
})

test('the filtered button is absent when the page already holds every match', () => {
  expect(bulkSeenLabels(10, 10, true).filtered).toBeNull()
  expect(bulkSeenLabels(10, 10, false).filtered).toBeNull()
  expect(bulkSeenLabels(10, 11, false).filtered).not.toBeNull()
})

test('only a filter that narrows the list counts as a filter; antigos and sort do not', () => {
  expect(narrowsList(dealFiltersFromParams({}))).toBe(false)
  expect(narrowsList(dealFiltersFromParams({ antigos: '1' }))).toBe(false)
  expect(narrowsList(dealFiltersFromParams({ sort: 'preco' }))).toBe(false)
  expect(narrowsList(dealFiltersFromParams({ antigos: '1', q: 'fone' }))).toBe(true)
  expect(narrowsList(dealFiltersFromParams({ ofertas: '1' }))).toBe(true)
})

test('the result text agrees in number', () => {
  expect(markedText(1)).toBe('1 marcado como visto')
  expect(markedText(1200)).toBe('1.200 marcados como vistos')
})

test('inflados widens the list like antigos: it does not make the bulk mark a filtered one', () => {
  expect(narrowsList(dealFiltersFromParams({ inflados: '1' }))).toBe(false)
  expect(narrowsList(dealFiltersFromParams({ inflados: '1', q: 'fone' }))).toBe(true)
})

test('verificados narrows the list like any filter', () => {
  expect(narrowsList(dealFiltersFromParams({ verificados: '1' }))).toBe(true)
})
