import { AppHeader } from '@/components/AppHeader'
import { HealthBanner } from '@/components/HealthBanner'
import { LoginButton } from '@/components/LoginButton'
import { StatusBadge } from '@/components/StatusBadge'
import { RunNowButton } from '@/components/RunNowButton'
import { RunsList } from '@/components/RunsList'
import { VerifyButton } from '@/components/VerifyButton'
import { accountRuns } from '@/db/request-runs'
import { recentRuns } from '@/db/runs'
import { autoRunStatus } from '@/ingestion/auto-run'
import { cycleActivity } from '@/ingestion/cycle'
import { runningKinds } from '@/ingestion/recorded-run'
import { HoldToggles } from '@/components/HoldToggles'
import { REQUESTS_LABEL } from '@/lib/hold-view'
import { holdState } from '@/ingestion/request-hold'
import { loginStatus } from '@/ingestion/login'
import { loginDisplay } from '@/ingestion/login-display'
import { verifyStatus } from '@/ingestion/verify'
import { isLoginInProgress } from '@/lib/domain'
import { autoRunView } from '@/lib/auto-run-view'
import { ML_ACCOUNT_LABEL, MONITOR_PANEL_LABEL } from '@/lib/labels'
import { suggestsVerification } from '@/lib/run-view'
import { watchStatus } from '@/ingestion/watch/loops'
import { monitorPanel } from '@/lib/watch/view'

export const dynamic = 'force-dynamic'

export default async function ContaPage() {
  const now = new Date()
  const [{ cycle, finishedCycle, workedCycle, expiredRun, login: lastLogin }, runs, watch, hold] = await Promise.all([
    accountRuns(), recentRuns(), watchStatus(now), holdState(now),
  ])
  const live = loginStatus()
  const activity = cycleActivity()
  const login = loginDisplay(live, lastLogin, workedCycle, expiredRun)
  const auto = autoRunView(autoRunStatus(), now)
  const monitor = monitorPanel(watch, now)
  const active = runningKinds()
  if (isLoginInProgress(live.state)) active.add('login')
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[920px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Conta</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
            Login do Mercado Livre usado para ler seus cupons e os preços dos produtos monitorados no ML.
          </p>
        </div>

        <HealthBanner cycle={finishedCycle} />

        <section className="card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            {ML_ACCOUNT_LABEL}
          </h2>
          <LoginButton key={`${login.state}:${login.error}`} initial={login} />
        </section>

        <section className="card mt-5 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">{REQUESTS_LABEL}</h2>
          <HoldToggles state={hold} />
        </section>

        <section className="card mt-5 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">Ciclo</h2>
          <RunNowButton initial={activity} />
        </section>

        <section className="card mt-5 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            Execução automática
          </h2>
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-soft)]">
            <StatusBadge tone={auto.tone} label={auto.label} />
            {auto.detail}
          </p>
        </section>

        <section className="card mt-5 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            {MONITOR_PANEL_LABEL}
          </h2>
          <div className="mb-4 flex flex-col gap-1 border-b border-[var(--color-line)] pb-4 text-sm text-[var(--color-ink-soft)]">
            {monitor.summary.map((line) => <p key={line}>{line}</p>)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {monitor.sources.map((source) => (
              <div key={source.retailer} className="flex flex-col gap-1 text-sm text-[var(--color-ink-soft)]">
                <h3 className="font-semibold text-[var(--color-ink)]">{source.label}</h3>
                <p className={source.alert ? 'font-medium text-[var(--color-amber)]' : undefined}>{source.state}</p>
                {source.lines.map((line) => <p key={line} className="break-words">{line}</p>)}
              </div>
            ))}
          </div>
        </section>

        <section className="card mt-5 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            Verificação do Mercado Livre
          </h2>
          <VerifyButton initial={verifyStatus()} suggested={suggestsVerification(cycle)} />
        </section>

        <section className="card mt-5 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">Últimas execuções</h2>
          <RunsList runs={runs} active={active} />
        </section>
      </main>
    </>
  )
}
