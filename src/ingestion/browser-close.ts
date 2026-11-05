import { readdir, readFile, readlink } from 'node:fs/promises'
import path from 'node:path'
import { BROWSER_CLOSE_TIMEOUT_MS } from '@/lib/constants'

const LOG_TAG = '[browser]'
const PROFILE_ARG = '--user-data-dir='
const PROC_DIR = '/proc'
const CHROME_EXE = 'chrome'
const NUMERIC = /^\d+$/
const IGNORED_KILL_ERRORS = ['ESRCH', 'EPERM']
const DELETED_SUFFIX = ' (deleted)'

export interface CloseTarget {
  close: () => Promise<void>
  kill: () => Promise<void>
}

export interface ProcessInfo {
  pid: number
  argv: string[]
  exe: string
}

export interface ProcessReader {
  list: () => Promise<number[]>
  read: (pid: number) => Promise<ProcessInfo | null>
}

export function isProfileBrowser(info: ProcessInfo, profileDir: string, ownPid: number): boolean {
  if (info.pid === ownPid) return false
  if (path.basename(info.exe.endsWith(DELETED_SUFFIX) ? info.exe.slice(0, -DELETED_SUFFIX.length) : info.exe) !== CHROME_EXE) return false
  const resolved = path.resolve(profileDir)
  return info.argv.some((arg) => arg.startsWith(PROFILE_ARG) && path.resolve(arg.slice(PROFILE_ARG.length)) === resolved)
}

export async function profileBrowserPids(reader: ProcessReader, profileDir: string, ownPid: number): Promise<number[]> {
  const matches: number[] = []
  for (const pid of await reader.list()) {
    const info = await reader.read(pid)
    if (info && isProfileBrowser(info, profileDir, ownPid)) matches.push(pid)
  }
  return matches
}

export const procReader: ProcessReader = {
  list: async () => (await readdir(PROC_DIR)).filter((name) => NUMERIC.test(name)).map(Number),
  read: async (pid) => {
    try {
      const [cmdline, exe] = await Promise.all([
        readFile(path.join(PROC_DIR, String(pid), 'cmdline'), 'utf8'),
        readlink(path.join(PROC_DIR, String(pid), 'exe')),
      ])
      return { pid, argv: cmdline.split('\0'), exe }
    } catch {
      return null
    }
  },
}

export async function killProfileBrowser(profileDir: string, reader: ProcessReader = procReader): Promise<number> {
  const resolved = path.resolve(profileDir)
  const pids = await profileBrowserPids(reader, resolved, process.pid)
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (e) {
      const code = e instanceof Error && 'code' in e ? String(e.code) : ''
      if (!IGNORED_KILL_ERRORS.includes(code)) throw e
    }
  }
  console.log(LOG_TAG, pids.length === 0 ? 'no browser process found for the profile' : `killed ${pids.length} browser process(es)`)
  return pids.length
}

export async function closeWithin(target: CloseTarget, timeoutMs: number = BROWSER_CLOSE_TIMEOUT_MS): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  const closed = target.close().then(() => true, () => true)
  const done = await Promise.race([closed, expired])
  clearTimeout(timer)
  if (done) return true
  console.error(LOG_TAG, `close did not finish in ${timeoutMs} ms; killing the browser`)
  await target.kill().catch((e: unknown) => console.error(LOG_TAG, 'kill failed', e instanceof Error ? e.message : e))
  return false
}
