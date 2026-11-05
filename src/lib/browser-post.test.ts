import { describe, expect, it } from 'vitest'
import { ConfirmRequest, rejectUnlessBrowser, SEC_FETCH_SITE } from './browser-post'

const post = (headers: Record<string, string>) => new Request('http://127.0.0.1:8510/api/x', { method: 'POST', headers })

describe('rejectUnlessBrowser', () => {
  it('lets a same-origin browser request through', () => {
    expect(rejectUnlessBrowser(post({ [SEC_FETCH_SITE]: 'same-origin' }))).toBeNull()
  })

  it.each([[{}], [{ [SEC_FETCH_SITE]: 'cross-site' }], [{ [SEC_FETCH_SITE]: 'none' }]])('rejects %j with browser_only', async (headers) => {
    const res = rejectUnlessBrowser(post(headers))
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'browser_only' })
  })
})

describe('ConfirmRequest', () => {
  it('accepts only confirm: true', () => {
    expect(ConfirmRequest.safeParse({ confirm: true }).success).toBe(true)
    expect(ConfirmRequest.safeParse({ confirm: false }).success).toBe(false)
    expect(ConfirmRequest.safeParse({}).success).toBe(false)
    expect(ConfirmRequest.safeParse(null).success).toBe(false)
  })
})
