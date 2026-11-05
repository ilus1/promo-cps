import { CENTS_PER_REAL } from '@/lib/constants'
import { isRecord } from '@/lib/records'

const THUMBNAIL_PREFIX = 'https://http2.mlstatic.com/D_Q_NP_2X_'
const THUMBNAIL_SUFFIX = '-E.webp'
const PICTURE_ID = /^[\w-]+$/

export function records<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item): item is T => isRecord(item)) : []
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

export function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value * CENTS_PER_REAL) : null
}

export function thumbnailOf(pictureId: unknown): string | null {
  const id = text(pictureId)
  return id !== null && PICTURE_ID.test(id) ? `${THUMBNAIL_PREFIX}${id}${THUMBNAIL_SUFFIX}` : null
}

export function at(root: unknown, path: readonly string[]): unknown {
  let node = root
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}
