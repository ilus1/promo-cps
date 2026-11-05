import { z } from 'zod'
import { ALERT_NAME_MAX, ALERT_QUERY_MAX } from './alert-rules'
import { BUSCA_NAME_MAX } from './busca-rules'
import { RUN_EVERY_HOURS_OPTIONS } from './constants'
import { classifyBuscaInput, classifyMlUrl } from './ml-url'

export const RUN_EVERY_HOURS_INVALID = `runEveryHours deve ser um de ${RUN_EVERY_HOURS_OPTIONS.join(', ')}`
export const PATCH_EMPTY = 'Informe ao menos um campo'

const name = z.string().trim().min(1).max(BUSCA_NAME_MAX)

function classifiedUrl(classify: typeof classifyMlUrl) {
  return z.string().transform((input, ctx) => {
    const classified = classify(input)
    if ('error' in classified) {
      ctx.addIssue({ code: 'custom', message: classified.error })
      return z.NEVER
    }
    return classified
  })
}

const mlUrl = classifiedUrl(classifyMlUrl)
const typedOrUrl = classifiedUrl(classifyBuscaInput)

const runEveryHours = z.number().refine(
  (hours) => RUN_EVERY_HOURS_OPTIONS.some((option) => option === hours),
  { message: RUN_EVERY_HOURS_INVALID },
)

const fields = { name, url: mlUrl, runEveryHours, enabled: z.boolean() }

export const CreateBusca = z.strictObject({
  name: fields.name,
  url: typedOrUrl,
  runEveryHours: fields.runEveryHours.optional(),
  enabled: fields.enabled.optional(),
})

export const UpdateBusca = z.strictObject({
  name: fields.name.optional(),
  url: fields.url.optional(),
  runEveryHours: fields.runEveryHours.optional(),
  enabled: fields.enabled.optional(),
}).refine((patch) => Object.values(patch).some((value) => value !== undefined), { message: PATCH_EMPTY })

export const CreateAlert = z.strictObject({
  name: z.string().trim().min(1).max(ALERT_NAME_MAX),
  query: z.string().max(ALERT_QUERY_MAX),
})

const COUPON_QUERY_MAX = ALERT_QUERY_MAX

export const PrioritizeCoupons = z.strictObject({
  query: z.string().max(COUPON_QUERY_MAX),
})
