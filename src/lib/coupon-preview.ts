import { ML_IMAGE_HOST } from './constants'
import { wordMatchers } from './text-search'

const SECURE_PROTOCOL = 'https:'
const IMAGE_PROTOCOLS = ['http:', SECURE_PROTOCOL]

export const COUPON_PREVIEW_COUNT = 4
export const COUPON_PREVIEW_FETCH_LIMIT = 20

export interface CouponPreview {
  imageUrl: string | null
  altText: string
}

export interface ShownPreview {
  src: string
  alt: string
}

export function safeImageUrl(input: string | null | undefined): string | null {
  if (!input) return null
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  if (!IMAGE_PROTOCOLS.includes(u.protocol) || u.hostname !== ML_IMAGE_HOST) return null
  if (u.username || u.password || u.port) return null
  u.protocol = SECURE_PROTOCOL
  return u.toString()
}

function wordsFound(altText: string, matchers: readonly RegExp[]): number {
  return matchers.filter((matcher) => matcher.test(altText)).length
}

export function selectPreviews(previews: readonly CouponPreview[], text?: string): ShownPreview[] {
  const matchers = text ? wordMatchers(text) : []
  return previews
    .flatMap((preview, position) => {
      const src = safeImageUrl(preview.imageUrl)
      return src ? [{ src, alt: preview.altText, position, found: wordsFound(preview.altText, matchers) }] : []
    })
    .sort((a, b) => b.found - a.found || a.position - b.position)
    .slice(0, COUPON_PREVIEW_COUNT)
    .map(({ src, alt }) => ({ src, alt }))
}
