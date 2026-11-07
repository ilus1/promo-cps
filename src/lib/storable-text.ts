const NUL = /\u0000/g

export function storableText(text: string): string {
  return text.toWellFormed().replace(NUL, '')
}

export function storableOptionalText(text: string | null): string | null {
  return text === null ? null : storableText(text)
}

export function storableFields<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' ? storableText(value) : value])) as T
}

export function storableJson<T>(value: T): T {
  if (typeof value === 'string') return storableText(value) as T
  if (Array.isArray(value)) return value.map(storableJson) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [storableText(key), storableJson(entry)])) as T
  }
  return value
}
