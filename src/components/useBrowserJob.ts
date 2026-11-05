import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { MlStatus } from '@/lib/domain'
import { APP_UNREACHABLE_TEXT } from '@/lib/labels'
import { useMlStatusPoll } from './useMlStatusPoll'

type BrowserJob<S> = {
  initial: S
  isActive: (status: S) => boolean
  changeKey: (status: S) => string
  statusError: (status: S) => string | null
  fromMlStatus: (status: MlStatus) => S
  request: () => Promise<S>
}

export function useBrowserJob<S>(job: BrowserJob<S>) {
  const router = useRouter()
  const [status, setStatus] = useState(job.initial)
  const shownKey = useRef(job.changeKey(job.initial))
  const [pending, setPending] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const initialKey = job.changeKey(job.initial)
  const [syncedKey, setSyncedKey] = useState(initialKey)
  if (syncedKey !== initialKey) {
    setSyncedKey(initialKey)
    setStatus(job.initial)
  }
  const active = job.isActive(status)
  const key = job.changeKey(status)
  const error = requestError ?? (unreachable ? APP_UNREACHABLE_TEXT : job.statusError(status))

  useEffect(() => {
    if (shownKey.current === key) return
    shownKey.current = key
    router.refresh()
  }, [key, router])

  useMlStatusPoll(active, (next) => setStatus(job.fromMlStatus(next)), setUnreachable)

  async function start() {
    setPending(true)
    setRequestError(null)
    try {
      setStatus(await job.request())
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return { status, active, busy: pending || active, error, start }
}
