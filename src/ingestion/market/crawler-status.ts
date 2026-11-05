import type { CrawlerStateRow } from '@/db/crawler-state'
import { AMAZON_DAILY_PAGES, AMAZON_PAGE_INTERVAL_MS, KABUM_PAGE_INTERVAL_MS } from '@/lib/constants'
import { kabumNextPassAt, kabumPassDue, pagesToday, withinBudget } from '@/lib/market/crawl-rules'
import type { AmazonProgress, CrawlerState, CrawlerStatus, KabumProgress, WaitingReason } from '@/lib/market/types'
import type { RequestHold } from '@/lib/request-hold'
import { inKabumPass, kabumCursorOf, kabumPageOf } from './kabum-crawler'

export interface StatusInputs {
  row: CrawlerStateRow
  running: boolean
  hold: RequestHold | null
  now: Date
  validOffers: number
}

export interface AmazonStatusInputs extends StatusInputs {
  chainIdle: boolean
  lastWait: WaitingReason | null
  searchedKeys: number
  dueKeys: number
}

type StateFields = Pick<CrawlerStatus, 'state' | 'holdText' | 'waitingFor' | 'blockedUntil'>

function stateFields({ row, running, hold, now }: StatusInputs, waitingFor: WaitingReason | null): StateFields {
  const blockedUntil = row.blockedUntil && row.blockedUntil.getTime() > now.getTime() ? row.blockedUntil : null
  const state: CrawlerState = !running ? 'stopped' : hold ? 'held' : blockedUntil ? 'blocked' : waitingFor ? 'waiting' : 'running'
  return {
    state,
    holdText: state === 'held' ? hold?.reason ?? null : null,
    waitingFor: state === 'waiting' ? waitingFor : null,
    blockedUntil,
  }
}

function sharedFields({ row, now, validOffers }: StatusInputs): Pick<CrawlerStatus, 'lastError' | 'pagesToday' | 'lastPageAt' | 'validOffers'> {
  return { lastError: row.lastError, pagesToday: pagesToday(row.dayKey, row.pagesToday, now), lastPageAt: row.lastPageAt, validOffers }
}

export function kabumStatus(inputs: StatusInputs): CrawlerStatus {
  const { row, now } = inputs
  const cursor = kabumCursorOf(row.cursor)
  const inPass = inKabumPass(cursor)
  const progress: KabumProgress = {
    site: 'kabum',
    department: inPass ? cursor.departments[cursor.index] : null,
    departmentIndex: inPass ? cursor.index : 0,
    departmentCount: cursor.departments.length,
    page: inPass ? kabumPageOf(cursor) : 0,
    passStartedAt: row.passStartedAt,
    nextPassAt: kabumNextPassAt(row.passStartedAt),
  }
  const waitingFor: WaitingReason | null = !inPass && !kabumPassDue(row.passStartedAt, now) ? 'next_pass' : null
  return {
    ...stateFields(inputs, waitingFor),
    ...sharedFields(inputs),
    dailyBudget: null,
    intervalMs: KABUM_PAGE_INTERVAL_MS,
    progress,
  }
}

function amazonWait({ row, now, chainIdle, lastWait }: AmazonStatusInputs): WaitingReason | null {
  if (!withinBudget(pagesToday(row.dayKey, row.pagesToday, now), AMAZON_DAILY_PAGES)) return 'daily_budget'
  if (!chainIdle) return 'ml_busy'
  return lastWait === 'queue_empty' ? lastWait : null
}

export function amazonStatus(inputs: AmazonStatusInputs): CrawlerStatus {
  const progress: AmazonProgress = {
    site: 'amazon',
    searchedKeys: inputs.searchedKeys,
    dueKeys: inputs.dueKeys,
    bestsellersAt: inputs.row.bestsellersAt,
  }
  return {
    ...stateFields(inputs, amazonWait(inputs)),
    ...sharedFields(inputs),
    dailyBudget: AMAZON_DAILY_PAGES,
    intervalMs: AMAZON_PAGE_INTERVAL_MS,
    progress,
  }
}
