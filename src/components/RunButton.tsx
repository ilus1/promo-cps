import { Spinner } from './Spinner'

export function RunButton({ busy, disabled, onClick, describedBy }: {
  busy: boolean
  disabled?: boolean
  onClick: () => void
  describedBy?: string
}) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} aria-describedby={describedBy} className="btn btn-primary">
      {busy ? (
        <>
          <Spinner /> Rodando...
        </>
      ) : (
        'Rodar agora'
      )}
    </button>
  )
}
