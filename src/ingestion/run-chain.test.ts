import { expect, test } from 'vitest'
import { chainIdle, serialized } from './run-chain'

test('idle with nothing queued', () => {
  expect(chainIdle()).toBe(true)
})

test('busy from the moment of queueing until the work settles', async () => {
  let finish: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { finish = resolve })
  const first = serialized(() => gate)
  const second = serialized(async () => 'second')
  expect(chainIdle()).toBe(false)
  finish()
  await first
  await second
  await Promise.resolve()
  expect(chainIdle()).toBe(true)
})

test('idle again after work that throws, and the chain keeps going', async () => {
  const failed = serialized(async () => { throw new Error('boom') })
  await expect(failed).rejects.toThrow('boom')
  await expect(serialized(async () => 'next')).resolves.toBe('next')
  await Promise.resolve()
  expect(chainIdle()).toBe(true)
})
