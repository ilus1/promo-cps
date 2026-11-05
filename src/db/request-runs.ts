import { cache } from 'react'
import { lastExpiredAccountRun, lastWorkedCycleRun, lastRun, lastStatusRun } from './runs'

export const accountRuns = cache(async () => {
  const [cycle, finishedCycle, workedCycle, expiredRun, login] = await Promise.all([
    lastRun('cycle'),
    lastStatusRun('cycle'),
    lastWorkedCycleRun(),
    lastExpiredAccountRun(),
    lastStatusRun('login'),
  ])
  return {
    cycle: cycle ?? null,
    finishedCycle: finishedCycle ?? null,
    workedCycle: workedCycle ?? null,
    expiredRun: expiredRun ?? null,
    login: login ?? null,
  }
})
