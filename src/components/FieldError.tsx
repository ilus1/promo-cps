export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="text-[13px] font-medium text-[var(--color-danger)]">
      {message}
    </p>
  )
}
