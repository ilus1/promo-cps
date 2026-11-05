import { inArray, sql } from 'drizzle-orm'
import { HOLD_SETTINGS_CACHE_MS } from '@/lib/constants'
import { db } from './client'
import { appSettings } from './schema'

export const REQUESTS_PAUSED_KEY = 'requests_paused'
export const PRICE_CHECKS_PAUSED_KEY = 'price_checks_paused'
export type HoldSettingKey = typeof REQUESTS_PAUSED_KEY | typeof PRICE_CHECKS_PAUSED_KEY

export interface HoldSettings { requestsPaused: boolean; priceChecksPaused: boolean }

declare global {
  var __promoHoldSettings: { at: number; settings: HoldSettings } | undefined
}

export async function readHoldSettings(now: number = Date.now()): Promise<HoldSettings> {
  const cache = globalThis.__promoHoldSettings
  if (cache && now - cache.at < HOLD_SETTINGS_CACHE_MS) return cache.settings
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, [REQUESTS_PAUSED_KEY, PRICE_CHECKS_PAUSED_KEY]))
  const on = (key: HoldSettingKey) => rows.some((row) => row.key === key && row.value === true)
  const settings = { requestsPaused: on(REQUESTS_PAUSED_KEY), priceChecksPaused: on(PRICE_CHECKS_PAUSED_KEY) }
  globalThis.__promoHoldSettings = { at: now, settings }
  return settings
}

export async function setHoldSetting(key: HoldSettingKey, value: boolean): Promise<void> {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedAt: sql`now()` },
  })
  globalThis.__promoHoldSettings = undefined
}
