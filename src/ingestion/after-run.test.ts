import { beforeEach, expect, test, vi } from 'vitest'
import type { Run } from '@/db/schema'
import { afterRun } from './after-run'
import { notifyStatus, type AnnounceDeps } from './announce'

vi.mock('@/db/runs', () => ({ previousStatus: vi.fn(async () => null) }))
vi.mock('@/lib/app-url', () => ({ appBaseUrl: () => 'http://x' }))
vi.mock('@/lib/desktop-notify', () => ({ healthNotification: vi.fn(() => null), sendDesktopNotification: vi.fn(), sessionNotification: vi.fn(() => null) }))
vi.mock('./announce', async (original) => ({ ...await original<typeof import('./announce')>(), notifyStatus: vi.fn(async () => undefined) }))

const finished = (id: string) => ({ id, kind: 'cycle', status: 'ok', startedAt: new Date(0) }) as unknown as Run

beforeEach(() => {
  vi.mocked(notifyStatus).mockReset().mockResolvedValue(undefined)
})

test('a finished run sends its session and health notifications', async () => {
  afterRun(finished('a'))
  expect(notifyStatus).toHaveBeenCalledWith(finished('a'), expect.objectContaining({ notify: expect.any(Function) }))
  const deps = vi.mocked(notifyStatus).mock.calls[0][1] as AnnounceDeps
  expect(await deps.sessionAlert(finished('a'))).toBeNull()
  expect(deps.healthAlert(finished('a'))).toBeNull()
})

test('a failing notification is logged and never thrown', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(notifyStatus).mockRejectedValue(new Error('notify down'))
  expect(() => afterRun(finished('b'))).not.toThrow()
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[after-run] failed:', 'notify down'))
  error.mockRestore()
})
