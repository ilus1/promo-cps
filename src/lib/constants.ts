export const PAGE_SIZE = 48
export const MAX_EXPIRY_FILTER_DAYS = 365
export const ACTIVATION_RETRY_HOURS = 24
export const SECOND_MS = 1000
export const MINUTE_MS = 60 * SECOND_MS
export const LOGIN_TIMEOUT_MS = 10 * MINUTE_MS
export const VERIFY_TIMEOUT_MS = 10 * MINUTE_MS
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
export const RUN_DEADLINE_MS = 2 * HOUR_MS
export const BROWSER_CLOSE_TIMEOUT_MS = 30 * SECOND_MS
export const ENDING_MIN_CAP = 30
export const ENDING_MAX_SHARE = 0.05
export const CENTS_PER_REAL = 100
export const ML_HOST = 'mercadolivre.com.br'
export const ML_IMAGE_HOST = 'http2.mlstatic.com'
export const ML_ORIGIN = `https://www.${ML_HOST}`
export const ML_COUPONS_URL = `${ML_ORIGIN}/cupons/filter?all=true`
export const ML_LOGIN_URL = `${ML_ORIGIN}/cupons`
export const SCHEDULE_JITTER_MINUTES = 15
export const SCHEDULER_CHECK_MS = MINUTE_MS
export const SCHEDULER_BOOT_GRACE_MS = MINUTE_MS
export const SCHEDULER_PLAN_RETRY_MS = 10 * MINUTE_MS
export const SCHEDULER_TICK_COOLDOWN_MS = 30 * MINUTE_MS
export const UNCAPPED_FROM_CENTS = 10_000_000
export const TRIVIAL_SAVING_CENTS = 500
export const SEARCH_TEXT_MAX = 80
export const PERCENT_BASE = 100
export const HALF_DIVISOR = 2
export const MAX_DISCOUNT_PERCENT = PERCENT_BASE
export const MATCH_HIGH_OVERLAP = 0.6
export const MATCH_MEDIUM_OVERLAP = 0.5
export const MATCH_HIGH_MIN_KEY_WORDS = 2
export const MATCH_PRICE_FLOOR_DIVISOR = 5
export const MATCH_PRICE_CEILING_FACTOR = 3
export const COMPARE_QUERY_MAX_WORDS = 10
export const BUSCAPE_SEARCH_URL = 'https://www.buscape.com.br/search?q='
export const AMAZON_ORIGIN = 'https://www.amazon.com.br'
export const AMAZON_SEARCH_URL = `${AMAZON_ORIGIN}/s?k=`
export const FORTICLIENT_BIN = '/usr/bin/forticlient'
export const VPN_CHECK_TIMEOUT_MS = 5 * SECOND_MS
export const VPN_CACHE_MS = 30 * SECOND_MS
export const HOLD_SETTINGS_CACHE_MS = 5 * SECOND_MS
export const HOLD_RECHECK_MS = MINUTE_MS
export const VPN_CLEAR_CACHE_MS = 5 * SECOND_MS
export const KABUM_ORIGIN = 'https://www.kabum.com.br'
export const KABUM_SITEMAP_EXCLUDED: readonly string[] = [
  'institucional', 'hotsites', 'busca', 'promocao', 'lojas', 'marcas', 'servicos-digitais',
]
export const MARKET_UNKNOWN_STREAK_STOP = 3
export const MARKET_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const MARKET_ACCEPT_LANGUAGE = 'pt-BR,pt;q=0.9'
export const MARKET_FETCH_TIMEOUT_MS = 15 * SECOND_MS
export const AMAZON_PAGE_TIMEOUT_MS = 30 * SECOND_MS
export const AMAZON_SESSION_DEADLINE_MS = 30 * MINUTE_MS
export const AMAZON_SESSION_PAGES = 20
export const WATCH_HTTP_INTERVAL_MS = 10 * SECOND_MS
export const WATCH_HTTP_JITTER_MS = 3 * SECOND_MS
export const WATCH_CHROME_INTERVAL_MS = 30 * SECOND_MS
export const WATCH_CHROME_JITTER_MS = 10 * SECOND_MS
export const WATCH_TICK_MS = MINUTE_MS
export const WATCH_IDLE_POLL_MS = SECOND_MS
export const WATCH_BOOT_DELAY_MS = 30 * SECOND_MS
export const WATCH_REFRESH_BATCH = 20
export const WATCH_ERROR_BACKOFF_MS = MINUTE_MS
export const WATCH_ERROR_BACKOFF_MAX_MS = HOUR_MS
export const WATCH_REFRESH_HOURS = 3
export const WATCH_RESOLVE_DAYS = 7
export const WATCH_LOW_WINDOW_DAYS = 30
export const WATCH_DROP_PERCENT_DEFAULT = 10
