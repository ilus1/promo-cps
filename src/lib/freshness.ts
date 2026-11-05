import { DAY_MS, HOUR_MS, STALE_AFTER_HOURS } from './constants'

export function hoursBefore(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * HOUR_MS)
}

export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

export function freshSince(now: Date): Date {
  return hoursBefore(now, STALE_AFTER_HOURS)
}
