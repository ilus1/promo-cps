import { env } from '@/env'
import { LOOPBACK_HOST } from './local-origin'

export function appBaseUrl(): string {
  return `http://${LOOPBACK_HOST}:${env().PORT}`
}
