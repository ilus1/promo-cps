import { storableText } from '../storable-text'
import { foldAccents } from '../text-search'

const NON_ALPHANUMERIC = /[^a-z0-9]+/g
const NOTHING = ''

export function merchantKeyOf(name: string): string {
  const folded = foldAccents(storableText(name).trim()).toLowerCase()
  return folded.replace(NON_ALPHANUMERIC, NOTHING) || folded
}
