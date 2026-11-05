import { useEffect, useRef } from 'react'
import { fetchMlStatus } from '@/lib/api'
import type { MlStatus } from '@/lib/domain'

const STATUS_POLL_MS = 2000
const MAX_POLL_FAILURES = 3

export function useMlStatusPoll(active: boolean, onStatus: (status: MlStatus) => void, onUnreachable: (unreachable: boolean) => void) {
  const handlers = useRef({ onStatus, onUnreachable })

  useEffect(() => {
    handlers.current = { onStatus, onUnreachable }
  })

  useEffect(() => {
    if (!active) return
    let stopped = false
    let inFlight = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      if (stopped || inFlight) return
      clearTimeout(timer)
      inFlight = true
      try {
        const next = await fetchMlStatus()
        failures = 0
        if (!stopped) {
          handlers.current.onStatus(next)
          handlers.current.onUnreachable(false)
        }
      } catch {
        failures += 1
        if (!stopped && failures >= MAX_POLL_FAILURES) handlers.current.onUnreachable(true)
      } finally {
        inFlight = false
        if (!stopped) timer = setTimeout(poll, STATUS_POLL_MS)
      }
    }

    function refresh() {
      if (document.visibilityState === 'visible') void poll()
    }

    timer = setTimeout(poll, STATUS_POLL_MS)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [active])
}
