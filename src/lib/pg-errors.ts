export const PG_UNIQUE_VIOLATION = '23505'

function codeOf(e: unknown): unknown {
  return typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined
}

export function isUniqueViolation(e: unknown): boolean {
  if (codeOf(e) === PG_UNIQUE_VIOLATION) return true
  return e instanceof Error && codeOf(e.cause) === PG_UNIQUE_VIOLATION
}
