import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { parseHoldNames } from './lib/vpn-status'

const OLXMAPPER_PORT = 8500

export const PORT_TAKEN_ERROR = `PORT ${OLXMAPPER_PORT} is used by olxmapper`
export const PROFILE_DIR_NOT_ABSOLUTE_ERROR = 'ML_PROFILE_DIR must be an absolute path'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive()
    .refine((p) => p !== OLXMAPPER_PORT, { message: PORT_TAKEN_ERROR }).default(8510),
  ML_PROFILE_DIR: z.string().min(1)
    .refine((p) => isAbsolute(p), { message: PROFILE_DIR_NOT_ABSOLUTE_ERROR }),
  AUTO_RUN: z.enum(['on', 'off']).default('on'),
  RUN_EVERY_HOURS: z.coerce.number().min(1).default(3),
  PAGE_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
  ACTIVATE_PER_RUN: z.coerce.number().int().nonnegative().default(20),
  VPN_HOLD_NAMES: z.string().default('ca-DC-ipsec-vpn').transform(parseHoldNames),
})

export const ENV_KEYS = Object.keys(schema.shape)

export type Env = z.infer<typeof schema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  )
  return schema.parse(present)
}

let cached: Env | null = null
export function env(): Env {
  if (!cached) cached = parseEnv(process.env)
  return cached
}
