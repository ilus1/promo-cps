import { WATCH_ERROR_BACKOFF_MAX_MS, WATCH_ERROR_BACKOFF_MS } from '@/lib/constants'

export function errorBackoffMs(failures: number): number {
  return Math.min(WATCH_ERROR_BACKOFF_MS * 2 ** Math.max(failures - 1, 0), WATCH_ERROR_BACKOFF_MAX_MS)
}
