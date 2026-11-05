import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { BuscaKind, RunStatus } from '@/lib/domain'
import { SOURCE_SEARCH } from '@/lib/domain'
import { db, type Tx } from './client'
import { itemSources, searches, type Search } from './schema'

export const SEARCH_NOT_CREATED = 'A busca não foi criada'

export interface BuscaFields {
  name: string
  url: { kind: BuscaKind; url: string }
  enabled?: boolean
  runEveryHours?: number
}

export type BuscaPatch = Partial<BuscaFields>

const RESET_RUN = { lastRunAt: null, lastStatus: null, lastError: null, lastItems: null } as const

function columnsOf(fields: BuscaPatch) {
  return {
    name: fields.name,
    url: fields.url?.url,
    kind: fields.url?.kind,
    enabled: fields.enabled,
    runEveryHours: fields.runEveryHours,
  }
}

function clearSources(tx: Tx, id: string) {
  return tx.delete(itemSources).where(and(eq(itemSources.sourceType, SOURCE_SEARCH), eq(itemSources.sourceId, id)))
}

export function listSearches(): Promise<Search[]> {
  return db.select().from(searches).orderBy(desc(searches.createdAt))
}

export function listEnabledSearches(): Promise<Search[]> {
  return db.select().from(searches).where(eq(searches.enabled, true))
}

export async function getSearch(id: string): Promise<Search | undefined> {
  const [row] = await db.select().from(searches).where(eq(searches.id, id)).limit(1)
  return row
}

export async function searchByUrl(url: string): Promise<Search | undefined> {
  const [row] = await db.select().from(searches).where(eq(searches.url, url)).limit(1)
  return row
}

export async function createSearch(fields: BuscaFields): Promise<Search> {
  const [row] = await db.insert(searches).values({
    name: fields.name,
    url: fields.url.url,
    kind: fields.url.kind,
    enabled: fields.enabled,
    runEveryHours: fields.runEveryHours,
  }).returning()
  if (!row) throw new Error(SEARCH_NOT_CREATED)
  return row
}

export function updateSearch(id: string, patch: BuscaPatch): Promise<Search | undefined> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(searches).where(eq(searches.id, id)).limit(1).for('update')
    if (!current) return undefined
    const urlChanged = patch.url !== undefined && patch.url.url !== current.url
    if (urlChanged) await clearSources(tx, id)
    const [row] = await tx.update(searches)
      .set({ ...columnsOf(patch), ...(urlChanged ? RESET_RUN : {}) })
      .where(eq(searches.id, id))
      .returning()
    return row
  })
}

export function deleteSearch(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx.delete(searches).where(eq(searches.id, id)).returning({ id: searches.id })
    await clearSources(tx, id)
    return removed.length > 0
  })
}

async function writeStatus(
  id: string, url: string, status: RunStatus, error: string | null, lastRunAt: Date | undefined, lastItems?: number,
): Promise<void> {
  await db.update(searches)
    .set({ lastRunAt, lastStatus: status, lastError: error, lastItems })
    .where(and(eq(searches.id, id), eq(searches.url, url)))
}

export function recordRun(
  id: string, url: string, status: RunStatus, error: string | null, at: Date, items: number,
): Promise<void> {
  return writeStatus(id, url, status, error, at, items)
}

export function recordStop(id: string, url: string, status: RunStatus, error: string): Promise<void> {
  return writeStatus(id, url, status, error, undefined)
}

export async function markUnreadTried(ids: readonly string[], status: RunStatus, error: string): Promise<void> {
  if (ids.length === 0) return
  await db.update(searches)
    .set({ lastStatus: status, lastError: error })
    .where(and(inArray(searches.id, [...ids]), isNull(searches.lastStatus)))
}
