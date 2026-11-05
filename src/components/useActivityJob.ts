import type { CycleActivity, MlStatus } from '@/lib/domain'
import { useBrowserJob } from './useBrowserJob'

export function useActivityJob(
  initial: CycleActivity,
  fromMlStatus: (status: MlStatus) => CycleActivity,
  request: () => Promise<CycleActivity>,
) {
  return useBrowserJob<CycleActivity>({
    initial,
    isActive: (current) => current.phase !== 'idle',
    changeKey: (current) => current.phase,
    statusError: () => null,
    fromMlStatus,
    request,
  })
}
