import { NextResponse } from 'next/server'
import { markSeen } from '@/db/items'
import { parseBulkSeen } from '@/lib/bulk-seen'
import { withApi } from '@/lib/with-api'

export const POST = withApi(async (req: Request) => {
  const now = new Date()
  const target = parseBulkSeen(await req.json().catch(() => null), now)
  const marked = await markSeen(target, now)
  return NextResponse.json({ marked })
})
