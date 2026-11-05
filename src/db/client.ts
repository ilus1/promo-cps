import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/env'
import * as schema from './schema'

declare global {
  var __promoSql: postgres.Sql | undefined
}

const POOL_MAX = 4
const IDLE_TIMEOUT_SECONDS = 20

const client = (globalThis.__promoSql ??= postgres(env().DATABASE_URL, {
  prepare: false,
  max: POOL_MAX,
  idle_timeout: IDLE_TIMEOUT_SECONDS,
  connection: { jit: 'off' },
}))
export const db = drizzle(client, { schema })
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
