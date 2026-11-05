import type { Locator, Page, Response } from 'playwright'
import type { ActivationOutcome } from '@/lib/domain'
import { BLOCKED_STATUSES, type PageOutcome } from '@/lib/ml-session'
import { isRecord } from '@/lib/records'
import { firstLine, isRunStop, stopFor } from '../errors'
import { ACTIVATION_EU_QUERO, COUPON_ACTION_LINK, COUPON_STATUS_INACTIVE, type CouponPage } from './coupons'
import { throwIfClosed, throwIfStopped } from './page-state'

const ACTIVATE_PATH = '/cupons/api/activate'
const CAMPAIGN_ID_PARAM = 'campaign_id'
const APPLY_LABEL = 'Aplicar'
export const APPLY_BUTTON_NOT_FOUND = `botão ${APPLY_LABEL} não encontrado`
export const APPLY_BUTTON_AMBIGUOUS = `mais de um botão ${APPLY_LABEL} encontrado`
export const COUPON_WITHOUT_APPLY = `cupom sem botão ${APPLY_LABEL}`
export const APPLY_BUTTON_CHANGED = `o botão ${APPLY_LABEL} mudou antes do clique`
const ACTIVATION_NO_RESPONSE = 'sem resposta da ativação'
export const ACTIVATION_REFUSED = 'ativação recusada'
export const ACTIVATION_OTHER_COUPON = 'a resposta da ativação é de outro cupom'
const ACTION_BUTTON = 'button'
const ACTION_SELECTOR = 'button, a[href]'
const APPLY_INDEX_ATTRIBUTE = 'data-apply-index'
const ACTIVATE_TIMEOUT_MS = 20000
const CLICK_TIMEOUT_MS = 10000
const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const ERROR_TEXT_LIMIT = 200

export type CouponEntry = CouponPage['coupons'][number]
export type ApplicableCoupon<T> = { candidate: T; coupon: CouponEntry }
export interface PageMatch<T> { applicable: ApplicableCoupon<T>[]; notApplicable: T[] }
export type ClickResponse = 'answered' | 'unanswered' | 'not_clicked'
export type ApplyResult = { attempted: false } | { attempted: true; outcome: ActivationOutcome; click: ClickResponse }
export type PreparedApply = { ok: true; button: Locator } | { ok: false; error: string }
export interface ApplyButton { ariaLabel: string | null; cardText: string; index: number }
export interface ApplyTarget { title: string; scope: string; srLabel: string }
export type ButtonChoice = { ok: true; index: number } | { ok: false; error: string }

export function canApply({ parsed, raw }: CouponEntry, now: Date): boolean {
  return parsed.status === COUPON_STATUS_INACTIVE && parsed.activationType === ACTIVATION_EU_QUERO
    && parsed.activateCode !== null && (parsed.startsAt === null || parsed.startsAt <= now)
    && raw.action?.type === ACTION_BUTTON && raw.action.text === APPLY_LABEL
}

export function matchOnPage<T extends { campaignId: string }>(
  candidates: readonly T[], pageCoupons: readonly CouponEntry[], now: Date,
): PageMatch<T> {
  const onPage = new Map(pageCoupons.map((c) => [c.parsed.campaignId, c]))
  const match: PageMatch<T> = { applicable: [], notApplicable: [] }
  for (const candidate of candidates) {
    const coupon = onPage.get(candidate.campaignId)
    if (!coupon) continue
    if (canApply(coupon, now)) match.applicable.push({ candidate, coupon })
    else match.notApplicable.push(candidate)
  }
  return match
}

export function applyTarget({ parsed, raw }: CouponEntry): ApplyTarget {
  return { title: parsed.title, scope: parsed.scopeLabel ?? '', srLabel: raw.action?.accessibility?.sr_label ?? '' }
}

function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

export function chooseApplyButton(buttons: readonly ApplyButton[], { title, scope, srLabel }: ApplyTarget): ButtonChoice {
  const wantedTitle = compact(title)
  const wantedScope = compact(scope)
  const matches = buttons.filter((button) => {
    const text = compact(button.cardText)
    const labelled = srLabel === '' || button.ariaLabel === srLabel
    return labelled && text.includes(wantedTitle) && text.includes(wantedScope)
  })
  if (matches.length === 1) return { ok: true, index: matches[0].index }
  return { ok: false, error: matches.length === 0 ? APPLY_BUTTON_NOT_FOUND : APPLY_BUTTON_AMBIGUOUS }
}

export function listApplyButtons(page: Page, srLabel: string): Promise<ApplyButton[]> {
  return page.evaluate(({ selector, label, wantedLabel, attribute }) => {
    document.querySelectorAll(`[${attribute}]`).forEach((marked) => marked.removeAttribute(attribute))
    const actions = Array.from(document.querySelectorAll(selector))
    const applies = actions.filter((action) =>
      (action.textContent ?? '').trim() === label || (wantedLabel !== '' && action.getAttribute('aria-label') === wantedLabel))
    return applies.map((action, index) => {
      action.setAttribute(attribute, String(index))
      let card: Element = action
      let parent = action.parentElement
      while (parent) {
        const holder: Element = parent
        if (actions.some((other) => other !== action && holder.contains(other))) break
        card = holder
        parent = holder.parentElement
      }
      return { ariaLabel: action.getAttribute('aria-label'), cardText: card.textContent ?? '', index }
    })
  }, { selector: ACTION_SELECTOR, label: APPLY_LABEL, wantedLabel: srLabel, attribute: APPLY_INDEX_ATTRIBUTE })
}

export async function prepareApply(page: Page, coupon: CouponEntry): Promise<PreparedApply> {
  const target = applyTarget(coupon)
  const choice = chooseApplyButton(await listApplyButtons(page, target.srLabel), target)
  if (!choice.ok) return choice
  const button = page.locator(`[${APPLY_INDEX_ATTRIBUTE}="${choice.index}"]`)
  const ariaLabel = await button.getAttribute('aria-label', { timeout: CLICK_TIMEOUT_MS })
  if (target.srLabel !== '' && ariaLabel !== target.srLabel) return { ok: false, error: APPLY_BUTTON_CHANGED }
  return { ok: true, button }
}

export function isActivateResponse(url: string, campaignId: string): boolean {
  const u = new URL(url)
  return u.pathname.includes(ACTIVATE_PATH) && u.searchParams.get(CAMPAIGN_ID_PARAM) === campaignId
}

export async function clickApply(page: Page, button: Locator, campaignId: string): Promise<Response | null> {
  const response = page.waitForResponse((r) => isActivateResponse(r.url(), campaignId), { timeout: ACTIVATE_TIMEOUT_MS })
    .catch(() => null)
  await button.click({ timeout: CLICK_TIMEOUT_MS })
  return response
}

export function activationStop(status: number): Exclude<PageOutcome, 'ok'> | null {
  if (BLOCKED_STATUSES.includes(status)) return 'blocked'
  return status === HTTP_UNAUTHORIZED ? 'session_expired' : null
}

function mlErrorText(body: Record<string, unknown> | null): string | null {
  const text = [body?.message, body?.error].find((v): v is string => typeof v === 'string' && v.trim() !== '')
  return text ? text.trim().slice(0, ERROR_TEXT_LIMIT) : null
}

function readBody(text: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(text)
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

function isCampaign(value: unknown, campaignId: string): boolean {
  return (typeof value === 'string' || typeof value === 'number') && String(value) === campaignId
}

export function activationOutcome(status: number, text: string, campaignId: string): ActivationOutcome {
  const body = readBody(text)
  const coupon = isRecord(body?.coupon) ? body.coupon : null
  const action = isRecord(coupon?.action) ? coupon.action : null
  if (status === HTTP_OK && action?.type === COUPON_ACTION_LINK) {
    return isCampaign(coupon?.campaignId, campaignId) ? { ok: true } : { ok: false, error: ACTIVATION_OTHER_COUPON }
  }
  return { ok: false, error: `${mlErrorText(body) ?? ACTIVATION_REFUSED} (HTTP ${status})` }
}

function withoutQuery(url: string): string {
  const u = new URL(url)
  return `${u.origin}${u.pathname}`
}

function throwIfGone(page: Page, e: unknown) {
  if (isRunStop(e)) throw e
  throwIfClosed(page, e)
  throwIfStopped(page.url())
}

const NOT_ATTEMPTED: ApplyResult = { attempted: false }

function failed(error: string, click: ClickResponse): ApplyResult {
  return { attempted: true, outcome: { ok: false, error }, click }
}

export async function applyCoupon(page: Page, coupon: CouponEntry): Promise<ApplyResult> {
  throwIfStopped(page.url())
  const campaignId = coupon.parsed.campaignId
  let prepared: PreparedApply
  try {
    prepared = await prepareApply(page, coupon)
  } catch (e) {
    throwIfGone(page, e)
    return NOT_ATTEMPTED
  }
  if (!prepared.ok) return failed(prepared.error, 'not_clicked')
  let response: Response | null
  try {
    response = await clickApply(page, prepared.button, campaignId)
  } catch (e) {
    throwIfGone(page, e)
    return failed(firstLine(e), 'unanswered')
  }
  throwIfStopped(page.url())
  if (!response) {
    throwIfClosed(page, new Error(ACTIVATION_NO_RESPONSE))
    return failed(ACTIVATION_NO_RESPONSE, 'unanswered')
  }
  const stop = activationStop(response.status())
  if (stop) throw stopFor(stop, withoutQuery(response.url()))
  const text = await response.text().catch(() => '')
  return { attempted: true, outcome: activationOutcome(response.status(), text, campaignId), click: 'answered' }
}
