import { conflict } from '@/lib/with-api'
import { mlRequestHold } from './request-hold'

export async function refuseIfHeld(): Promise<Response | null> {
  const hold = await mlRequestHold(new Date())
  return hold ? conflict(hold.text) : null
}
