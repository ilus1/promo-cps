import { beforeEach, expect, test } from 'vitest'
import { queueAnnounce } from './announce-queue'

beforeEach(() => {
  globalThis.__promoAfterRunTail = undefined
})

const settle = () => globalThis.__promoAfterRunTail as Promise<void>

test('jobs run one at a time, in order', async () => {
  const seen: string[] = []
  queueAnnounce(async () => {
    seen.push('a start')
    await new Promise((resolve) => setTimeout(resolve, 10))
    seen.push('a end')
  })
  queueAnnounce(async () => { seen.push('b') })
  await settle()
  await settle()
  expect(seen).toEqual(['a start', 'a end', 'b'])
})

test('a job that throws does not block the next', async () => {
  const ran: string[] = []
  queueAnnounce(async () => { throw new Error('boom') })
  queueAnnounce(async () => { ran.push('second') })
  await settle()
  await settle()
  expect(ran).toEqual(['second'])
})
