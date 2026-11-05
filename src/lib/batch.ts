export function lastByKey<T>(rows: readonly T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()]
}

export function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}
