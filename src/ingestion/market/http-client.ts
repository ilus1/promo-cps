import { MARKET_ACCEPT_LANGUAGE, MARKET_FETCH_TIMEOUT_MS, MARKET_USER_AGENT } from '@/lib/constants'
import { errorText } from '../errors'
import type { FetchedPage } from './fetched-page'

const HEADERS = { 'User-Agent': MARKET_USER_AGENT, 'Accept-Language': MARKET_ACCEPT_LANGUAGE }
const NO_RESPONSE_STATUS = 0
const TIMED_OUT = 'tempo esgotado'

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined)
}

export async function fetchMarketPage(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchedPage> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MARKET_FETCH_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal })
    if (!res.ok) {
      await discard(res)
      return { status: res.status, html: '' }
    }
    return { status: res.status, html: await res.text() }
  } catch (e) {
    return { status: NO_RESPONSE_STATUS, html: '', reason: controller.signal.aborted ? TIMED_OUT : errorText(e) }
  } finally {
    clearTimeout(timer)
  }
}
