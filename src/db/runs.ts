import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { CYCLE_COUNT } from '@/lib/cycle-counts'
import { BLOCKED_STATUS, ORPHAN_RUN_TEXT, SESSION_EXPIRED_STATUS, type RunKind, type RunRowStatus } from '@/lib/domain'
import { db } from './client'
import { runs, type Run } from './schema'

const RECENT_RUNS = 20

export function notHeldByRequestHold(): SQL {
  return sql`coalesce((${runs.counts} ->> ${CYCLE_COUNT.held})::int, 0) <> 1`
}

export const RUN_NOT_STARTED = 'A execução não foi registrada'
export const RUN_NOT_FOUND = 'Execução não encontrada'

export interface RunResult {
  status: RunRowStatus
  pages: number
  counts: Record<string, number>
  error?: string
}

export async function startRun(kind: RunKind): Promise<Run> {
  const [run] = await db.insert(runs).values({ kind, startedAt: new Date() }).returning()
  if (!run) throw new Error(RUN_NOT_STARTED)
  return run
}

export async function finishRun(id: string, result: RunResult): Promise<Run> {
  const [run] = await db.update(runs)
    .set({
      finishedAt: new Date(),
      status: result.status,
      pages: result.pages,
      counts: result.counts,
      error: result.error ?? null,
    })
    .where(eq(runs.id, id))
    .returning()
  if (!run) throw new Error(`${RUN_NOT_FOUND}: ${id}`)
  return run
}

export async function lastRun(kind: RunKind): Promise<Run | undefined> {
  const [run] = await db.select().from(runs).where(and(eq(runs.kind, kind), notHeldByRequestHold())).orderBy(desc(runs.startedAt)).limit(1)
  return run
}

export async function lastStatusRun(kind: RunKind): Promise<Run | undefined> {
  const [run] = await db.select().from(runs)
    .where(and(eq(runs.kind, kind), isNotNull(runs.status), notHeldByRequestHold()))
    .orderBy(desc(runs.startedAt))
    .limit(1)
  return run
}

const ACCOUNT_RUN_KINDS: RunKind[] = ['cycle', 'search']
const CYCLE_RUN_KINDS: RunKind[] = ['cycle']
const WORKED_RUN_STATUSES: RunRowStatus[] = ['ok', 'partial']

async function lastWorkedRun(kinds: RunKind[]): Promise<Run | undefined> {
  const [run] = await db.select().from(runs)
    .where(and(inArray(runs.kind, kinds), inArray(runs.status, WORKED_RUN_STATUSES), notHeldByRequestHold()))
    .orderBy(desc(runs.startedAt))
    .limit(1)
  return run
}

export function lastWorkedAccountRun(): Promise<Run | undefined> {
  return lastWorkedRun(ACCOUNT_RUN_KINDS)
}

export function heldRunCondition(): SQL {
  return or(
    eq(runs.status, BLOCKED_STATUS),
    and(eq(runs.status, 'failed'), sql`(${runs.counts} ->> ${CYCLE_COUNT.loadBreaker})::int = 1`),
  ) as SQL
}

export async function lastHeldAccountRun(): Promise<Run | undefined> {
  const [run] = await db.select().from(runs)
    .where(and(inArray(runs.kind, ACCOUNT_RUN_KINDS), heldRunCondition()))
    .orderBy(desc(runs.startedAt))
    .limit(1)
  return run
}

export function lastWorkedCycleRun(): Promise<Run | undefined> {
  return lastWorkedRun(CYCLE_RUN_KINDS)
}

export async function lastExpiredAccountRun(): Promise<Run | undefined> {
  const [run] = await db.select().from(runs)
    .where(and(inArray(runs.kind, ACCOUNT_RUN_KINDS), eq(runs.status, SESSION_EXPIRED_STATUS)))
    .orderBy(desc(runs.startedAt))
    .limit(1)
  return run
}

export async function lastHealthNotifiedAt(): Promise<Date | null> {
  const [run] = await db.select({ startedAt: runs.startedAt }).from(runs)
    .where(and(eq(runs.kind, 'cycle'), sql`(${runs.counts} ->> ${CYCLE_COUNT.healthNotify})::int = 1`))
    .orderBy(desc(runs.startedAt))
    .limit(1)
  return run?.startedAt ?? null
}

export async function previousStatus(kind: RunKind, before: Date): Promise<RunRowStatus | null> {
  const [previous] = await db.select({ status: runs.status }).from(runs)
    .where(and(
      eq(runs.kind, kind),
      isNotNull(runs.status),
      lt(runs.startedAt, before),
      sql`coalesce((${runs.counts} ->> ${CYCLE_COUNT.orphan})::int, 0) <> 1`,
      notHeldByRequestHold(),
    ))
    .orderBy(desc(runs.startedAt))
    .limit(1)
  return previous?.status ?? null
}

export async function recentRuns(limit = RECENT_RUNS): Promise<Run[]> {
  return db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit)
}

export async function failOrphanRuns(startedBefore: Date, now: Date): Promise<number> {
  const failed = await db.update(runs)
    .set({
      status: 'failed',
      finishedAt: now,
      error: ORPHAN_RUN_TEXT,
      counts: sql`${runs.counts} || ${JSON.stringify({ [CYCLE_COUNT.orphan]: 1 })}::jsonb`,
    })
    .where(and(isNull(runs.status), lt(runs.startedAt, startedBefore)))
    .returning({ id: runs.id })
  return failed.length
}
