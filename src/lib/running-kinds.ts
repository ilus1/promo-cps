import type { RunKind } from './domain'

export type RunningKinds = Map<RunKind, number>

export function enterKind(running: RunningKinds, kind: RunKind): void {
  running.set(kind, (running.get(kind) ?? 0) + 1)
}

export function leaveKind(running: RunningKinds, kind: RunKind): void {
  const left = (running.get(kind) ?? 0) - 1
  if (left > 0) running.set(kind, left)
  else running.delete(kind)
}

export function activeKinds(running: RunningKinds): Set<RunKind> {
  return new Set(running.keys())
}
