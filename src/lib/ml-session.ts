export const PAGE_OUTCOMES = ['ok', 'session_expired', 'blocked'] as const
export type PageOutcome = (typeof PAGE_OUTCOMES)[number]

export const BLOCKED_STATUSES = [403, 429]

const LOGIN_PATH = /^\/login(?:\/|$)/
const BLOCK_PATHS = [/^\/gz\/account-verification(?:\/|$)/, /^\/captcha(?:\/|$)/]

export function classifyLocation(url: string): PageOutcome {
  const path = new URL(url).pathname
  if (LOGIN_PATH.test(path)) return 'session_expired'
  if (BLOCK_PATHS.some((re) => re.test(path))) return 'blocked'
  return 'ok'
}
