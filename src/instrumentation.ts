export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startAutoRunScheduler } = await import('@/ingestion/auto-run')
    startAutoRunScheduler()
  } catch (e) {
    console.error('[auto-run] failed to start scheduler', e)
  }
  try {
    const { startMarketCrawlers } = await import('@/ingestion/market/crawlers')
    startMarketCrawlers()
  } catch (e) {
    console.error('[market] failed to start crawlers', e)
  }
}
