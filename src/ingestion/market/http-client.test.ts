import { afterEach, expect, test, vi } from 'vitest'
import { MARKET_ACCEPT_LANGUAGE, MARKET_FETCH_TIMEOUT_MS, MARKET_USER_AGENT } from '@/lib/constants'
import { fetchMarketPage } from './http-client'

const URL = 'https://www.kabum.com.br/audio?page_number=1&page_size=60'

afterEach(() => {
  vi.useRealTimers()
})

test('a page is fetched with the market headers, following redirects, and its body returned', async () => {
  const fetchImpl = vi.fn(async () => new Response('<html>ok</html>', { status: 200 }))
  expect(await fetchMarketPage(URL, fetchImpl)).toEqual({ status: 200, html: '<html>ok</html>' })
  expect(fetchImpl).toHaveBeenCalledWith(URL, expect.objectContaining({
    headers: { 'User-Agent': MARKET_USER_AGENT, 'Accept-Language': MARKET_ACCEPT_LANGUAGE },
    redirect: 'follow',
  }))
})

test('an error status gives the status with no body', async () => {
  const fetchImpl = vi.fn(async () => new Response('<html>blocked</html>', { status: 403 }))
  expect(await fetchMarketPage(URL, fetchImpl)).toEqual({ status: 403, html: '' })
})

test('a network error gives status 0 and the cause', async () => {
  const failure = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' }) })
  const fetchImpl = vi.fn(async () => {
    throw failure
  })
  expect(await fetchMarketPage(URL, fetchImpl)).toEqual({ status: 0, html: '', reason: 'connect ECONNREFUSED 1.2.3.4:443 (ECONNREFUSED)' })
})

test('a request that takes longer than the timeout is aborted', async () => {
  vi.useFakeTimers()
  const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
  }))
  const pending = fetchMarketPage(URL, fetchImpl as typeof fetch)
  await vi.advanceTimersByTimeAsync(MARKET_FETCH_TIMEOUT_MS)
  expect(await pending).toEqual({ status: 0, html: '', reason: 'tempo esgotado' })
})
