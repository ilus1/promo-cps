import { drizzle } from 'drizzle-orm/postgres-js'
import type postgres from 'postgres'
import * as schema from '../schema'

export interface CapturedQuery { sql: string; params: unknown[] }

export const captured: CapturedQuery[] = []
const replies: unknown[][] = []

export function queueRows(...results: unknown[][]): void {
  replies.push(...results)
}

export function resetFakeDb(): void {
  captured.length = 0
  replies.length = 0
}

function reply(query: string, params: unknown[]) {
  captured.push({ sql: query.replace(/\s+/g, ' '), params })
  const rows = replies.shift() ?? []
  return Object.assign(Promise.resolve(rows), { values: () => Promise.resolve(rows) })
}

export const TRANSACTION_MARKER = 'begin'

const client = {
  options: { parsers: {}, serializers: {} },
  unsafe: reply,
  begin: (work: (tx: unknown) => Promise<unknown>) => {
    captured.push({ sql: TRANSACTION_MARKER, params: [] })
    return work(client)
  },
} as unknown as postgres.Sql

export const fakeDb = drizzle(client, { schema })
