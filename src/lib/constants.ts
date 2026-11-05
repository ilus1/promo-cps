export const SEARCH_PAGES = 2
export const RUN_EVERY_HOURS_OPTIONS = [1, 3, 6, 12, 24] as const
export const HISTORY_DAYS = 30
export const HISTORY_MIN_DAYS = 7
export const MIN_DROP_RATIO = 0.01
export const STALE_AFTER_HOURS = 72
export const PAGE_SIZE = 48
export const OFERTAS_QUERY_MAX = 2000
export const EAGER_THUMBNAILS = 4
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
export const REALERT_MIN_DROP_CENTS = CENTS_PER_REAL
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
export const MAX_MINIMUM_UNITS = 3
export const PRICE_CHECK_ALERT_ITEMS = 5
export const PRICE_CHECK_ALERT_ITEMS_TOTAL = 15
export const PRICE_CHECK_PRUNE_DAYS = 30
export const SIBLING_CHEAPER_PERCENT = 90
export const MATCH_HIGH_OVERLAP = 0.6
export const MATCH_MEDIUM_OVERLAP = 0.5
export const MATCH_HIGH_MIN_KEY_WORDS = 2
export const MATCH_PRICE_FLOOR_DIVISOR = 5
export const MATCH_PRICE_CEILING_FACTOR = 3
export const SEARCH_RESULT_LIMIT = 20
export const COMPARE_QUERY_MAX_WORDS = 10
export const BUSCAPE_SEARCH_URL = 'https://www.buscape.com.br/search?q='
export const GOOGLE_SHOPPING_URL = 'https://www.google.com/search?tbm=shop&q='
export const AMAZON_ORIGIN = 'https://www.amazon.com.br'
export const AMAZON_SEARCH_URL = `${AMAZON_ORIGIN}/s?k=`
export const MAGALU_SEARCH_URL = 'https://www.magazineluiza.com.br/busca/'
export const PRICE_CHECK_SUMMARY_HOURS = 24
export const LIST_NEVER_PRACTICED_RATIO = 0.7
export const LIST_NEVER_PRACTICED_DAYS = 30
export const SIBLING_EXCLUDED_BASIS_MARKER = 'comprando'
export const PRICE_CHECK_PRIORITY_SAVING_PERCENT = 30
export const FORTICLIENT_BIN = '/usr/bin/forticlient'
export const VPN_CHECK_TIMEOUT_MS = 5 * SECOND_MS
export const VPN_CACHE_MS = 30 * SECOND_MS
export const HOLD_SETTINGS_CACHE_MS = 5 * SECOND_MS
export const HOLD_RECHECK_MS = MINUTE_MS
export const VPN_CLEAR_CACHE_MS = 5 * SECOND_MS
export const KABUM_ORIGIN = 'https://www.kabum.com.br'
export const KABUM_DEPARTMENTS: readonly string[] = [
  'hardware', 'perifericos', 'computadores', 'seguranca', 'gamer', 'eletroportateis', 'automacao',
  'esporte-e-lazer', 'brinquedos', 'geek', 'projetores', 'conectividade', 'tv', 'audio', 'eletrodomesticos',
  'tablets-ipads-e-e-readers', 'telefonia-fixa', 'energia', 'escritorio', 'celular-smartphone', 'espaco-gamer',
  'ar-e-ventilacao', 'cameras-e-drones', 'casa-inteligente', 'moda', 'robotica',
]
export const KABUM_SITEMAP_EXCLUDED: readonly string[] = [
  'institucional', 'hotsites', 'busca', 'promocao', 'lojas', 'marcas', 'servicos-digitais',
]
export const KABUM_PAGE_SIZE = 60
export const KABUM_MAX_PAGES = 400
export const KABUM_PAGE_INTERVAL_MS = 10_000
export const KABUM_PAGE_JITTER_MS = 3_000
export const KABUM_PASS_DAYS = 3
export const AMAZON_PAGE_INTERVAL_MS = 30_000
export const AMAZON_PAGE_JITTER_MS = 10_000
export const AMAZON_DAILY_PAGES = 1_000
export const AMAZON_BESTSELLER_DAILY_PAGES = 200
export const AMAZON_SEARCH_VALID_DAYS = 7
export const AMAZON_UNKNOWN_RETRY_HOURS = 24
export const AMAZON_SESSION_PAGES = 20
export const MARKET_UNKNOWN_STREAK_STOP = 3
export const KABUM_OFFER_VALID_DAYS = 4
export const AMAZON_OFFER_VALID_DAYS = 7
export const MARKET_CANDIDATE_LIMIT = 300
export const MARKET_CHECK_VALID_HOURS = 12
export const MARKET_REMATCH_HOURS = 6
export const MARKET_OFFER_PRUNE_DAYS = 30
export const MARKET_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const MARKET_ACCEPT_LANGUAGE = 'pt-BR,pt;q=0.9'
export const MARKET_FETCH_TIMEOUT_MS = 15 * SECOND_MS
export const MARKET_BOOT_DELAY_MS = 30 * SECOND_MS
export const MARKET_IDLE_RECHECK_MS = 10 * MINUTE_MS
export const MARKET_BUSY_RECHECK_MS = MINUTE_MS
export const MARKET_CHAIN_POLL_MS = SECOND_MS
export const MARKET_ERROR_BACKOFF_MS = MINUTE_MS
export const MARKET_ERROR_BACKOFF_MAX_MS = HOUR_MS
export const MARKET_STATUS_CACHE_MS = 30 * SECOND_MS
export const AMAZON_PAGE_TIMEOUT_MS = 30 * SECOND_MS
export const AMAZON_SESSION_DEADLINE_MS = 30 * MINUTE_MS
export const AMAZON_BESTSELLER_PASS_HOURS = 24
