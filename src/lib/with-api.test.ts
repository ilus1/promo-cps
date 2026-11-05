import { expect, test, vi } from 'vitest'
import { z } from 'zod'
import { withApi } from './with-api'

const { PORT, env } = vi.hoisted(() => {
  const PORT = 8510
  return { PORT, env: vi.fn(() => ({ PORT })) }
})
vi.mock('@/env', () => ({ env }))

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`
const EVIL_ORIGIN = 'https://evil.com'
const API_URL = `${LOCAL_ORIGIN}/api/x`

const post = (origin: string) =>
  new Request(API_URL, { method: 'POST', headers: { origin } })

test('passes a normal Response through unchanged', async () => {
  const handler = withApi<[Request]>(async () => new Response('ok', { status: 201 }))
  const res = await handler(post(LOCAL_ORIGIN))
  expect(res.status).toBe(201)
  expect(await res.text()).toBe('ok')
})

test('ZodError -> 400 invalid_request', async () => {
  const handler = withApi<[Request]>(async () => {
    z.object({ name: z.string() }).parse({})
    return new Response('unreachable')
  })
  const res = await handler(post(LOCAL_ORIGIN))
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: 'invalid_request' })
})

test('other throws -> 500 internal_error', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const handler = withApi<[Request]>(async () => { throw new Error('boom') })
  const res = await handler(post(LOCAL_ORIGIN))
  expect(res.status).toBe(500)
  expect(await res.json()).toMatchObject({ error: 'internal_error' })
})

test('another origin -> 403 forbidden_origin without running the handler', async () => {
  const inner = vi.fn(async () => new Response('ran'))
  const res = await withApi<[Request]>(inner)(post(EVIL_ORIGIN))
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'forbidden_origin' })
  expect(inner).not.toHaveBeenCalled()
})

test('a GET skips the origin check without reading env', async () => {
  env.mockClear()
  const handler = withApi<[Request]>(async () => new Response('ok'))
  const res = await handler(new Request(API_URL, { headers: { origin: EVIL_ORIGIN } }))
  expect(res.status).toBe(200)
  expect(env).not.toHaveBeenCalled()
})
