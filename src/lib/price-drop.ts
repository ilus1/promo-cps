import { MIN_DROP_RATIO, REALERT_MIN_DROP_CENTS } from './constants'

export const BASIS_POINTS = 10_000

export function keepBasisPoints(minDropRatio: number): number {
  return BASIS_POINTS - Math.round(minDropRatio * BASIS_POINTS)
}

export const REALERT_KEEP_BASIS_POINTS = keepBasisPoints(MIN_DROP_RATIO)

export function isMeaningfulDrop(priceCents: number, referenceCents: number): boolean {
  return priceCents * BASIS_POINTS <= referenceCents * REALERT_KEEP_BASIS_POINTS
    && priceCents <= referenceCents - REALERT_MIN_DROP_CENTS
}
