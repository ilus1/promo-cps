import { cycleDueAt, jitterOffsetMs, slotRandom } from './schedule'

export function slotJitterMs(lastCycleStartedAt: Date | null, everyHours: number): number {
  if (lastCycleStartedAt === null) return 0
  return jitterOffsetMs(slotRandom(cycleDueAt(lastCycleStartedAt, everyHours).getTime()))
}
