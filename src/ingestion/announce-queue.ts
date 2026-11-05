declare global {
  var __promoAfterRunTail: Promise<void> | undefined
}

export function queueAnnounce(job: () => Promise<void>): void {
  const run = (globalThis.__promoAfterRunTail ?? Promise.resolve()).then(job)
  globalThis.__promoAfterRunTail = run.then(() => undefined, () => undefined)
}
