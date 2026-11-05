'use client'

import { requestMlVerify } from '@/lib/api'
import type { BadgeTone } from '@/lib/badge-tone'
import { isVerifyInProgress, type VerifyState, type VerifyStatus } from '@/lib/domain'
import { VERIFY_STATE_LABEL } from '@/lib/labels'
import { ErrorNote } from './ErrorNote'
import { Spinner } from './Spinner'
import { StatusBadge } from './StatusBadge'
import { useBrowserJob } from './useBrowserJob'

const VERIFY_SUGGESTION_TEXT = 'O último ciclo foi bloqueado por uma verificação do Mercado Livre. Use "Resolver verificação" antes de rodar de novo.'

const STATE_VIEW: Record<VerifyState, { badge: BadgeTone; detail: string }> = {
  idle: {
    badge: 'badge-muted',
    detail: 'Nenhuma verificação pedida desde que o app iniciou.',
  },
  queued: {
    badge: 'badge-saved',
    detail: 'A janela abre em instantes, ou quando a execução em andamento terminar.',
  },
  waiting: {
    badge: 'badge-saved',
    detail: 'Aguardando você resolver a verificação na janela. Ela fecha sozinha ao terminar.',
  },
  cleared: {
    badge: 'badge-new',
    detail: 'Verificação resolvida. A janela foi fechada.',
  },
  closed: {
    badge: 'badge-warn',
    detail: 'A janela foi fechada antes de a verificação ser resolvida. Se o bloqueio continuar, tente de novo.',
  },
  timed_out: {
    badge: 'badge-warn',
    detail: 'O tempo de espera acabou antes de a verificação ser resolvida. Tente de novo.',
  },
  failed: {
    badge: 'badge-warn',
    detail: 'A verificação falhou.',
  },
}

export function VerifyButton({ initial, suggested }: { initial: VerifyStatus; suggested: boolean }) {
  const { status, active, busy, error, start } = useBrowserJob<VerifyStatus>({
    initial,
    isActive: (current) => isVerifyInProgress(current.state),
    changeKey: (current) => current.state,
    statusError: (current) => current.error,
    fromMlStatus: (next) => next.verify,
    request: requestMlVerify,
  })
  const view = STATE_VIEW[status.state]

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-atomic="true" className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <StatusBadge tone={view.badge} label={VERIFY_STATE_LABEL[status.state]} />
          {view.detail}
        </p>
        {error && <ErrorNote message={error} />}
        {suggested && !active && <p className="text-sm font-medium">{VERIFY_SUGGESTION_TEXT}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4">
        <p className="max-w-md text-[13px] text-[var(--color-ink-soft)]">
          Use quando o Mercado Livre pedir uma verificação (captcha). A janela fecha sozinha quando ela for resolvida.
        </p>
        <button type="button" onClick={start} disabled={busy} className="btn btn-primary">
          {busy ? (
            <>
              <Spinner /> Aguardando verificação...
            </>
          ) : (
            'Resolver verificação'
          )}
        </button>
      </div>
    </div>
  )
}
