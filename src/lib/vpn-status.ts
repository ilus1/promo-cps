const STATUS_LINE = /^\s*Status:\s*(.+?)\s*$/im
const NAME_LINE = /^\s*VPN name:\s*(.+?)\s*$/im
const CONNECTED = 'connected'

export type VpnState = 'off' | 'connected' | 'clear' | 'error' | 'unknown'

export interface VpnStatus { known: boolean; connected: boolean; name: string | null }

export function parseVpnStatus(output: string): VpnStatus {
  const status = STATUS_LINE.exec(output)?.[1]
  const name = NAME_LINE.exec(output)?.[1] ?? null
  return { known: status !== undefined, connected: status?.toLowerCase() === CONNECTED, name }
}

export function holdsRequests(status: VpnStatus, holdNames: readonly string[]): boolean {
  if (!status.connected) return false
  if (status.name === null) return true
  const name = status.name.toLowerCase()
  return holdNames.some((held) => held.toLowerCase() === name)
}

export function parseHoldNames(raw: string): string[] {
  return raw.split(',').map((name) => name.trim()).filter((name) => name !== '')
}
