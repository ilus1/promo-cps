export function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeBackslashes(text: string): string {
  return text.replace(/\\/g, '\\\\')
}

export function notifyBody(text: string): string {
  return escapeBackslashes(escapeMarkup(text))
}
