const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const LOOPBACK_HOST = '127.0.0.1'
const LOCAL_HOSTS = [LOOPBACK_HOST, 'localhost']

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method)
}

export function isLocalRequest(req: Request, port: number): boolean {
  if (isSafeMethod(req.method)) return true
  const allowedHosts = LOCAL_HOSTS.map((h) => `${h}:${port}`)
  const origin = req.headers.get('origin')
  if (origin) return allowedHosts.some((h) => origin === `http://${h}`)
  const host = req.headers.get('host')
  return host !== null && allowedHosts.includes(host)
}
