import { expect, test } from 'vitest'
import { activeKinds, enterKind, leaveKind, type RunningKinds } from './running-kinds'

test('a kind is active between enter and leave', () => {
  const running: RunningKinds = new Map()
  expect([...activeKinds(running)]).toEqual([])
  enterKind(running, 'search')
  expect([...activeKinds(running)]).toEqual(['search'])
  leaveKind(running, 'search')
  expect([...activeKinds(running)]).toEqual([])
})

test('overlapping runs of one kind keep it active until the last one leaves', () => {
  const running: RunningKinds = new Map()
  enterKind(running, 'search')
  enterKind(running, 'search')
  leaveKind(running, 'search')
  expect(activeKinds(running).has('search')).toBe(true)
  leaveKind(running, 'search')
  expect(activeKinds(running).has('search')).toBe(false)
})

test('different kinds do not clear each other', () => {
  const running: RunningKinds = new Map()
  enterKind(running, 'cycle')
  enterKind(running, 'search')
  leaveKind(running, 'search')
  expect([...activeKinds(running)]).toEqual(['cycle'])
})

test('leaving a kind that never entered is harmless', () => {
  const running: RunningKinds = new Map()
  leaveKind(running, 'login')
  expect(running.size).toBe(0)
})
