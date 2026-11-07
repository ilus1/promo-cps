import { beforeEach, expect, test, vi } from 'vitest'
import type { FetchedPage } from '../market/fetched-page'
import type { PageLoader } from '../market/amazon-browser'
import { createChromePool, type ChromeOpener } from './chrome-pool'

let opened: number
let closed: number
let loaded: string[]
let opener: ChromeOpener

function page(url: string): FetchedPage {
  return { status: 200, html: url }
}

beforeEach(() => {
  opened = 0
  closed = 0
  loaded = []
  opener = async (work) => {
    opened += 1
    const load: PageLoader = async (url) => {
      loaded.push(url)
      return page(url)
    }
    try {
      await work(load)
    } finally {
      closed += 1
    }
  }
})

test('nothing opens until a page is loaded', async () => {
  const pool = createChromePool(opener)
  await pool.during(async () => undefined)
  expect(opened).toBe(0)
})

test('one browser serves every load of a pass and closes when the pass ends', async () => {
  const pool = createChromePool(opener)
  await pool.during(async () => {
    expect(await pool.load('a', false)).toEqual(page('a'))
    expect(await pool.load('b', true)).toEqual(page('b'))
    expect(closed).toBe(0)
  })
  expect({ opened, closed, loaded }).toEqual({ opened: 1, closed: 1, loaded: ['a', 'b'] })
})

test('two passes at once share the browser, which closes after the last one', async () => {
  const pool = createChromePool(opener)
  let finishFirst = () => {}
  const first = pool.during(async () => {
    await pool.load('a', false)
    await new Promise<void>((resolve) => {
      finishFirst = resolve
    })
  })
  await vi.waitFor(() => expect(loaded).toEqual(['a']))
  await pool.during(async () => {
    await pool.load('b', false)
  })
  expect(closed).toBe(0)
  finishFirst()
  await first
  expect({ opened, closed }).toEqual({ opened: 1, closed: 1 })
})

test('loads run one at a time on the single page', async () => {
  const order: string[] = []
  opener = async (work) => {
    await work(async (url) => {
      order.push(`start ${url}`)
      await Promise.resolve()
      order.push(`end ${url}`)
      return page(url)
    })
  }
  const pool = createChromePool(opener)
  await pool.during(() => Promise.all([pool.load('a', false), pool.load('b', false)]))
  expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
})

test('a browser that fails to open fails the load, and the next load tries again', async () => {
  let attempts = 0
  const failing: ChromeOpener = async (work) => {
    attempts += 1
    if (attempts === 1) throw new Error('no chrome')
    await opener(work)
  }
  const pool = createChromePool(failing)
  await pool.during(async () => {
    await expect(pool.load('a', false)).rejects.toThrow('no chrome')
    expect(await pool.load('b', false)).toEqual(page('b'))
  })
  expect(attempts).toBe(2)
})

test('a session that ends early (deadline) is reopened on the next load', async () => {
  let sessions = 0
  const short: ChromeOpener = async (work) => {
    sessions += 1
    let done = false
    const load: PageLoader = async (url) => {
      if (done) throw new Error('closed')
      return page(url)
    }
    const working = work(load)
    working.catch(() => undefined)
    done = true
  }
  const pool = createChromePool(short)
  await pool.during(async () => {
    await pool.load('a', false).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await pool.load('b', false).catch(() => undefined)
  })
  expect(sessions).toBe(2)
})

test('closing during a pass shuts the browser now, and a later load opens a new one', async () => {
  const pool = createChromePool(opener)
  await pool.during(async () => {
    await pool.load('a', false)
    await pool.close()
    expect(closed).toBe(1)
    await pool.load('b', false)
  })
  expect({ opened, closed }).toEqual({ opened: 2, closed: 2 })
})

test('a load outside a pass still closes the browser afterwards', async () => {
  const pool = createChromePool(opener)
  await pool.load('a', false)
  await vi.waitFor(() => expect(closed).toBe(1))
})

test('a session is replaced after its page cap', async () => {
  const pool = createChromePool(opener, 2)
  await pool.during(async () => {
    for (const url of ['a', 'b', 'c']) await pool.load(url, false)
  })
  expect({ opened, closed, loaded }).toEqual({ opened: 2, closed: 2, loaded: ['a', 'b', 'c'] })
})

test('a close queued behind a load waits for it, so a second Chrome never starts beside the first', async () => {
  const order: string[] = []
  let finish = () => {}
  opener = async (work) => {
    order.push('open')
    try {
      await work(async (url) => {
        order.push(`load ${url}`)
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return page(url)
      })
    } finally {
      order.push('close')
    }
  }
  const pool = createChromePool(opener)
  const pass = pool.during(async () => {
    const first = pool.load('a', false)
    const closing = pool.close()
    const second = pool.load('b', false)
    await vi.waitFor(() => expect(order).toEqual(['open', 'load a']))
    finish()
    await closing
    await vi.waitFor(() => expect(order).toEqual(['open', 'load a', 'close', 'open', 'load b']))
    finish()
    await Promise.all([first, second])
  })
  await pass
  expect(order).toEqual(['open', 'load a', 'close', 'open', 'load b', 'close'])
})
