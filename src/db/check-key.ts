import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { CHECK_KEY_ITEM_PREFIX } from '../lib/price-check-rules'

const QUOTE = "'"
const ITEM_PREFIX_LITERAL = sql.raw(`${QUOTE}${CHECK_KEY_ITEM_PREFIX.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}`)

export function checkKeyOf(productId: SQLWrapper, id: SQLWrapper): SQL<string> {
  return sql<string>`coalesce(${productId}, ${ITEM_PREFIX_LITERAL} || ${id})`
}
