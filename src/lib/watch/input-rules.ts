import { parseProductLink } from './links'

export const WATCH_NAME_MAX = 200
export const WATCH_INPUT_MAX = 2000
export const WATCH_DROP_MIN = 1
export const WATCH_DROP_MAX = 90
export const URL_LIKE = /:\/\/|^www\./i
export const UNKNOWN_LINK_TEXT = 'Link não reconhecido: use um link de produto do Mercado Livre, Amazon, Kabum, Americanas ou Buscapé.'
export const NAME_TOO_LONG_TEXT = `O nome pode ter até ${WATCH_NAME_MAX} caracteres.`

export function nameOrLinkIssue(text: string): string | null {
  if (parseProductLink(text)) return null
  if (URL_LIKE.test(text)) return UNKNOWN_LINK_TEXT
  return text.length > WATCH_NAME_MAX ? NAME_TOO_LONG_TEXT : null
}
