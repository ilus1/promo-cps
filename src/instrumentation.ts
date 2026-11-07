export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startAutoRunScheduler } = await import('@/ingestion/auto-run')
    startAutoRunScheduler()
  } catch (e) {
    console.error('[auto-run] failed to start scheduler', e)
  }
  try {
    const { startWatch } = await import('@/ingestion/watch/loops')
    startWatch()
  } catch (e) {
    console.error('[watch] failed to start', e)
  }
}
