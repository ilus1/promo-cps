'use client'

import { requestMlLogin } from '@/lib/api'
import type { BadgeTone } from '@/lib/badge-tone'
import { isLoginInProgress, type LoginDisplay, type LoginDisplayState } from '@/lib/domain'
import { LOGIN_DISPLAY_LABEL } from '@/lib/labels'
import { ErrorNote } from './ErrorNote'
import { Spinner } from './Spinner'
import { StatusBadge } from './StatusBadge'
import { useBrowserJob } from './useBrowserJob'

const STATE_VIEW: Record<LoginDisplayState, { badge: BadgeTone; detail: string }> = {
  idle: {
    badge: 'badge-muted',
    detail: 'Nenhum login registrado. Se houver uma sessão salva no perfil, a próxima execução mostra se ela ainda vale.',
  },
  queued: {
    badge: 'badge-saved',
    detail: 'A janela do navegador abre em instantes, ou quando a execução em andamento terminar.',
  },
  waiting: {
    badge: 'badge-saved',
    detail: 'Aguardando o login na janela do navegador. Ela fecha sozinha ao terminar.',
  },
  logged_in: {
    badge: 'badge-new',
    detail: 'Login concluído. A janela do navegador foi fechada.',
  },
  unconfirmed: {
    badge: 'badge-saved',
    detail: 'A janela parou na página inicial e o app não conseguiu confirmar o login. Rode um ciclo para testar: se a sessão estiver expirada, ele termina como "sessão expirada".',
  },
  refused: {
    badge: 'badge-warn',
    detail: 'O Mercado Livre não ofereceu nenhuma forma de entrar nesta janela. A causa ainda não é conhecida; evite repetir em seguida.',
  },
  timed_out: {
    badge: 'badge-warn',
    detail: 'A janela foi fechada ou o tempo de espera acabou antes de o app confirmar o login. Tente de novo.',
  },
  failed: {
    badge: 'badge-warn',
    detail: 'O login falhou.',
  },
  session_active: {
    badge: 'badge-new',
    detail: 'O último ciclo leu o Mercado Livre com a sessão salva.',
  },
  session_expired: {
    badge: 'badge-warn',
    detail: 'A última execução encontrou a sessão expirada. Entre de novo para as execuções voltarem a funcionar.',
  },
}

export function LoginButton({ initial }: { initial: LoginDisplay }) {
  const { status, busy, error, start } = useBrowserJob<LoginDisplay>({
    initial,
    isActive: (current) => isLoginInProgress(current.state),
    changeKey: (current) => current.state,
    statusError: (current) => current.error,
    fromMlStatus: (next) => ({ state: next.state, error: next.error }),
    request: requestMlLogin,
  })
  const refused = status.state === 'refused'
  const view = STATE_VIEW[status.state]

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-atomic="true" className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <StatusBadge tone={view.badge} label={LOGIN_DISPLAY_LABEL[status.state]} />
          {view.detail}
        </p>

        {error && <ErrorNote message={error} />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4">
        <p className="max-w-md text-[13px] text-[var(--color-ink-soft)]">
          Uma janela do navegador vai abrir. Entre na sua conta do Mercado Livre e volte aqui.
        </p>
        <button type="button" onClick={start} disabled={busy} className={`btn ${refused ? 'btn-ghost' : 'btn-primary'}`}>
          {busy ? (
            <>
              <Spinner /> Aguardando login...
            </>
          ) : refused ? (
            'Tentar mesmo assim'
          ) : (
            'Entrar no Mercado Livre'
          )}
        </button>
      </div>
    </div>
  )
}
