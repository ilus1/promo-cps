declare global {
  var __promoRunChain: Promise<unknown> | undefined
  var __promoRunPending: number | undefined
}

export function chainIdle(): boolean {
  return (globalThis.__promoRunPending ?? 0) === 0
}

export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  globalThis.__promoRunPending = (globalThis.__promoRunPending ?? 0) + 1
  const release = () => {
    globalThis.__promoRunPending = (globalThis.__promoRunPending ?? 1) - 1
  }
  const run = (globalThis.__promoRunChain ?? Promise.resolve()).then(fn)
  globalThis.__promoRunChain = run.then(release, release)
  return run
}
