export type EnvMap = Record<string, string | undefined>

export function withoutKeys(source: EnvMap, keys: readonly string[]): EnvMap {
  const hidden = new Set(keys)
  return Object.fromEntries(Object.entries(source).filter(([key]) => !hidden.has(key)))
}
