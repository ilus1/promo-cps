import { parseAmountCents } from '@/ingestion/ml/amounts'

const MAX_CODE_POINT = 0x10ffff
const TAGS = /<[^>]+>/g
const SCRIPTS_AND_STYLES = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi
const WHITESPACE_RUNS = /\s+/g
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi
const AMOUNT = /R\$\s*(\d[\d.]*)(?:,(\d{1,2}))?(?![\d.,])/
const HEX_PREFIX = '#x'
const DECIMAL_PREFIX = '#'
const HEX_RADIX = 16
const DECIMAL_RADIX = 10
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  atilde: 'ã', otilde: 'õ', ccedil: 'ç', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à',
}

function decodeEntity(match: string, body: string): string {
  const lower = body.toLowerCase()
  if (!lower.startsWith(DECIMAL_PREFIX)) return NAMED_ENTITIES[lower] ?? match
  const codePoint = lower.startsWith(HEX_PREFIX)
    ? parseInt(lower.slice(HEX_PREFIX.length), HEX_RADIX)
    : parseInt(lower.slice(DECIMAL_PREFIX.length), DECIMAL_RADIX)
  return codePoint <= MAX_CODE_POINT ? String.fromCodePoint(codePoint) : match
}

export function decodeEntities(text: string): string {
  return text.replace(ENTITY, decodeEntity)
}

export function textOf(html: string): string {
  return decodeEntities(html.replace(TAGS, ' ')).replace(WHITESPACE_RUNS, ' ').trim()
}

export function markerText(html: string): string {
  return decodeEntities(html.replace(SCRIPTS_AND_STYLES, ' ')).toLowerCase().replace(WHITESPACE_RUNS, ' ')
}

export function amountCentsOf(text: string): number | null {
  const amount = text.match(AMOUNT)
  return amount ? parseAmountCents(amount[1], amount[2]) : null
}
