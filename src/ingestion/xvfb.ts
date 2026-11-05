import { spawn } from 'node:child_process'
import { RunStop } from './errors'

export const SCREEN = { width: 1366, height: 768 }

const XVFB_ARGS = ['-displayfd', '3', '-screen', '0', `${SCREEN.width}x${SCREEN.height}x24`, '-nolisten', 'tcp']
const START_TIMEOUT_MS = 10000
const STOP_TIMEOUT_MS = 5000
const STDERR_TAIL_CHARS = 2000
const DISPLAY_NUMBER = /^\d+$/

export interface VirtualDisplay { display: string; stop: () => Promise<void> }

export function startXvfb(): Promise<VirtualDisplay> {
  return new Promise((resolve, reject) => {
    const child = spawn('Xvfb', XVFB_ARGS, { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] })
    const killChild = () => {
      child.kill()
    }
    process.once('exit', killChild)
    let stderrTail = ''
    let displayText = ''
    let settled = false
    const timer = setTimeout(() => fail('Xvfb não iniciou a tempo'), START_TIMEOUT_MS)

    function fail(message: string) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void stop()
      reject(new RunStop('failed', message))
    }

    function stop(): Promise<void> {
      process.removeListener('exit', killChild)
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
      return new Promise((done) => {
        const forceKill = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS)
        child.once('exit', () => {
          clearTimeout(forceKill)
          done()
        })
        child.kill()
      })
    }

    function announce() {
      const number = displayText.trim()
      if (settled || !DISPLAY_NUMBER.test(number)) return
      settled = true
      clearTimeout(timer)
      resolve({ display: `:${number}`, stop })
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS)
    })
    child.stdio[3]?.on('data', (chunk: Buffer) => {
      displayText += chunk.toString()
      if (displayText.includes('\n')) announce()
    })
    child.stdio[3]?.on('end', announce)
    child.on('error', (e) => fail(`Xvfb não pôde ser iniciado: ${e.message}`))
    child.on('close', (code, signal) => fail(`Xvfb saiu (código ${code ?? signal}): ${stderrTail.trim()}`))
  })
}
