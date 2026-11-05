import { healthBannerText } from '@/lib/cycle-health'
import type { Run } from '@/db/schema'

export function HealthBanner({ cycle }: { cycle: Pick<Run, 'counts'> | null }) {
  const text = healthBannerText(cycle?.counts)
  if (!text) return null
  return (
    <div role="status" className="mb-4 rounded-lg bg-[var(--color-amber-soft)] px-3 py-2 text-[13px] font-medium text-[var(--color-amber)]">
      <span className="min-w-0 break-words">{text}</span>
    </div>
  )
}
