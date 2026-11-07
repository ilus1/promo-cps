import { z } from 'zod'
import { storableCents } from './market/pages'
import { validEan } from './watch/ean'
import {
  nameOrLinkIssue, UNKNOWN_LINK_TEXT, URL_LIKE, WATCH_DROP_MAX, WATCH_DROP_MIN, WATCH_INPUT_MAX, WATCH_NAME_MAX,
} from './watch/input-rules'
import { parseProductLink } from './watch/links'
import type { ProductLink } from './watch/types'

export const PATCH_EMPTY = 'Informe ao menos um campo'
export const INVALID_EAN = 'Código de barras inválido.'
export const INVALID_CENTS = 'Preço inválido.'

export interface WatchInput { name: string; link: ProductLink | null }

const plainName = z.string().trim().min(1).max(WATCH_NAME_MAX).refine((name) => !URL_LIKE.test(name), { message: UNKNOWN_LINK_TEXT })

const nameOrLink = z.string().trim().min(1).max(WATCH_INPUT_MAX).transform((input, ctx): WatchInput => {
  const link = parseProductLink(input)
  if (link) return { name: link.url, link }
  const issue = nameOrLinkIssue(input)
  if (issue) {
    ctx.addIssue({ code: 'custom', message: issue })
    return z.NEVER
  }
  return { name: input, link: null }
})

const ean = z.string().transform((raw, ctx) => {
  const code = validEan(raw)
  if (code === null) {
    ctx.addIssue({ code: 'custom', message: INVALID_EAN })
    return z.NEVER
  }
  return code
})

const cents = z.number().refine(storableCents, { message: INVALID_CENTS })
const dropPercent = z.number().int().min(WATCH_DROP_MIN).max(WATCH_DROP_MAX)

export const CreateWatch = z.strictObject({
  nameOrLink,
  ean: ean.optional(),
  targetPriceCents: cents.optional(),
  dropPercent: dropPercent.optional(),
})

export const UpdateWatch = z.strictObject({
  name: plainName.optional(),
  ean: ean.nullable().optional(),
  targetPriceCents: cents.nullable().optional(),
  dropPercent: dropPercent.optional(),
  active: z.boolean().optional(),
}).refine((patch) => Object.values(patch).some((value) => value !== undefined), { message: PATCH_EMPTY })
