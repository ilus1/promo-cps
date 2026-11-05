import Link from 'next/link'
import { accountRuns } from '@/db/request-runs'
import { runningKinds } from '@/ingestion/recorded-run'
import { holdState } from '@/ingestion/request-hold'
import { loginStatus } from '@/ingestion/login'
import { loginDisplay } from '@/ingestion/login-display'
import { formatAgo } from '@/lib/format'
import { holdChipText } from '@/lib/hold-view'
import { LOGIN_DISPLAY_LABEL, ML_ACCOUNT_LABEL } from '@/lib/labels'
import { runStatusText } from '@/lib/run-view'
import { ROUTES } from '@/lib/routes'

const NO_RUN = 'nenhuma execução ainda'

export async function StatusChip() {
  const now = new Date()
  const [{ cycle: run, workedCycle, expiredRun, login: lastLogin }, hold] = await Promise.all([accountRuns(), holdState(now)])
  const held = holdChipText(hold)
  const login = loginDisplay(loginStatus(), lastLogin, workedCycle, expiredRun)
  const cycle = run ? `${runStatusText(run, runningKinds().has('cycle'))}, ${formatAgo(run.startedAt, now)}` : NO_RUN

  return (
    <Link
      href={ROUTES.account}
      className="flex flex-col rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] leading-tight text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-ink-faint)]"
    >
      <span>
        Último ciclo: <span className="font-medium text-[var(--color-ink)]">{cycle}</span>
      </span>
      {held && <span className="font-semibold text-[var(--color-amber)]">{held}</span>}
      <span>
        {ML_ACCOUNT_LABEL}: <span className="font-medium text-[var(--color-ink)]">{LOGIN_DISPLAY_LABEL[login.state]}</span>
      </span>
    </Link>
  )
}
