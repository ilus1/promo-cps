import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STDERR_TAIL_CHARS, dealDigestNotification, notifySendArgs, sendDesktopNotification,
  healthNotification, sessionNotification,
} from './desktop-notify'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('@/env', () => ({ env: () => ({ PORT: 8510 }) }))

const baseUrl = 'http://127.0.0.1:8510'

const digest = {
  alertName: 'notebooks',
  count: 5,
  samples: [
    { title: 'Notebook Acer Aspire 5', priceCents: 458800, mlDiscountPct: 47, dropRatio: null },
    { title: 'Notebook Dell <i5> & SSD', priceCents: 329990, mlDiscountPct: 10, dropRatio: 0.12 },
    { title: 'Notebook Lenovo', priceCents: 279900, mlDiscountPct: null, dropRatio: 0.125 },
  ],
  url: `${baseUrl}/?busca=b1&descontoMin=10`,
}

describe('dealDigestNotification', () => {
  it('title counts and names the alert; body lists samples plus the rest; Abrir opens the view', () => {
    expect(dealDigestNotification(digest)).toEqual({
      title: '5 novas ofertas: notebooks',
      body: [
        'R$ 4.588 (47% OFF): Notebook Acer Aspire 5',
        'R$ 3.299,90 (10% OFF, 12% abaixo do menor preço): Notebook Dell <i5> & SSD',
        'R$ 2.799 (13% abaixo do menor preço): Notebook Lenovo',
        'e mais 2',
      ].join('\n'),
      url: digest.url,
    })
  })

  it('singular, and no rest line when every offer is listed', () => {
    const one = { ...digest, count: 1, samples: [digest.samples[0]] }
    expect(dealDigestNotification(one)).toMatchObject({
      title: '1 nova oferta: notebooks',
      body: 'R$ 4.588 (47% OFF): Notebook Acer Aspire 5',
    })
  })

  it('no parentheses without a discount or a drop', () => {
    const plain = { title: 'Notebook', priceCents: 458800, mlDiscountPct: 0, dropRatio: 0 }
    expect(dealDigestNotification({ ...digest, count: 1, samples: [plain] }).body)
      .toBe('R$ 4.588: Notebook')
  })
})

describe('sessionNotification', () => {
  it.each([
    ['cycle', 'session_expired', 'Promo CPS: sessão do Mercado Livre expirada'],
    ['cycle', 'blocked', 'Promo CPS: acesso bloqueado pelo Mercado Livre'],
    ['cycle', 'failed', 'Promo CPS: o ciclo falhou'],
    ['search', 'session_expired', 'Promo CPS: sessão do Mercado Livre expirada'],
    ['search', 'blocked', 'Promo CPS: acesso bloqueado pelo Mercado Livre'],
    ['search', 'failed', 'Promo CPS: a busca falhou'],
  ] as const)('%s run %s: titled, body is the run error, Abrir opens Conta', (kind, status, title) => {
    expect(sessionNotification({ kind, status, error: 'Login exigido' }, baseUrl))
      .toEqual({ title, body: 'Login exigido', url: `${baseUrl}/conta` })
  })

  it('empty body when the run has no error', () => {
    expect(sessionNotification({ kind: 'cycle', status: 'blocked', error: null }, baseUrl)?.body).toBe('')
  })

  it('nothing for ok, partial or an unfinished run, nor for a failed login', () => {
    expect(sessionNotification({ kind: 'cycle', status: 'ok', error: null }, baseUrl)).toBeNull()
    expect(sessionNotification({ kind: 'search', status: 'partial', error: 'x' }, baseUrl)).toBeNull()
    expect(sessionNotification({ kind: 'cycle', status: null, error: null }, baseUrl)).toBeNull()
    expect(sessionNotification({ kind: 'login', status: 'failed', error: 'x' }, baseUrl)).toBeNull()
  })

  it.each(['refused', 'timed_out', 'unconfirmed', 'logged_in'] as const)('nothing for a login run ending %s', (status) => {
    expect(sessionNotification({ kind: 'login', status, error: 'x' }, baseUrl)).toBeNull()
  })
})

describe('healthNotification', () => {
  it('a cycle flagged for notification opens Conta with the warning texts', () => {
    const n = healthNotification({ kind: 'cycle', counts: { health: 3, healthNotify: 1 } }, baseUrl)
    expect(n?.url).toBe(`${baseUrl}/conta`)
    expect(n?.body.split('\n')).toHaveLength(2)
  })

  it('nothing when not flagged, without warnings or for another kind', () => {
    expect(healthNotification({ kind: 'cycle', counts: { health: 3, healthNotify: 0 } }, baseUrl)).toBeNull()
    expect(healthNotification({ kind: 'cycle', counts: { health: 0, healthNotify: 1 } }, baseUrl)).toBeNull()
    expect(healthNotification({ kind: 'search', counts: { health: 3, healthNotify: 1 } }, baseUrl)).toBeNull()
  })
})

describe('notifySendArgs', () => {
  it('waits for a click on the default action and escapes markup in the body', () => {
    const n = { title: '5 novas ofertas: <notebooks>', body: 'Dell <i5> & SSD', url: digest.url }
    expect(notifySendArgs(n)).toEqual([
      '--app-name=Promo CPS', '--action=default=Abrir', '--wait', '--',
      '5 novas ofertas: <notebooks>', 'Dell &lt;i5&gt; &amp; SSD',
    ])
  })

  it('doubles backslashes in the body only, since notify-send unescapes the body alone', () => {
    const n = { title: 'C:\\ofertas \\n', body: 'Cabo \\ USB \\n & <x>', url: digest.url }
    expect(notifySendArgs(n).slice(-2)).toEqual(['C:\\ofertas \\n', 'Cabo \\\\ USB \\\\n &amp; &lt;x&gt;'])
  })
})

describe('sendDesktopNotification', () => {
  const n = { title: 'a', body: 'b', url: digest.url }
  const fakeChild = () => Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), unref: vi.fn(),
  })
  let log: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    spawn.mockReset()
    log = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    log.mockRestore()
  })

  it('logs instead of throwing when spawn throws', () => {
    const failure = new Error('invalid argument')
    spawn.mockImplementation(() => { throw failure })
    expect(() => sendDesktopNotification(n)).not.toThrow()
    expect(spawn).toHaveBeenCalledWith('notify-send', notifySendArgs(n), expect.anything())
    expect(log).toHaveBeenCalledWith('[notify] notify-send failed:', failure.message)
  })

  it('a click opens exactly the notification url', () => {
    const child = fakeChild()
    spawn.mockReturnValueOnce(child).mockReturnValueOnce(fakeChild())
    sendDesktopNotification(n)
    child.stdout.emit('data', Buffer.from('default\n'))
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenLastCalledWith('xdg-open', [n.url], expect.anything())
  })

  it.each(['https://evil.example/x', 'http://127.0.0.1:8510.evil.example/x', 'http://127.0.0.1:8510', 'file:///etc/passwd'])(
    'a click never opens %s', (url) => {
      const child = fakeChild()
      spawn.mockReturnValueOnce(child)
      sendDesktopNotification({ ...n, url })
      child.stdout.emit('data', Buffer.from('default\n'))
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith('[notify] xdg-open failed:', 'refused a url outside the app')
    },
  )

  it('ignores any other output', () => {
    const child = fakeChild()
    spawn.mockReturnValueOnce(child)
    sendDesktopNotification(n)
    child.stdout.emit('data', Buffer.from('dismissed\n'))
    child.stdout.emit('data', Buffer.from('defaults\n'))
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('logs instead of throwing when xdg-open throws', () => {
    const child = fakeChild()
    const failure = new Error('bad url')
    spawn.mockReturnValueOnce(child).mockImplementationOnce(() => { throw failure })
    sendDesktopNotification(n)
    expect(() => child.stdout.emit('data', Buffer.from('default\n'))).not.toThrow()
    expect(log).toHaveBeenCalledWith('[notify] xdg-open failed:', failure.message)
  })

  it('logs a non-zero exit with the end of stderr', () => {
    const child = fakeChild()
    spawn.mockReturnValueOnce(child)
    sendDesktopNotification(n)
    child.stderr.emit('data', Buffer.from('GDBus.Error: '))
    child.stderr.emit('data', Buffer.from('no notification service\n'))
    child.emit('close', 1, null)
    expect(log).toHaveBeenCalledWith(
      '[notify] notify-send failed:', 'exit 1: GDBus.Error: no notification service',
    )
  })

  it('keeps only a bounded tail of stderr', () => {
    const child = fakeChild()
    spawn.mockReturnValueOnce(child)
    sendDesktopNotification(n)
    child.stderr.emit('data', Buffer.from('x'.repeat(10 * STDERR_TAIL_CHARS)))
    child.stderr.emit('data', Buffer.from('END'))
    child.emit('close', 2, null)
    const tail = `${'x'.repeat(STDERR_TAIL_CHARS - 'END'.length)}END`
    expect(log).toHaveBeenCalledWith('[notify] notify-send failed:', `exit 2: ${tail}`)
  })

  it('a missing notify-send logs once', () => {
    const child = fakeChild()
    spawn.mockReturnValueOnce(child)
    sendDesktopNotification(n)
    child.emit('error', Object.assign(new Error('spawn notify-send ENOENT'), { code: 'ENOENT' }))
    child.emit('close', -2, null)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[notify] notify-send failed:', 'spawn notify-send ENOENT')
  })

  it('a clean exit or a signal logs nothing', () => {
    const child = fakeChild()
    spawn.mockReturnValueOnce(child)
    sendDesktopNotification(n)
    child.stderr.emit('data', Buffer.from('warning'))
    child.emit('close', 0, null)
    child.emit('close', null, 'SIGTERM')
    expect(log).not.toHaveBeenCalled()
  })
})
