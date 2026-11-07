import {
  SCHEDULER_BOOT_GRACE_MS, SCHEDULER_CHECK_MS, SECOND_MS, SCHEDULER_PLAN_RETRY_MS,
} from '@/lib/constants'
import { PLAN_FAILED_TEXT } from '@/lib/domain'
import { env } from '@/env'
import { orphanCutoff } from './cycle-rules'
import { holdAction } from './hold-rules'
import { chainIdle } from './run-chain'
import {
  canTick, cycleDueAt, cycleIsDue, heldNextRun, latestHold, schedulerPlan, stopHold, wakeDelay, type SchedulerInputs, type SchedulerPlan,
} from './schedule'
import { schedulerInputs } from './scheduler-inputs'
import { slotJitterMs } from './slot-jitter'

const LOG_TAG = '[auto-run]'

export type AutoRunStatus = SchedulerPlan & { enabled: boolean; running: boolean }

interface SchedulerState extends SchedulerPlan {
  ticking: boolean
  bootHoldMs: number
  lastTickEndedAtMs: number | null
  timer: NodeJS.Timeout | undefined
}

interface SchedulerHandle {
  state: SchedulerState
  replan: () => void
  stop: () => void
}

declare global {
  var __promoAutoRun: SchedulerHandle | undefined
}

const DISABLED_STATUS: AutoRunStatus = {
  enabled: false, running: false, nextRunAt: null, cycleNextRunAt: null, pause: null,
}

export function autoRunStatus(): AutoRunStatus {
  const handle = globalThis.__promoAutoRun
  if (!handle) return DISABLED_STATUS
  const { nextRunAt, cycleNextRunAt, pause, ticking } = handle.state
  return { enabled: true, running: ticking, nextRunAt, cycleNextRunAt, pause }
}

export function replanAutoRun(): void {
  globalThis.__promoAutoRun?.replan()
}

async function loadInputs(): Promise<SchedulerInputs> {
  const runs = await import('@/db/runs')
  const [lastCycle, workedCycle, login, accountWorked, expired, held] = await Promise.all([
    runs.lastRun('cycle'),
    runs.lastWorkedCycleRun(),
    runs.lastStatusRun('login'),
    runs.lastWorkedAccountRun(),
    runs.lastExpiredAccountRun(),
    runs.lastHeldAccountRun(),
  ])
  return schedulerInputs({ lastCycle, workedCycle, login, accountWorked, expired, held })
}

async function sweepOrphanRuns(): Promise<void> {
  try {
    const { failOrphanRuns } = await import('@/db/runs')
    const now = new Date()
    const processStartedAt = new Date(now.getTime() - process.uptime() * SECOND_MS)
    const failed = await failOrphanRuns(orphanCutoff(now, processStartedAt, chainIdle()), now)
    if (failed > 0) console.log(LOG_TAG, `${failed} orphan run(s) marked failed`)
  } catch (e) {
    console.error(LOG_TAG, 'orphan sweep failed', e instanceof Error ? e.message : e)
  }
}

export function startAutoRunScheduler(): void {
  globalThis.__promoAutoRun?.stop()
  globalThis.__promoAutoRun = undefined
  if (env().AUTO_RUN === 'off') {
    console.log(LOG_TAG, 'scheduler disabled (AUTO_RUN=off)')
    return
  }

  const state: SchedulerState = {
    nextRunAt: null,
    cycleNextRunAt: null,
    pause: null,
    ticking: false,
    bootHoldMs: Date.now() + SCHEDULER_BOOT_GRACE_MS,
    lastTickEndedAtMs: null,
    timer: undefined,
  }
  let generation = 0
  let heldLogged = false
  const alive = () => globalThis.__promoAutoRun === handle

  const arm = (delayMs: number, fire: () => Promise<void> = wake) => {
    clearTimeout(state.timer)
    state.timer = alive() ? setTimeout(() => void fire(), delayMs) : undefined
    state.timer?.unref()
  }

  const compute = (inputs: SchedulerInputs): SchedulerPlan => {
    const everyHours = env().RUN_EVERY_HOURS
    const jitterMs = slotJitterMs(inputs.lastCycleStartedAt, everyHours)
    const raw = schedulerPlan(inputs, everyHours, jitterMs)
    if (raw.pause !== null) return raw
    const hold = latestHold(state.bootHoldMs, stopHold(inputs.latestHeld, inputs.latestAccountWorked, everyHours))
    const due = cycleDueAt(inputs.lastCycleStartedAt, everyHours, jitterMs, inputs.lastCycleFinishedAt)
    const next = heldNextRun([due], state.lastTickEndedAtMs, hold)
    return { pause: null, nextRunAt: next, cycleNextRunAt: next }
  }

  const rearm = () => {
    if (state.ticking || !alive()) return
    if (state.nextRunAt) arm(wakeDelay(state.nextRunAt, new Date()))
    else clearTimeout(state.timer)
  }

  const plan = async () => {
    const mine = ++generation
    try {
      const next = compute(await loadInputs())
      if (!alive() || mine !== generation) return
      state.nextRunAt = next.nextRunAt
      state.cycleNextRunAt = next.cycleNextRunAt
      state.pause = next.pause
      console.log(LOG_TAG, next.pause ?? `next run ${next.nextRunAt?.toISOString() ?? 'none'}`)
      rearm()
    } catch (e) {
      if (!alive() || mine !== generation) return
      console.error(LOG_TAG, 'planning failed', e instanceof Error ? e.message : e)
      state.nextRunAt = null
      state.cycleNextRunAt = null
      state.pause = PLAN_FAILED_TEXT
      if (!state.ticking) arm(SCHEDULER_PLAN_RETRY_MS, plan)
    }
  }

  const tick = async () => {
    state.ticking = true
    let skipped = false
    try {
      const { requestCycle } = await import('./cycle')
      const inputs = await loadInputs()
      const everyHours = env().RUN_EVERY_HOURS
      const now = new Date()
      const jitterMs = slotJitterMs(inputs.lastCycleStartedAt, everyHours)
      const due = cycleIsDue(now, inputs.lastCycleStartedAt, everyHours, jitterMs, inputs.lastCycleFinishedAt)
      if (!due || !canTick(compute(inputs).nextRunAt, now, chainIdle())) {
        skipped = true
        return
      }
      console.log(LOG_TAG, 'starting cycle')
      await requestCycle()
    } catch (e) {
      console.error(LOG_TAG, 'tick failed', e instanceof Error ? e.message : e)
    } finally {
      state.ticking = false
      if (!skipped) state.lastTickEndedAtMs = Date.now()
      await plan()
    }
  }

  const wake = async () => {
    if (!alive() || state.ticking) return
    if (!chainIdle()) {
      arm(SCHEDULER_CHECK_MS)
      return
    }
    if (!canTick(state.nextRunAt, new Date(), true)) {
      rearm()
      return
    }
    const { mlRequestHold } = await import('./request-hold')
    const action = holdAction(await mlRequestHold(new Date()))
    if (action.kind === 'wait') {
      if (!heldLogged) console.log(LOG_TAG, `held (${action.hold.reason}), rechecking every ${action.ms / SECOND_MS} s`)
      heldLogged = true
      arm(action.ms)
      return
    }
    if (heldLogged) console.log(LOG_TAG, 'hold lifted')
    heldLogged = false
    await tick()
  }

  const handle: SchedulerHandle = {
    state,
    replan: () => void plan(),
    stop: () => {
      clearTimeout(state.timer)
      state.timer = undefined
    },
  }
  globalThis.__promoAutoRun = handle
  void sweepOrphanRuns().then(plan)
  console.log(LOG_TAG, 'scheduler started')
}
