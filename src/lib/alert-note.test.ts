import { describe, expect, it } from 'vitest'
import { alertFormNotes, alertScopeNote } from './alert-note'
import { ALERT_SORT_NOTE } from './labels'

describe('alertScopeNote', () => {
  it('says the alert covers every offer when no filter narrows the view', () => {
    expect(alertScopeNote(false, 1203)).toBe('Este alerta cobre todas as 1.203 ofertas de Novos e Salvos.')
    expect(alertScopeNote(false, 1)).toBe('Este alerta cobre a única oferta de Novos e Salvos.')
    expect(alertScopeNote(false, 0)).toBe('Este alerta cobre todas as 0 ofertas de Novos e Salvos.')
  })

  it('is silent when a filter narrows the view', () => {
    expect(alertScopeNote(true, 1203)).toBeNull()
  })
})

describe('alertFormNotes', () => {
  it('always says the sort is not saved, and adds the scope note when nothing narrows', () => {
    expect(alertFormNotes(true, 5)).toEqual([ALERT_SORT_NOTE])
    expect(alertFormNotes(false, 5)).toEqual(['Este alerta cobre todas as 5 ofertas de Novos e Salvos.', ALERT_SORT_NOTE])
  })
})
