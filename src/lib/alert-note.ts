import { ALERT_STATUSES } from './domain'
import { formatCount } from './format'
import { ALERT_SORT_NOTE, ITEM_TAB_LABEL } from './labels'

const ALERT_TABS_TEXT = ALERT_STATUSES.map((status) => ITEM_TAB_LABEL[status]).join(' e ')

export function alertScopeNote(narrows: boolean, offers: number): string | null {
  if (narrows) return null
  return offers === 1
    ? `Este alerta cobre a única oferta de ${ALERT_TABS_TEXT}.`
    : `Este alerta cobre todas as ${formatCount(offers)} ofertas de ${ALERT_TABS_TEXT}.`
}

export function alertFormNotes(narrows: boolean, offers: number): string[] {
  return [alertScopeNote(narrows, offers), ALERT_SORT_NOTE].filter((note): note is string => note !== null)
}
