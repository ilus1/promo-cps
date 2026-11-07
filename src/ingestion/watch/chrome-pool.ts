import { AMAZON_SESSION_PAGES } from '@/lib/constants'
import type { PageLoader } from '../market/amazon-browser'
import type { FetchedPage } from '../market/fetched-page'

export type ChromeOpener = (work: (load: PageLoader) => Promise<void>) => Promise<void>

export interface ChromePool {
  load: PageLoader
  during<T>(work: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

interface Session { load: Promise<PageLoader>; release: () => void; closed: Promise<void>; pages: number }

export function createChromePool(open: ChromeOpener, maxPages: number = AMAZON_SESSION_PAGES): ChromePool {
  let users = 0
  let current: Session | null = null
  let queue: Promise<unknown> = Promise.resolve()

  function queued<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  function start(): Session {
    let release = () => {}
    const holding = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready: (load: PageLoader) => void = () => {}
    let failed: (e: unknown) => void = () => {}
    const load = new Promise<PageLoader>((resolve, reject) => {
      ready = resolve
      failed = reject
    })
    const session: Session = { load, release, closed: Promise.resolve(), pages: 0 }
    session.closed = open(async (pageLoad) => {
      ready(pageLoad)
      await holding
    }).catch(failed).finally(() => {
      if (current === session) current = null
    })
    current = session
    return session
  }

  async function close(): Promise<void> {
    const session = current
    if (!session) return
    current = null
    session.release()
    await session.closed
  }

  async function closeIfUnused(): Promise<void> {
    if (users === 0) await close()
  }

  async function loadNow(url: string, scroll: boolean): Promise<FetchedPage> {
    const session = current ?? start()
    session.pages += 1
    try {
      return await (await session.load)(url, scroll)
    } finally {
      if (session.pages >= maxPages && current === session) await close()
    }
  }

  function load(url: string, scroll: boolean): Promise<FetchedPage> {
    const run = queued(() => loadNow(url, scroll))
    queued(closeIfUnused).catch(() => undefined)
    return run
  }

  async function during<T>(work: () => Promise<T>): Promise<T> {
    users += 1
    try {
      return await work()
    } finally {
      users -= 1
      await queued(closeIfUnused)
    }
  }

  return { load, during, close: () => queued(close) }
}
