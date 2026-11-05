# Market catalog Implementation Plan

## Context

**Problem:** Fernando: "seems like the comparison with buscape won't be a thing. It hits the limit
too often. We need to come up with a way to do that on our side. Most likely, we'll need to do the
same match on other retail websites and compare them locally."
- In its first real run (2026-11-03 23:18 to 01:03 UTC) the Buscapé worker made 741 lookups. It
  then got HTTP 403, which the app treats as a block, so it paused for 24 h.
- At that rate the 4,231 priority items (fresh Novos with 30%+ OFF) would take weeks.

**Current State:**
- The price comparison is a background worker. `src/ingestion/price-check/worker.ts:L63`
  (`startPriceWorker`) is started from `src/instrumentation.ts:L9-L14`.
  - It calls `searchBuscape` (`src/ingestion/price-check/buscape-client.ts:L30-L49`) and parses
    the page with `parseBuscapeSearch` (`src/lib/price-compare/parse-buscape.ts`).
  - It matches with `matchCandidates(mlTitle, mlFinalCents, cards: BuscapeCard[])`
    (`src/lib/price-compare/match.ts:L389`, type import at `L4`) and stores one row per check key
    in `price_checks` (`src/db/schema.ts:L131-L146`).
  - The check key is `coalesce(product_id, 'item:' || id)` (`src/db/check-sql.ts:L6`).
- Verdict:
  - `inflatedSql` (`src/db/verdict-sql.ts:L39-L72`) requires `store_count >= INFLATED_MIN_STORES`
    (2) and a second-low price at or below the ML final price.
  - The pure twin is `priceVerdict` (`src/lib/price-compare/verdict.ts:L49-L66`).
- Before each digest, alert candidates are checked on Buscapé:
  `src/ingestion/after-run.ts:L17-L18` (`alertCandidatesToCheck`, `runLiveChecks`).
- "Comparar agora" is `POST /api/items/[id]/compare`
  (`src/app/api/items/[id]/compare/route.ts:L7-L18`). It calls `checkOnDemand`
  (`src/ingestion/price-check/live.ts:L58`).
- The UI reads `priceWorkerStatus(now)` (`src/ingestion/price-check/worker.ts:L111-L128`) in
  `src/app/page.tsx:L41` and `src/app/conta/page.tsx:L33`. The coverage text comes from
  `src/lib/price-check-view.ts:L35-L40`.
- Hold:
  - `requestHold(now)` (`src/ingestion/request-hold.ts:L26`) returns the VPN or manual hold, and
    "Pausar comparação de preços" sets the price-only hold;
  - `chainIdle()` (`src/ingestion/run-chain.ts:L6-L8`) is true when no ML job is queued or
    running.
- ML browser launch: `src/ingestion/browser.ts:L48-L60`. It uses system Chrome
  (`channel: 'chrome'`), `headless: false` on Xvfb (`src/ingestion/xvfb.ts`), and
  `ignoreDefaultArgs: ['--enable-automation']` plus `--disable-blink-features=AutomationControlled`.
- Constants live in `src/lib/constants.ts` (price-check block `L41-L81`). Env is parsed in
  `src/env.ts`, where `ML_PROFILE_DIR` is an absolute path.
- Migrations 0000-0014 are applied (`drizzle/`).

**Goal:**
- The app builds its own market catalog from Kabum (plain HTTP) and Amazon Brasil (system Chrome)
  and matches ML items against it locally.
- Fake discounts are hidden from Ofertas automatically, as before, with no third-party aggregator.

**Approach:** decided with Fernando on 2026-11-04. Full text in
`docs/plans/2026-11-04-market-catalog-design.md`.
- **Sources:** catalogs are crawled into `market_offers`, not searched per item. Magalu walled both
  plain HTTP and Chrome. Buscapé rate-limits.
- **Kabum:** all departments over plain HTTP, 1 page every 10 s, a pass every 3 days.
- **Amazon:**
  - In system Chrome with its own profile, 1 page every 30 s, at most 1,000 pages a day, never
    while an ML job is queued or running.
  - Queue-driven searches, one per check key, with `compareQuery(title)` as the query and a 7-day
    revisit. Plus a daily best-seller pass of at most 200 pages.
- **Backoff per site:** 15 min, 1 h, 4 h, then 24 h. The VPN and manual holds stop both crawlers.
- **Matching:** local, with the existing matcher. Candidates come from a GIN token index.
- **Verdict:** one high-confidence offer at or below the ML final price is enough to flag a fake
  discount. Fernando chose this over 2 offers.

**Scope Boundaries:**
- No Magalu, no VTEX stores and no Buscapé.
- No watchdog notifications for crawler blocks.
- No change to the ML cycle, Buscas, alerts' rules, the matcher's rules or the sibling rule.
- Agents send no requests to any site. Fixtures come only from `/tmp/probe-retailers/` and from
  team-lead captures.

**Key Files:**
- `src/lib/market/types.ts` - shared contract, already written by the team lead. Do not change a
  type without telling the team lead.
- `src/lib/market/*` (new) - pure parsers, tokens, crawl rules, view texts and fixtures.
- `src/db/schema.ts`, `drizzle/0015_*.sql` - new tables.
- `src/db/market-offers.ts`, `src/db/market-searches.ts`, `src/db/crawler-state.ts` (new) -
  repositories.
- `src/ingestion/market/*` (new) - local matcher, Kabum client and crawler, Amazon browser and
  crawler, the loop and its status.
- `src/lib/price-compare/match.ts`, `src/lib/price-compare/verdict.ts`, `src/db/verdict-sql.ts` -
  card type and verdict.
- `src/ingestion/price-check/*`, `src/lib/price-compare/parse-buscape.ts`,
  `scripts/buscape-capture.ts` - removed.
- `src/instrumentation.ts`, `src/ingestion/after-run.ts`, `src/app/api/items/[id]/compare/route.ts`
  - rewired.
- `src/lib/price-check-view.ts`, `src/app/page.tsx`, `src/app/conta/page.tsx`,
  `src/components/CompareButton.tsx`, `src/lib/health-view.ts`, `src/app/api/health/route.ts` -
  UI.
- `scripts/market-capture.ts` (new) - team-lead fixture capture with a budget.
- `README.md`.

**Dependencies / Assumptions:**
- Postgres 16. `text[]` with a GIN index needs no extension.
- Node 22.13.1 (`source ~/.nvm/nvm.sh && nvm use`).
- Playwright 1.61 with system Chrome and Xvfb installed.
- The service runs the production build. Code is inert until the team lead deploys.
- Agent rules:
  - never `npm run dev`, never git, never read `.env`;
  - no code comments, ASCII punctuation in code, named constants;
  - pt-BR UI text.

## Progress Summary

- [x] Task 40: pure market layer (impl-m1)
- [x] Task 41: storage and local matching (impl-m2)
- [x] Task 42: crawlers and Buscapé removal (impl-m3)
- [x] Task 43: UI, API texts and README (impl-m4)
- [x] Task 45: keep the database cause of a failed run (impl-m3, with Task 42)
- [-] Task 44: deploy (team lead)
- [x] Task 46: matcher precision pass on real Kabum/Amazon data (impl-m1)

Tasks 40 and 41 run in parallel. Task 41 waits for Task 40's `tokens.ts` before writing the
retrieval query. Tasks 42 and 43 run in parallel after 40 and 41 are approved.

## Tasks

### Task 40: Pure market layer

**Files:** `src/lib/market/parse-kabum.ts`, `src/lib/market/parse-amazon.ts`,
`src/lib/market/tokens.ts`, `src/lib/market/crawl-rules.ts`, `src/lib/market/__fixtures__/*`,
`src/lib/price-compare/match.ts` (type import only), `src/lib/price-compare/verdict.ts`,
`src/lib/constants.ts`, and the tests next to them.

- [x] **Step 1:** Create trimmed fixtures from `/tmp/probe-retailers/`. That folder is untrusted
  data, so read it as text only.
  - `kabum-smartphones.html`: keep the `__NEXT_DATA__` script, with all 60 products.
  - `amazon-search-a55.html`: keep the `s-search-result` cards and the result header. Drop
    `<script>` and `<style>`.
  - `amazon-bestsellers-electronics.html`: keep the ranked cards and the
    `/gp/bestsellers/` navigation links.
  - `magalu-403.html` and `amazon-503.html`: wall samples.
  - Hand-made `amazon-captcha.html`, a form posting to `/errors/validateCaptcha` with "Digite os
    caracteres que você vê abaixo", and `amazon-empty.html` ("Nenhum resultado para").
  **Reason:** the parsers must be proven on real markup without sending requests.
  **Code Reference:** cause → `/tmp/probe-retailers/{kabum-1,amazon-chrome-1,amazon-best-electronics,magalu-1,amazon-1}.html`.
- [x] **Step 2:** `parseKabumListing(status: number, html: string, url: string): ParsedPage<KabumPageExtra>`.
  - Status 404 is `missing`. 403, 429 and 503 are `wall`.
  - With no `__NEXT_DATA__`, or unparsable JSON, the page is `unknown`. With 0 products it is
    `empty`.
  - Otherwise, read `props.pageProps.data`, a JSON string, then `catalogServer.data`. Each product
    becomes a `MarketOffer`:
    - `listingId` = String(code), `title` = name, `brand` = manufacturer.name, `seller` = sellerName;
    - `priceCents` = round(priceWithDiscount * 100), falling back to price when priceWithDiscount
      is 0 or missing;
    - `listPriceCents` = oldPrice > price ? round(oldPrice * 100) : null;
    - `inStock` = available === true, `source` = 'kabum_catalog';
    - `url` = `https://www.kabum.com.br/produto/<code>/<friendlyName>`.
    - A product with no name or a non-positive price is dropped.
  - Extra comes from `catalogServer.meta`: page.number, totalPagesCount and totalItemsCount.
  **Reason:** Kabum pages carry their data as JSON, so no HTML scraping is needed. PIX is the
  at-vista price, comparable to ML's final price.
  -- **MODIFIED** (review-m1 I2, I3, M5):
  - The signature is `parseKabumListing(status, html, url, now)`.
  - **Campaign price.** When `offer` is active (`startsAt <= now < endsAt`, epoch seconds):
    - `priceCents` = round((offer.priceWithDiscount || offer.price) * 100);
    - `regularPriceCents` = the top-level PIX price (the rule above);
    - `priceUntil` = endsAt;
    - `listPriceCents` = the top-level card price when it is above `priceCents`.
    Otherwise the rule above applies, with `regularPriceCents` and `priceUntil` null. 925350
    ("AGORA OU NUNCA") is pinned at 849999 with a regular price of 1299900.
  - Products with `flags.isOpenbox === true` are skipped.
  - A page whose products all fail to parse is `unknown` ("produtos ilegíveis"), not empty
    results. A page with only open-box products is results with no offers.
  - The `url` argument gives the page number when the meta has none.
  - The fixtures keep `offer` and `flags`. `kabum-hardware.html`, a department root with
    8,632 items on 144 pages, proves roots share the `catalogServer` shape.
  **Code Reference:** cause → `/tmp/probe-retailers/kabum-1.html` (`__NEXT_DATA__`); impacted →
  `src/lib/market/types.ts` (`MarketOffer`, `KabumPageExtra`).
- [x] **Step 3:** `kabumListingUrl(slug: string, page: number): string`, which returns
  `https://www.kabum.com.br/<slug>?page_number=<page>&page_size=60`. Add
  `KABUM_DEPARTMENTS: readonly string[]` with these slugs:
  - hardware, perifericos, computadores, celular-smartphone, tv, audio, games;
  - eletrodomesticos, eletroportateis, ar-e-ventilacao, casa-inteligente, cameras-e-drones;
  - tablets-ipads-e-e-readers, ferramentas, seguranca, energia, escritorio, espaco-gamer.

  Add `KABUM_PAGE_SIZE = 60` and `KABUM_MAX_PAGES = 400`, both in `src/lib/constants.ts`.
  -- **MODIFIED:**
  - `KABUM_DEPARTMENTS` is now the 26 product departments of Kabum's live sitemap index, the
    fallback list: hardware, perifericos, computadores, seguranca, gamer, eletroportateis,
    automacao, esporte-e-lazer, brinquedos, geek, projetores, conectividade, tv, audio,
    eletrodomesticos, tablets-ipads-e-e-readers, telefonia-fixa, energia, escritorio,
    celular-smartphone, espaco-gamer, ar-e-ventilacao, cameras-e-drones, casa-inteligente, moda,
    robotica. "games" and "ferramentas" don't exist.
  - robots.txt does list a sitemap. Added `kabumSitemapIndexUrl()` (`/sitemap.xml`) and
    `parseKabumSitemapIndex(status, xml): string[] | null`. It gives the `/sitemap/<slug>.xml`
    slugs in index order, minus `KABUM_SITEMAP_EXCLUDED` (institucional, hotsites, busca, promocao,
    lojas, marcas, servicos-digitais). It gives null on a non-200 status, or when no product slug
    remains (review-m1 I4).
  - Fixture `kabum-sitemap-index.xml`, a team-lead capture. A test pins its parsed list to
    `KABUM_DEPARTMENTS`.
  **Reason:** the home page has no menu, so the list is fixed. The crawler logs and skips slugs
  that turn out missing or empty. robots.txt allows plain category pages and forbids sort
  variants, so no sort parameter is sent.
  **Code Reference:** cause → `/tmp/probe-retailers/kabum-robots.txt`, `kabum-1.html`
  (`page_number=2&page_size=60`).
- [x] **Step 4:** `parseAmazonSearch(status: number, html: string): ParsedPage<AmazonSearchExtra>`
  and `amazonSearchUrl(query: string)`, which returns `https://www.amazon.com.br/s?k=<encoded>`.
  - A page is `wall` on status 403, 429 or 503, on a `validateCaptcha` form, on "Digite os
    caracteres", or on the "Algo deu errado" page.
  - "Nenhum resultado para" is `empty`. A page with no result cards is `unknown`.
  - Each card with `data-asin` gives an offer:
    - `title` from the card's h2 text;
    - `priceCents` from the first `.a-offscreen` inside `.a-price` that is not `.a-text-price`;
    - `listPriceCents` from `.a-price.a-text-price .a-offscreen`;
    - `inStock` = true, because Amazon search lists in-stock offers;
    - `url` = `https://www.amazon.com.br/dp/<asin>`, `source` = 'amazon_search', brand and
      seller null.
    - A card without a price is dropped.
  - Parse with regex or string scanning in the same style as `src/lib/price-compare/parse-buscape.ts`.
    Add no dependency.
  **Reason:** the crawler parses `page.content()` with a pure function so it is testable.
  -- **MODIFIED:**
  - The list price needs `data-a-strike="true"`, because the installment ("12x de") uses the same
    `.a-price.a-text-price` classes.
  - The wall and empty markers are read with scripts and styles removed. The empty check applies to
    every Amazon page.
  - 404 is `missing`. Repeated ASINs keep the first card.
  - `resultCount` is the number of distinct result cards, priced or not.
  - Cards present but no offer read is `unknown` ("cards ilegíveis"), so markup drift backs off
    instead of reading as success (review-m1 I3).
  - The last card ends at `data-component-type="s-pagination"` when present (review-m1 M2).
  - Amazon offers have `regularPriceCents` and `priceUntil` null.
  **Code Reference:** cause → `/tmp/probe-retailers/amazon-chrome-1.html`; impacted →
  `src/lib/price-compare/parse-buscape.ts:L1-L20` (amount parsing via `parseAmountCents`).
- [x] **Step 5:** `parseAmazonBestsellers(status: number, html: string, url: string): ParsedPage<AmazonBestsellerExtra>`.
  - It uses the same wall rules as the search parser.
  - Cards come from the ranked items, using the `data-asin` and `p13n-sc-price` markup in the
    fixture, with `source` = 'amazon_bestsellers'.
  - `nextPageUrl` is the `pg=2` link when the current page is `pg=1` or has no `pg`.
  - `nodeUrls` holds the absolute `/gp/bestsellers/<dept>/<node>` links, deduplicated, with the
    `ref=` segment removed.

  Also add `amazonBestsellersRootUrl()` and `parseAmazonBestsellerRoot(html)`, which returns the
  department URLs (`/gp/bestsellers/<dept>`). The root shape is unknown, so the root parser takes
  every `/gp/bestsellers/<slug>` link except the page itself.
  **Reason:** the daily best-seller pass widens the catalog beyond the queue.
  -- **MODIFIED:**
  - The root parser is `parseAmazonBestsellerRoot(status, html): ParsedPage<AmazonBestsellerExtra>`,
    so the root gets the wall rules. Its `nodeUrls` are the department URLs, `nextPageUrl` is null,
    and `offers` holds any ranked cards on the page.
  - `nodeUrls` leave out the page itself. `nextPageUrl` is the `pg=2` link of the same path.
  **Code Reference:** cause → `/tmp/probe-retailers/amazon-best-electronics.html`.
- [x] **Step 6:** `src/lib/market/tokens.ts`:
  - `offerTokens(title): string[]` gives unique tokens built with the matcher's normalization
    (lowercase, folded accents, split on non-alphanumerics, minus `FILLER_WORDS`).
  - `retrievalTerms(mlTitle): string[]` gives the first name-zone word plus up to 2 model words
    (tokens with both letters and digits). With no model word, it gives the first two name-zone
    words.
  - To build the name zone, export from `match.ts` the minimal helper it already uses, with no
    rule change.
  - Required: for every high pair in `match-pairs.test.ts`, and every high card in
    `match-fixtures.test.ts`, `retrievalTerms(ml)` must be a subset of `offerTokens(candidate)`.
    Where a pair fails, adjust the term rule (not the matcher) and say so in the report.
  - Report to the team lead as soon as `tokens.ts` is final, because Task 41 needs it.
  **Reason:** candidate retrieval must not lose matches the matcher would accept, or fakes are
  missed.
  -- **MODIFIED:**
  - **Term rule** (review-m1 I1): `retrievalTerms(mlTitle): RetrievalTerms` mirrors `hasAnchor`.
    - `all` = the anchor's name words (up to 3).
    - `any` = the model words; with none, the hard sizes; with none, the plain numbers.
    - When `any` has exactly one word, it moves into `all`.
    - The SQL is `tokens @> all and (cardinality(any) = 0 or tokens && any)`. `retrieves(terms,
      tokens)` is its pure twin.
    - Both lists empty means no terms (`hasRetrievalTerms`).
  - **Recall:**
    - The plan rule ("first word + up to 2 model words") lost the VAIO pairs: `fe16` but not
      `ddr5`.
    - The first fix (all name words + the sole model word) left titles with several model words
      on name words alone, for example "Celular Samsung Galaxy A55 ... Sm-a556e" gave
      [samsung, galaxy].
    - The current rule misses 0 of review-m1's 1,158 accepted fixture pairs, with 0 empty terms.
    - `tokens.test.ts` checks every distinct pair of fixture titles that the matcher accepts.
  - **Helper:** `match.ts` exports `titleTerms(text)`, with `tokens`, `nameWords`, `modelWords`,
    `hardSizes` and `numbers`. `offerTokens` also adds the name word glued to a generic word
    (`notebookvaio` gives `vaio`), as the anchor accepts.
  - **Labelled data:** moved to `src/lib/price-compare/match-labels.ts`, with assertions unchanged.
  **Code Reference:** cause → `src/lib/price-compare/match.ts:L35-L40` (`NAME_ANCHOR_WORDS`,
  `GENERIC_TITLE_WORDS`), `src/lib/price-compare/clean-title.ts:L4-L33`.
- [x] **Step 7:** Replace `BuscapeCard` with `MarketCard` from `@/lib/market/types` in `match.ts`.
  The shape is identical. Keep `parse-buscape.ts` compiling until Task 42 deletes it.
  **Reason:** the matcher must not depend on a module that is going away.
  **Code Reference:** cause → `src/lib/price-compare/match.ts:L4`, `L389`.
- [x] **Step 8:** `src/lib/market/crawl-rules.ts` (pure):
  - `BACKOFF_STEPS_MS = [15 min, 1 h, 4 h, 24 h]`, with `nextBackoff(level)` giving
    `{ level: min(level + 1, last), untilMs }`;
  - `dayKey(now)` in America/Sao_Paulo, and `withinBudget(pagesToday, budget)`;
  - `pageDelayMs(intervalMs, jitterMs, random)`;
  - `kabumPassDue(lastPassStartedAt, now)`, with a 3-day interval;
  - `unknownStreakBlocks(streak)`, which blocks at 3;
  - `pageOutcome(kind)`, mapping results to reset, wall to block, unknown to streak, and
    missing or empty to neutral.

  Constants go in `src/lib/constants.ts`:
  - `KABUM_PAGE_INTERVAL_MS = 10_000`, `KABUM_PAGE_JITTER_MS = 3_000`, `KABUM_PASS_DAYS = 3`;
  - `AMAZON_PAGE_INTERVAL_MS = 30_000`, `AMAZON_PAGE_JITTER_MS = 10_000`;
  - `AMAZON_DAILY_PAGES = 1_000`, `AMAZON_BESTSELLER_DAILY_PAGES = 200`, `AMAZON_SEARCH_VALID_DAYS = 7`;
  - `AMAZON_SESSION_PAGES = 20`, `MARKET_UNKNOWN_STREAK_STOP = 3`;
  - `KABUM_OFFER_VALID_DAYS = 4`, `AMAZON_OFFER_VALID_DAYS = 7`;
  - `MARKET_CANDIDATE_LIMIT = 300`, `MARKET_CHECK_VALID_HOURS = 12`, `MARKET_REMATCH_HOURS = 6`;
  - `MARKET_OFFER_PRUNE_DAYS = 30`.
  **Reason:** the pace, budget and backoff Fernando chose ("Moderate") must be single named values
  with pure, tested decisions.
  -- **MODIFIED:**
  - `nextBackoff(level, now)` takes `now`, so `untilMs` is an absolute epoch ms. Level 0 means no
    backoff, and the level stays at 4 (24 h).
  - Added `pagesToday(savedDayKey, savedPages, now)`, `kabumNextPassAt(lastPassStartedAt)` and
    `healthAfterPage({backoffLevel, unknownStreak}, kind, now)`, the shared per-page transition.
  - `TIME_ZONE` is now exported from `src/lib/format.ts`.
  - `KABUM_DEPARTMENTS`, `KABUM_ORIGIN` and `AMAZON_ORIGIN` live in `constants.ts`.
  - `HTTP_SERVICE_UNAVAILABLE` was added to `http-status.ts`.
  - `PageOutcome` is a plain union type, with no exported list (review-m1 M3).
  - A test covers the 2018 daylight saving day key (review-m1 M4).
  - For Task 41's prune, `prune-rules.ts` has `PruneCounts.marketOffers` and
    `PruneCutoffs.marketOffers` (`MARKET_OFFER_PRUNE_DAYS`).
  **Code Reference:** cause → `src/lib/constants.ts:L41-L81` (the old price-check block, which
  Task 42 removes).
- [x] **Step 9:** Verdict, pure. `priceVerdict` becomes inflated when there is a valid high check,
  `item.showsSaving`, and `item.finalCents >= valid.marketLowCents`. Remove the `storeCount` and
  `secondLowCents` conditions and `INFLATED_MIN_STORES`. Task 41 changes the SQL twin; keep
  `INFLATED_MIN_STORES` until then if `verdict-sql.ts` still imports it.
  **Reason:** Fernando chose "1 offer at or below".
  -- **MODIFIED:**
  - The pure validity window is `MARKET_CHECK_VALID_HOURS`, as in the new `matchedSince`.
  - `VerdictCheck` lost `secondLowCents` and `storeCount`. `INFLATED_MIN_STORES` was removed once
    nothing imported it.
  - For Task 41's SQL band, `match.ts` exports `priceBand(finalCents)`, and the band constants moved
    to `constants.ts` as `MATCH_PRICE_FLOOR_DIVISOR` and `MATCH_PRICE_CEILING_FACTOR`.
  **Code Reference:** cause → `src/lib/price-compare/verdict.ts:L49-L56`; impacted →
  `src/db/verdict-sql.ts:L39-L72`.
- [x] **Verify:** `npx vitest run src/lib/market src/lib/price-compare` passes. `npx tsc --noEmit`
  and `npx eslint src/lib` are clean. Report the recall result of Step 6.
  -- After review-m1: `npx vitest run src/lib` passes 1,498 tests; tsc and eslint are clean.
  `PruneCounts` gained `marketOffers`, and `pruneLine` ends with "N oferta(s) de mercado".

### Task 41: Storage and local matching

**Files:** `src/db/schema.ts`, `drizzle/0015_*.sql` (generated with `npx drizzle-kit generate`,
never applied by the agent), `src/db/market-offers.ts`, `src/db/market-searches.ts`,
`src/db/crawler-state.ts`, `src/db/verdict-sql.ts`, `src/db/check-sql.ts`,
`src/ingestion/market/match-local.ts`, `src/ingestion/market/rematch.ts`, and the tests next to
them.

- [x] **Step 1:** Add the tables to the schema:
  - `market_offers`:
    - `key` text primary key, formed as `<retailer>:<listingId>`;
    - `retailer`, `listing_id`, `title`, `url` and `source`, all text not null;
    - `brand` and `seller` text;
    - `price_cents` int not null, and `list_price_cents` int;
    - `in_stock` bool not null;
    - `tokens` text[] not null;
    - `first_seen_at` and `last_seen_at`, timestamps not null.
    - Indexes: GIN on tokens, (retailer, last_seen_at), and last_seen_at.
  - `market_searches`: `key` text primary key (the check key), `query` text not null,
    `searched_at` timestamp, `status` text, `result_count` int and `priority_at` timestamp. Index
    on searched_at.
  - `crawler_state`: `site` text primary key, then:
    - `cursor` jsonb not null default {};
    - `backoff_level` int not null default 0, and `blocked_until` timestamp;
    - `day_key` text, and `pages_today` int not null default 0;
    - `last_page_at`, `pass_started_at` and `bestsellers_at`, timestamps;
    - `last_error` text, and `updated_at` timestamp not null default now.

  Generate migration 0015. Do not run `drizzle-kit migrate`; the team lead applies it in an idle
  window. -- **MODIFIED:**
  - Regenerated as `drizzle/0015_soft_brood.sql`, not applied. The tokens GIN index is
    `WITH (fastupdate=false)`, because the pending list doubled candidate query time (review M3). It also has the
    `regular_price_cents` int and `price_until` timestamptz columns, both nullable, for Kabum
    campaign prices (Task 40 review contract).
  - `retailer` and `site` use the `RETAILERS` enum type, `status` uses `PAGE_KINDS`, and
    `cursor` is typed `Record<string, unknown>`.
  - The team lead found a production bug: Conta's inflated count seq-scanned items for each
    price_checks row. So 0015 also adds `items_check_key_idx` on
    `(coalesce(product_id, 'item:' || id))`, hand-edited to `CREATE INDEX IF NOT EXISTS`
    because the team lead creates it by hand first.
  - `checkKeySql` and the index share `checkKeyOf` (`src/db/check-key.ts`). It renders `'item:'`
    as an SQL literal, not a parameter, so generic plans still match the index.
  **Reason:** the catalog, the Amazon search queue and the crawler cursors must survive restarts.
  **Code Reference:** cause → `src/db/schema.ts:L131-L159` (the `priceChecks` and `appSettings`
  style to follow).
- [x] **Step 2:** `src/db/market-offers.ts`:
  - `upsertOffers(offers, now)` sets `tokens` from `offerTokens(title)`. On conflict it updates
    title, price, list price, stock, seller, brand, url and `last_seen_at`. `first_seen_at` keeps
    its first value.
  - `candidateOffers(terms, finalCents, now)` returns valid offers with `tokens @> terms`, inside
    the matcher's price band, cheapest first, limited to `MARKET_CANDIDATE_LIMIT`.
    - Valid means `in_stock`, and `last_seen_at` within the retailer's window.
    - The band is `price_cents * MATCH_PRICE_FLOOR_DIVISOR >= finalCents` and
      `price_cents <= MATCH_PRICE_CEILING_FACTOR * finalCents`.
    -- **MODIFIED:** the price band and the `finalCents` parameter were added on impl-m1's advice,
    so cheap accessories can't fill the cap for broad terms.
  - `validOfferCounts(now)` counts per retailer.
  - `pruneOffers(now)` deletes offers unseen for `MARKET_OFFER_PRUNE_DAYS`. Hook it into the
    existing prune.
  -- **MODIFIED:** duplicates within one upsert keep the last offer per key, and the conflict
  also refreshes `tokens`. `validOfferCondition(now)` is the single validity condition.
  - `candidateOffers(terms: RetrievalTerms, finalCents, now)` uses
    `tokens @> all and (cardinality(any) = 0 or tokens && any)`, with each list as one text[]
    parameter. With both lists empty there is no query.
  - It also requires the effective price between `priceBand(finalCents)`'s bounds, so cheap
    accessories can't fill the 300-row cap. The team lead decided this on 2026-11-04.
  - `effectivePriceSql(now)` is the campaign price while `price_until` is null or in the future,
    otherwise `coalesce(regular_price_cents, price_cents)`. `price_until = now` counts as ended.
    It drives the band, the cheapest-first order and the `priceCents` handed to the matcher.
  - `upsertOffers` writes `regular_price_cents` and `price_until`, and the conflict overwrites
    them.
  - `upsertOffers` writes in chunks of 500 (`OFFER_UPSERT_CHUNK`).
  - `pruneOffers` reads `pruneCutoffs(now).marketOffers`.
  - `daysBefore` and `hoursBefore` come from `src/lib/freshness.ts`.
  - Review N2: candidates are ordered by how many `any` terms they hold, descending
    (`cardinality(array(select unnest(tokens) intersect select unnest(any)))`). The effective
    price and then the key break ties, so a title with only `any` terms (for example "B550M Aorus
    Elite AM4 DDR4") ranks the board above RAM and coolers.
  - `pruneOffers(now, tx)` runs inside `pruneOld`'s lock-limited transaction. Its count is
    returned as `PruneCounts.marketOffers`, a field impl-m1 is adding.
  **Reason:** every match reads from this table, so validity must sit in one condition.
  **Code Reference:** impacted → `src/lib/market/tokens.ts` (Task 40 Step 6), and the existing
  prune caller (grep `PRICE_CHECK_PRUNE_DAYS`).
- [x] **Step 3:** `src/db/market-searches.ts`:
  - `dueSearches(now, limit)` returns `{key, query, itemIds}`. It uses the same three target
    tiers as `src/db/price-worker.ts`, grouped by check key:
    - Salvos;
    - fresh Novos with `ml_discount_pct >= 30`, biggest first;
    - other fresh Novos that show a saving.
    - A key is due when `market_searches.searched_at` is null or older than
      `AMAZON_SEARCH_VALID_DAYS`, and keys with a `priority_at` come first.
    - The query is `compareQuery(title)` of the key's most recent item.
  - `recordSearch(key, query, status, resultCount, now)`.
  - `prioritizeSearch(key, query, now)` sets `priority_at` when the key is not fresh, and returns
    whether it queued.
  - `searchCounts(now)` returns `{ searched, due }`.

  Reuse the tier SQL from `src/db/price-worker.ts`; don't copy it. If that file is deleted in
  Task 42, its tier builder moves here.
  -- **MODIFIED:** `price-worker.ts` now exports `targetTiers(now)` (freshness included), and
  both `nextItemsToCheck` and `dueSearches` read it. Queued keys (`priority_at`, FIFO) come
  first with their stored query and every item of the key. Tier keys use
  `compareQuery(title)` of the latest item, and a key with an empty query is skipped. Any
  `recordSearch` makes the key not due for 7 days and clears `priority_at`, so the crawler
  should not record walls. Review M6: `DueSearch` is `{ key, query }` with no `itemIds`, because
  the crawler calls `rematchKeys([key])`. A key whose last status is `unknown` is due again
  after `AMAZON_UNKNOWN_RETRY_HOURS` (24 h). Results and empty pages keep the 7-day revisit.
  `searchFreshSince(now)` is the single CASE used by the due, fresh and priority conditions.
  **Reason:** one Amazon search must serve every ML listing of a product, and Salvos must go
  first.
  **Code Reference:** cause → `src/db/price-worker.ts` (`nextItemsToCheck`, tiers), and
  `src/db/check-sql.ts:L6` (`checkKeySql`).
- [x] **Step 4:** `src/db/crawler-state.ts` provides `loadCrawlerState(site)`, which creates the
  row if it is missing, and `saveCrawlerState(site, patch)`. Both are typed with a
  `CrawlerStateRow`.
  **Reason:** this is the state each crawler persists.
  **Code Reference:** impacted → Task 42 crawlers.
- [x] **Step 5:** `src/ingestion/market/match-local.ts`:
  - `matchItemLocally(item: CheckItem, now, deps)` runs `retrievalTerms(item.title)`, then
    `candidateOffers`, then maps each offer to a `MarketCard`:
    - `store` is `Kabum` or `Amazon`, plus ` (<seller>)` when a Kabum seller exists and is not
      KaBuM!;
    - `storeCount` is 1.
  - It then runs `matchCandidates(item.title, item.finalCents, cards)` and saves the
    `price_checks` row through `saveCheck`:
    - `status` is matched when the confidence is not null, otherwise no_match;
    - `query` is `compareQuery(item.title)`, and `source_url` is the cheapest matched offer's URL,
      or `''` when there is none;
    - `reason` is null.
  - With no terms, it saves no_match without querying.
  -- **MODIFIED:** it returns `CompareOutcome`, and `deps` defaults to
  `{ candidates: candidateOffers, save: saveCheck }`.
  **Reason:** every verdict input now comes from local data.
  **Code Reference:** cause → `src/ingestion/price-check/check-item.ts:L62-L85` (the row shape
  to keep), `src/db/price-checks.ts:L17-L21` (`saveCheck`).
- [x] **Step 6:** `src/ingestion/market/rematch.ts`:
  - `rematchKeys(keys, now)` re-matches the items of given check keys. The Amazon crawler calls
    it after each search.
  - `rematchTargets(now)` re-matches every target: Salvos plus all fresh Novos, in batches of 500,
    yielding to the event loop between batches.
  - `startRematchLoop()` runs `rematchTargets` at boot plus `MARKET_REMATCH_HOURS`, and on demand
    through `requestRematch()`, which is coalesced so only one pass runs at a time. A request made
    during a pass runs once after it.
  - Validity: `check-sql.ts` `matchedSince` and the no_match window both become
    `MARKET_CHECK_VALID_HOURS`, so the verdict only reads checks the loop refreshes.
  - `after-run.ts`: replace `alertCandidates` and `runChecks` with a local re-match of the alert
    candidates, then call `requestRematch()`.
  -- **MODIFIED:**
  - Every key is matched once, with its most recently observed item. Targets are all Salvos
    plus the fresh Novos (`src/db/match-targets.ts`).
  - The boot delay is 30 s (`REMATCH_BOOT_DELAY_MS`).
  - `validCheckCondition` is now `status in (matched, no_match)` within 12 h.
  - `AnnounceDeps.runChecks` is `(items) => Promise<void>`. after-run runs `rematchItems`, then
    `requestRematch()` in a `finally`.
  - `startRematchLoop()` is not wired yet; Task 42's `startMarketCrawlers` starts it.
  - Review M1, M2, M4 and M8:
    - each 500-key batch is matched, then saved with one multi-row `saveChecks` upsert;
    - a failing batch is logged and the pass continues;
    - `afterRun` calls `requestRematch()` after the announce settles, for runs where
      `checkPlan(run).alerts` holds;
    - the alert log tag is `[market]`.
  **Reason:** checks must reflect new offers within hours, and alerts must see local verdicts
  before digests.
  **Code Reference:** cause → `src/db/check-sql.ts:L12-L21`, `src/ingestion/after-run.ts:L17-L18`;
  impacted → `src/ingestion/announce.ts` (deps type).
- [x] **Step 7:** Verdict SQL. `inflatedSql` keeps the valid high check and `showsSaving`, and
  uses `market_low_cents <= finalPrice`. Drop the `store_count` and second-low terms and
  `INFLATED_MIN_STORES`. Keep `priceVerdict` and `inflatedSql` equivalent.
  **Reason:** Fernando chose "1 offer at or below".
  **Code Reference:** cause → `src/db/verdict-sql.ts:L39-L72`.
- [x] **Verify:**
  - `npx tsc --noEmit`, lint and the full `npx vitest run` pass.
  - Pinned-SQL tests cover the validity window, `tokens @>` and the tier order.
  - Read-only, run `candidateOffers` and `dueSearches` against the database (no rows yet in
    market_offers, so check that the SQL is valid with an EXPLAIN). Do not insert.
  -- **MODIFIED:**
  - tsc and lint are clean. vitest: 2551 passed, 1 failed (144 files). The failure is
    `check-item.test.ts` "only one store", which expects the old two-store rule. Task 42 deletes
    that folder.
  - The new tables don't exist yet, so EXPLAIN ran each select with read-only shadow CTEs of
    the same shape. Every query planned.
  - The tier-3 search query ran in 110 ms and `searchCounts` in 374 ms (EXPLAIN ANALYZE).
- [x] **Step 8:** Add an expression index on the check key.
  - The schema gets `items_check_key_idx` on `(coalesce(product_id, 'item:' || id))`. In 0015 it
    is `CREATE INDEX IF NOT EXISTS`, because the team lead creates it in production first.
  - `checkKeySql` renders the `'item:'` prefix as an SQL literal, not a parameter.
  **Reason:** found live on 2026-11-04 22:30 UTC. Conta's `inflatedItemCount` took 2 to 3 min
  with about 740 `price_checks` rows. Its plan ran a Seq Scan on `items` (about 110k rows, with
  the coupon subplan on each row) for every high check, because nothing indexes the key
  expression. A parameter in the expression would also stop the index matching once Postgres
  uses a generic plan.
  **Code Reference:** cause → `src/db/check-sql.ts:L6` (`checkKeySql`), `src/db/verdict-sql.ts`
  (`inflatedSql` prefilter); impacted → `src/db/deals.ts:L254-L258` (`inflatedItemCount`),
  `src/db/market-searches.ts`, `src/ingestion/market/rematch.ts`.

### Task 42: Crawlers and Buscapé removal

**Files:** `src/ingestion/market/kabum-client.ts`, `kabum-crawler.ts`, `amazon-browser.ts`,
`amazon-crawler.ts`, `crawlers.ts` (loop and status), `src/instrumentation.ts`,
`src/app/api/items/[id]/compare/route.ts`, `src/env.ts`, `scripts/market-capture.ts`. Deletions:
`src/ingestion/price-check/*`, `src/lib/price-compare/parse-buscape.ts` and its test and fixtures,
`scripts/buscape-capture.ts`, and the Buscapé constants.

- [x] **Step 1:** `kabum-client.ts`: `fetchKabumPage(url, fetchImpl)` uses the UA and
  Accept-Language headers that `buscape-client.ts` used, now as `MARKET_USER_AGENT` and
  `MARKET_ACCEPT_LANGUAGE`, with a 15 s timeout.
  - It returns `{status, html}`, or `{status: 0, html: ''}` with the reason on a network error or
    timeout.
  **Reason:** the parser decides the page kind from the status and the body.
  **Code Reference:** cause → `src/ingestion/price-check/buscape-client.ts:L1-L49`.
  -- **MODIFIED:** it returns `FetchedPage {status, html, reason?}` (`crawl-page.ts`), shared with
  the Amazon loader. A non-2xx body is discarded (`html: ''`), since the parsers decide those from
  the status. The reason is "tempo esgotado" on the 15 s timeout (`MARKET_FETCH_TIMEOUT_MS`), else
  `errorText(e)`. The crawler appends it to the parser reason ("sem resposta: tempo esgotado").
- [x] **Step 2:** `kabum-crawler.ts`: `kabumStep(deps)` crawls one page and returns the next
  sleep.
  - **Departments.** At the start of each pass, fetch `kabumSitemapIndexUrl()` (one page, paced
    like any other) and use `parseKabumSitemapIndex`. When it returns null, use
    `KABUM_DEPARTMENTS`.
    - Store the department list in the cursor, so a restart mid-pass keeps the same list.
    - A wall on the index counts like any wall.
    -- **MODIFIED:** the team lead found the sitemap index on 2026-11-04; it replaces the fixed
    list as the primary source.
  - **Due check.** Compute when the next page is allowed:
    - the hold (`requestHold`; any kind holds);
    - `blocked_until`;
    - whether the pass is due;
    - the cursor `{departmentIndex, page}`.
  - **Fetch and parse** the page, then:
    - **results:** `upsertOffers`, then advance a page;
    - **missing or empty:** skip the department, logging once per pass;
    - **wall or unknown:** apply `crawl-rules`, and save `backoff_level` and `blocked_until`.
  - **Department end.** At the end of a department, call `requestRematch()`. At the end of the
    pass, reset the cursor and set the next pass time.
  - **Persist** `crawler_state` after every page. Log with the `[market]` tag.
  **Reason:** this is Fernando's moderate pace, resumable across restarts.
  **Code Reference:** impacted → `src/lib/market/crawl-rules.ts`, `src/db/crawler-state.ts`.
  -- **MODIFIED:**
  - `kabumStep` returns `CrawlStep {sleepMs, waitingFor}`, so the status knows why it waits.
    Waits are capped at 10 min (`MARKET_IDLE_RECHECK_MS`) and re-checked. A page is never sent
    sooner than `KABUM_PAGE_INTERVAL_MS` after `last_page_at`, even after a restart.
  - The cursor is `{departments, index, page, totalPages, unknownStreak}`. `crawler_state` has no
    streak column, so the unknown streak lives in the cursor.
  - Index: a wall backs off and starts no pass. Any other unreadable index (404, 5xx, no slugs,
    network) uses `KABUM_DEPARTMENTS` and logs why.
  - N3 (review-m1): an unknown page always moves the cursor past it and is logged, so a page is
    never fetched twice in a pass. It still counts in the streak; the third in a row starts the
    backoff, and the crawl resumes at the next page. An unknown first page ends the department,
    since its page count is not known yet.
  - Missing or empty ends the department; page 1 logs "skipped <slug>". `requestRematch()` runs
    only after a department that read offers, not after a skipped slug.
  - Shared per-page helpers (`afterPage`, `pageCount`, `waitStep`, `blockLine`) are in
    `src/ingestion/market/crawl-page.ts`.
  - review-m3 M4: after the fetch, `last_page_at` and `pages_today` are saved before
    `upsertOffers`, so a page that was fetched is always counted.
  - review-m3 N1: a failed `upsertOffers` (for example int4 overflow, a NUL or a bad date) is
    logged. The page then counts as `unknown` with "falha ao gravar: <errorText>". The normal
    state save moves past it, so it is skipped, counted in the streak and shown in `last_error`.
    The skip uses the page count it read, so page 1 doesn't drop its department. A real DB
    outage fails the first state save instead, and the page is retried after the error
    backoff.
- [x] **Step 3:** `amazon-browser.ts`: `withAmazonBrowser(fn)` launches with the same options as
  `src/ingestion/browser.ts:L48-L60`. Extract a shared launch helper rather than copying it.
  - The profile is `path.join(path.dirname(env().ML_PROFILE_DIR), 'amazon-profile')`, never
    the ML profile.
  - It uses its own Xvfb display, closes within the existing close helper, and kills only its
    own profile's Chrome on a hang.
  **Reason:** this is the Chrome that passes Amazon's wall. The ML profile and session must stay
  untouched.
  **Code Reference:** cause → `src/ingestion/browser.ts:L12-L60`,
  `src/ingestion/browser-close.ts` (`killProfileBrowser`).
  -- **MODIFIED:**
  - Shared helper `src/ingestion/browser-launch.ts`: `launchChrome(profileDir, xvfb)` and
    `displayOptions`, moved verbatim. `withMlBrowser` now calls it; the rest of the ML path is
    unchanged. `browser-launch.test.ts` pins the exact option keys and flags for both.
  - `withAmazonBrowser(fn(page))` always uses its own Xvfb, creates the profile directory, and has
    a 30 min session deadline (`AMAZON_SESSION_DEADLINE_MS`). A failed launch stops Xvfb and
    rethrows.
  - `amazonPageLoader(page)` gives `(url, scroll) => FetchedPage`: `goto` with `domcontentloaded`
    and a 30 s timeout, an optional bounded wheel scroll, then `page.content()`. A navigation
    error is status 0 with its reason.
  - Not verified live: the scroll that loads all 50 best-seller cards.
- [x] **Step 4:** `amazon-crawler.ts`, one session at a time:
  - **Before a session:** it waits for no hold, no block, `chainIdle()`, and pages within the
    budget for the day.
  - **In a session,** up to `AMAZON_SESSION_PAGES` pages, 30 s plus jitter apart:
    - **Before each page,** it re-checks the hold and `chainIdle()`, and closes the session if
      either fails.
    - **Best sellers:** when `bestsellers_at` is older than one day, the daily pass goes first.
      It reads the root, then each department's `pg=1` and `pg=2`, scrolling to the bottom before
      `page.content()`. It stops at `AMAZON_BESTSELLER_DAILY_PAGES`, keeping its progress in the
      cursor.
    - **Searches:** otherwise it runs `dueSearches(now, 1)`, loads `amazonSearchUrl(query)`,
      parses the page, and calls `upsertOffers`, `recordSearch` and then
      `rematchKeys([key])`.
  - **Page kinds** follow the shared rules. A wall ends the session.
  - It counts `pages_today` and persists the state after each page.
  **Reason:** it must never compete with ML and never exceed 1,000 pages a day.
  **Code Reference:** cause → `src/ingestion/run-chain.ts:L6-L8` (`chainIdle`),
  `src/ingestion/request-hold.ts:L26`.
  -- **MODIFIED:**
  - The gate (hold, block, `chainIdle()`, daily budget) runs before the session and before every
    page, including the first. It is also checked before opening Chrome, so an empty queue or a
    busy ML chain never launches it. The pause between pages polls `chainIdle()` every second and
    ends early, so an ML job never shares the machine for a whole interval.
  - Searches record every page except walls, as confirmed by the team lead (N3). Results and
    empty pages leave the queue for 7 days. Unknown and missing (404) pages are recorded as
    `unknown`, for the 24 h retry (`AMAZON_UNKNOWN_RETRY_HOURS`). Walls are never recorded, so the
    same key is searched again after the backoff.
  - `rematchKeys([key])` runs after results and empty pages, after the state is saved. A failed
    rematch is logged, and the session goes on.
  - Best sellers: the cursor holds `{queue, pages}`. The root adds its departments. A department
    `pg=1` puts its `pg=2` next. A wall keeps the URL; other failures drop it. The pass ends at an
    empty queue or at 200 pages. It then sets `bestsellers_at` and calls `requestRematch()`.
    Department pages are scrolled; the root is not.
  - Three unknown pages in a row block and end the session, like a wall. An unknown best-seller
    page is dropped for that day's pass.
  - review-m3 I1: `pause` returns `Promise<boolean>`, true only when the whole interval passed
    with the chain idle. A false pause ends the session, so a short ML job can't shorten the
    pace.
  - review-m3 I2: the session gives `{load, isOpen}`. `withAmazonBrowser` sets it closed before
    closing the context, on the deadline or any end. Every write (count, offers, `recordSearch`,
    state, rematch) is skipped or rejected once it is closed, and the loop stops. The loader
    rethrows when the page is closed, instead of reading it as an unknown page. A session ended by
    its deadline therefore writes nothing afterwards.
  - review-m3 M4: the page count is saved right after the load, before the offers and the
    search are written.
  - review-m3 N1: a failed `upsertOffers` or `recordSearch` is logged, and the page counts as
    `unknown` ("falha ao gravar: ..."). A search with unsaved offers is recorded as `unknown`, for
    the 24 h retry, so the next page is another key. A best-seller URL is dropped for the day. A
    DB outage fails the first save and ends the session as before. If `recordSearch` itself
    always fails for a key, the key isn't taken off the queue. That is unlikely, since keys and
    queries are sanitized, and it shows in the streak, the backoff and `last_error`, not
    silently.
- [x] **Step 5:** `crawlers.ts`:
  - `startMarketCrawlers()` starts two independent loops (Kabum and Amazon) and the rematch loop.
    It is guarded on `globalThis` like the old worker, with a boot delay, and errors are logged
    and backed off.
  - `marketStatus(now): Promise<MarketStatus>` builds the status from `crawler_state`,
    `validOfferCounts`, `searchCounts` and the coverage, and is cached for 30 s.
    - Coverage is the share of fresh Novos with 30%+ OFF that have a valid high check.
    - The status carries raw fields only: `state`, `holdText`, `waitingFor`, `blockedUntil`,
      `intervalMs` and the rest of `CrawlerStatus` in `types.ts`. Task 43's `src/lib/market/view.ts`
      turns them into pt-BR text, so Task 42 doesn't depend on Task 43.
      -- **MODIFIED:** `stateText` was replaced by raw fields on 2026-11-04, so 42 and 43 can run
      in parallel.
  - `src/instrumentation.ts` starts `startMarketCrawlers` instead of `startPriceWorker`.
  **Reason:** this is one entry point and one status for the UI.
  **Code Reference:** cause → `src/instrumentation.ts:L9-L14`,
  `src/ingestion/price-check/worker.ts:L63-L128`.
  -- **MODIFIED:**
  - `startCrawlerLoop` keeps each loop's last waiting reason. A thrown step is logged with
    `errorText` and backed off from 1 min, doubling to 1 h. It is not written to `last_error`,
    which holds only page and block reasons (review-m4).
  - `marketStatus` caches only the counts (`validOfferCounts`, `searchCounts`, `marketCoverage`)
    for 30 s. The crawler rows, the hold and `chainIdle()` are read on every call, so a pause or a
    VPN connect shows at once (review-m4 I1).
  - `AUTO_RUN=off` starts nothing, the rematch loop included.
  - The status logic is pure in `src/ingestion/market/crawler-status.ts`. The state order is
    stopped > held > blocked > waiting > running. `holdText` is the hold's `reason`.
  - Kabum `next_pass` and Amazon `daily_budget` and `ml_busy` come from live data; `queue_empty`
    comes from the loop.
  - Coverage: `marketCoverage(now)` in `src/db/market-coverage.ts`, using `priorityNovosSql`
    (`src/db/target-tiers.ts`) and `validHighCheck`, now exported from `src/db/verdict-sql.ts`.
- [x] **Step 6:** `POST /api/items/[id]/compare`:
  - it runs `itemToCheck`, then `matchItemLocally`, then `prioritizeSearch`;
  - the response is a `CompareResponse` (`{status, amazonQueued}`);
  - there is no hold check, since no request is sent, and no 409.
  **Reason:** "Comparar agora" becomes instant and local.
  **Code Reference:** cause → `src/app/api/items/[id]/compare/route.ts:L7-L18`; impacted →
  `src/components/CompareButton.tsx` (Task 43).
  -- **MODIFIED:**
  - The response also carries `amazonSearchedAt`, the ISO form of `SearchPriority.searchedAt`
    (contract change of 2026-11-04).
  - Both outcomes call `prioritizeSearch`, as design §7 says. A Kabum match priced above ML can't
    flag the item, but an Amazon offer could. The only exception is an empty `compareQuery`, which
    returns `amazonQueued: false`, `amazonSearchedAt: null`. The team lead corrected an earlier
    skip on `matched`.
  - A valid existing check no longer short-circuits, since the local match is instant.
- [x] **Step 7:** Delete the Buscapé code:
  - `src/ingestion/price-check/*` (move anything still needed, such as tier SQL or row helpers,
    into the market modules first);
  - `parse-buscape.ts`, its test and its fixtures;
  - `scripts/buscape-capture.ts`;
  - the `BUSCAPE_*` constants and the unused `PRICE_CHECK_*` and `PRICE_WORKER_*` constants, plus
    `PRICE_FAILED_RETRY_HOURS`;
  - the `latestBlock` and pause plumbing that only Buscapé used.

  Keep `price_checks`, `checkKey`, the hold and the price-only pause toggle, which now pauses the
  crawlers.
  -- **MODIFIED:** some tests read the Buscapé fixtures through `parseBuscapeSearch`:
  `match.test.ts`, `match-fixtures.test.ts`, `verdict.test.ts` and `src/lib/market/tokens.test.ts`
  (labels in `src/lib/price-compare/match-labels.ts`). Before deleting `parse-buscape.ts`:
  - convert each Buscapé fixture once into a plain `MarketCard[]` JSON file
    (`src/lib/price-compare/__fixtures__/<name>.cards.json`), written by running
    `parseBuscapeSearch` over it;
  - point those tests at the JSON files and check that their counts and expectations are
    unchanged;
  - then delete the parser and the HTML fixtures.
  **Reason:** dead code would keep the old 24 h block and rate assumptions alive.
  **Code Reference:** cause → `src/ingestion/price-check/` (all files), `src/lib/constants.ts:L41-L81`,
  `src/lib/price-check-rules.ts:L5-L77`.
  -- **MODIFIED (done):**
  - 12 card files were generated once with `parseBuscapeSearch`. `kindle-16gb.cards.json` is `[]`,
    and its test now asserts the empty list. `nonsense` (empty, used only by `parse-buscape.test.ts`)
    was not kept.
  - The four tests run the same 311 tests with the same names, all passing, before and after.
  - Deleted: `src/ingestion/price-check/*` (12 files); `parse-buscape.ts` and its test; the 13
    tracked HTML fixtures; `scripts/buscape-capture.ts`; `src/db/price-worker.ts` and its test;
    `src/lib/price-worker-rules.ts` and its test; `src/lib/price-worker-status.ts`.
  - Removed from `price-checks.ts`: `latestBlock`, `validCheckStatus`, `storedCheckStatus`. From
    `check-sql.ts`: `workerSettledCondition`, `workerNeedsCheckCondition`, `previouslyFailedSql`.
    From `price-check-rules.ts`: the pause, stop, failure-streak, log-line and failed-status
    helpers. Removed constants: `BUSCAPE_USER_AGENT` and `BUSCAPE_ACCEPT_LANGUAGE` (now
    `MARKET_*`), `PRICE_CHECK_JITTER_MS`, `_TIMEOUT_MS`, `_VALID_HOURS`, `_BACKOFF_HOURS`,
    `_FAILURES_STOP`, `_INTERVAL_MS`, `PRICE_NO_MATCH_VALID_HOURS`, all `PRICE_WORKER_*`, and
    `PRICE_FAILED_RETRY_HOURS`.
  - `targetTiers` moved to `src/db/target-tiers.ts`.
  - Kept: `BUSCAPE_SEARCH_URL`, the compare link's URL next to the other link URLs.
  - The untracked, gitignored `__fixtures__/captured/` raw Buscapé pages were left in place.
- [x] **Step 8:** `scripts/market-capture.ts`, for the team lead only:
  - `--site kabum|amazon --url <url> --out <file>`;
  - it refuses while the VPN is connected (it uses `vpn-guard`);
  - for Amazon it uses `withAmazonBrowser`;
  - it keeps a request counter in `/tmp/market-capture-count.json` and refuses past 10 per site.
  - Update the README's capture notes.
  **Reason:** fixtures for the parsers come only from budgeted team-lead captures.
  **Code Reference:** cause → `scripts/buscape-capture.ts` (replaced).
  -- **MODIFIED:**
  - Run it as `npx tsx --env-file=.env scripts/market-capture.ts --site kabum|amazon --url "<url>"
    --out <file>`, the same command as the README.
  - The URL must be on the site's origin. A held VPN state (connected, error or unknown) refuses.
  - The count is written before the request. A wall marks the site, and later captures for that
    site are refused (design §8, "stopping at the first wall"). That includes a wall on the
    Kabum sitemap index (review-m3 M1).
  - The count file fails closed (review-m3 M2). A missing file is a fresh budget. A file that
    can't be read, isn't JSON or lacks a valid `{requests, walled}` per site refuses the capture.
  - It prints the status, size and parsed kind.
  - Not run, as required. The README is Task 43's file, so the capture notes went to the team lead
    instead.
- [x] **Verify:**
  - `npx tsc --noEmit`, lint and the full `npx vitest run` pass.
  - `grep -ri buscape src scripts` shows only the compare link in `src/lib/price-compare/links.ts`.
  - Tests with fake deps cover the hold, the backoff, `chainIdle` and budget stops, the session
    end on a wall, cursor resume, and the department skip.
  -- **MODIFIED:**
  - tsc and lint are clean. vitest: 149 files, 2,586 tests pass (after the review-m3 fixes and N1).
  - review-m3 M5: `amazonProfileDir` throws when it would resolve to `ML_PROFILE_DIR`. M6:
    `displayOptions` is module-local.
  - Besides `links.ts` and its test, `grep -ri buscape` shows the rest of the compare link:
    `BUSCAPE_SEARCH_URL` in `constants.ts`, `BUSCAPE_LABEL` in `labels.ts`, the link entry in
    `deal-view.ts` and its test. It also shows the card URLs inside the `*.cards.json` fixtures,
    and the gitignored `captured/` pages.

### Task 43: UI, API texts and README

**Files:** `src/lib/market/view.ts`, `src/lib/price-check-view.ts`, `src/app/page.tsx`,
`src/app/conta/page.tsx`, `src/components/CompareButton.tsx`, `src/components/DealCard.tsx`
(store texts only), `src/lib/health-view.ts`, `src/app/api/health/route.ts`, `src/lib/api.ts`,
`README.md`, and the tests next to them.

- [x] **Step 1:** `src/lib/market/view.ts` (pure):
  -- **MODIFIED:** `crawlerStateText(status)` takes the whole `CrawlerStatus`, which carries the
  site (`progress.site`), the state and the details. Blocked reads "Bloqueado até DD/MM HH:MM
  (<motivo>)" through `formatDayMonthTime`: a 24 h block crosses midnight, and `format.ts`
  exports no time-only formatter. `waitingFor: 'queue_empty'` reads "Fila vazia". Held, blocked
  and stopped are shown in amber (`crawlerAlert`). `marketPanel(status, now)` also carries the
  coverage line. Best sellers read "Mais vendidos: lidos há X" or "Mais vendidos: ainda não
  lidos"; pages read "Páginas hoje: N" (Amazon "de 1.000") and "Ofertas no catálogo: N".
  After review-m4: `ml_busy` reads "Aguardando o Mercado Livre terminar", since `chainIdle` is also
  false during Busca runs, login and verification. The department line is dropped when the
  department is null, the index is past the list or the page is below 1. The site names come from
  `SITE_LABEL` in `src/lib/labels.ts`.
  - **`crawlerStateText(site, state, details)`,** in pt-BR. "Rodando" shows the pace; held shows
    "Em espera: <hold reason>"; blocked shows "Bloqueado até HH:MM (<motivo>)"; waiting shows
    "Aguardando a próxima passagem (DD/MM HH:MM)", "Limite do dia atingido" or "Aguardando o
    ciclo do ML"; stopped shows "Parado".
  - **`marketCoverageText(coverage)`:** "Com preço de mercado: X% das ofertas com 30%+ OFF",
    using the old rounding rules (`LESS_THAN_ONE_PERCENT`).
  - **`marketPanel(status)`:** the per-site lines for Conta:
    - pages today out of the budget, and the offers in the catalog;
    - Kabum: "Departamento N de M (<slug>), página P";
    - Amazon: "Buscas: S feitas, D na fila" and "Mais vendidos: <when>";
    - "Última página há X".
  **Reason:** Conta must show what each crawler is doing and why it waits.
  **Code Reference:** cause → `src/lib/price-check-view.ts:L1-L80` (old worker texts, replaced);
  impacted → `src/lib/market/types.ts` (`MarketStatus`).
- [x] **Step 2:** Ofertas (`src/app/page.tsx:L41`) reads `marketStatus(now)` and shows
  `marketCoverageText`. Conta (`src/app/conta/page.tsx:L33`) shows the "Comparação de preços"
  panel from `marketPanel`. Remove the old worker panel and the `priceWorkerStatus` imports.
  -- **MODIFIED:** below the two site blocks, Conta keeps the coverage, the last check, the 24 h
  counts and the inflated count. `PriceCheckSummaryView` lost `pausedUntil` and `blockReason`
  (only the Buscapé block fed them), and `PriceWorkerView` is gone, so
  `src/lib/price-worker-status.ts` goes with `worker.ts` (impl-m3 told).
  **Reason:** the Buscapé worker no longer exists.
  **Code Reference:** cause → `src/app/page.tsx:L4`, `L41`, `src/app/conta/page.tsx:L18`, `L33`.
- [x] **Step 3:** In `CompareButton`, handle `CompareResponse`:
  -- **MODIFIED:** both texts are lowercase notes in the compare row, like the old "sem
  equivalente no Buscapé". `NO_EQUIVALENT_TEXT` (`src/lib/labels.ts`) is now "sem equivalente na
  Kabum ou Amazon", shown by the card after the refresh. The button shows "busca na Amazon na
  fila" (`AMAZON_QUEUED_TEXT`) after a compare that queued, and `DealCard` puts the no-equivalent
  note before the button so the queued note follows it. `requestCompare` returns
  `CompareResponse` and lost its 409 branch. The inflated line in `src/lib/deal-view.ts` shows
  "(N lojas)" only above one store, since one offer now flags and "(1 lojas)" read wrong.
  After review-m4 (team lead's decision): "Comparar agora" also shows on a no_match check, where a
  click moves the key to the front of the Amazon queue, and stays hidden on a matched check
  (`matched` prop). Both texts are composed from `KABUM_LABEL` and `AMAZON_LABEL`. After the
  re-review: `CompareResponse.amazonSearchedAt` drives a third note, built by the pure
  `compareNote(result, now)` in `view.ts`. A no_match key that isn't queued but was searched reads
  "Amazon buscada há X" (`AMAZON_SEARCHED_LABEL` plus `formatAgo`); a key never searched adds
  nothing. Focus moves to the row only after a match, when the button goes away, and back to the
  button otherwise.
  - "Sem equivalente na Kabum ou Amazon" for no_match;
  - the matched line as today;
  - when `amazonQueued`, append "Busca na Amazon na fila".

  Remove the 409 and pause texts that only Buscapé produced. In the card store texts, Kabum and
  Amazon names come through `market_store` as they are.
  **Reason:** the button result must match the local behaviour.
  **Code Reference:** cause → `src/components/CompareButton.tsx`, `src/lib/api.ts` (compare call).
- [x] **Step 4:** `/api/health` and `health-view` replace the old price worker fields with
  `market: { kabum: {state, blockedUntil}, amazon: {state, blockedUntil} }`. The watchdog stays
  as it is.
  -- **MODIFIED:** the report had no worker fields, so `market` was added (`blockedUntil` as an
  ISO string). The watchdog test fixture gained `market`, plus a test that blocked or stopped
  crawlers never notify. After review-m4: `market` is null when `marketStatus` throws (logged
  with the `[health]` tag), so `/api/health` still answers.
  **Reason:** health must not report a worker that no longer exists.
  **Code Reference:** cause → `src/app/api/health/route.ts`, `src/lib/health-view.ts`.
- [x] **Step 5:** README:
  -- **MODIFIED:** also updated the Conta bullet under Pages, the watchdog note (`market` never
  notifies), Persistence and the matching limitation (the two-store rule is gone). The
  `market-capture.ts` command is documented as
  `npx tsx --env-file=.env scripts/market-capture.ts --site kabum|amazon --url "<url>" --out <file>`;
  check it against the script once it exists. After review-m4: the Amazon order says "30% or more
  off (ML's discount, biggest first)", the profile path is
  `$(dirname "$ML_PROFILE_DIR")/amazon-profile`, and the ML jobs that hold Amazon are named.
  - replace the "Price comparison" section with sources, pace, budgets, backoff, holds, the
    Amazon profile location, local matching and the verdict rule;
  - update the "Limits of the hold" bullet;
  - document `scripts/market-capture.ts`.
  **Reason:** Fernando runs it from the README.
  **Code Reference:** cause → `README.md` ("Price comparison" section).
- [-] **Verify:** `npx tsc --noEmit`, lint and the full `npx vitest run` pass. Pure view tests
  cover every state text.
  -- **MODIFIED:** after the re-review fixes (2026-11-04): lint is clean. vitest has 2,538 of
  2,539 tests passing; the one failure is `src/db/market-searches.test.ts`, and the tsc errors are
  in `src/db/market-searches.ts` and the compare route. Those are the in-progress
  `amazonSearchedAt` changes on the route side, not Task 43 files. Re-run the gates after Task 42.

### Task 45: Keep the database cause of a failed run (side fix, with Task 42)

**Files:** `src/ingestion/errors.ts`, `src/ingestion/recorded-run.ts`, and their tests.

- [x] **Step 1:** Add `errorText(e: unknown): string` to `errors.ts`.
  - When `e` has a `cause` that is an Error, or that has a string `message`, the text is the
    cause's first line plus ` (<code>)` when the cause has a string `code` (Postgres SQLSTATE).
  - Otherwise it is `firstLine(e)`.
  - Use it wherever a run's `error` or a step failure is recorded or logged, and keep
    `redactQueries`.
  **Reason:** the 2026-11-04 19:30 UTC cycle failed, and `runs.error` holds only the drizzle
  wrapper's "Failed query: insert into "items" ...". The Postgres reason (deadlock, lock timeout,
  constraint) sits in `cause`, which `firstLine` drops, so the failure can't be diagnosed.
  **Code Reference:** cause → `src/ingestion/errors.ts:L34-L36` (`firstLine`), with callers in
  `src/ingestion/recorded-run.ts:L72-L90`; impacted → `src/db/items.ts:L137-L150`
  (`recordObservations`, the failing insert).
  -- **MODIFIED:**
  - A `RunStop` keeps its own message even with a cause. Its pt-BR text ("O perfil do navegador já
    está em uso", the load-breaker text) is the diagnosis, and the cause is a Playwright error.
  - Used in `recorded-run.ts` (`report.error`, still through `redactQueries`). Also in the step
    failures of `steps/breaker.ts`, `steps/buscas-pages.ts` and `steps/discover-pages.ts`; the
    prune and health logs in `cycle.ts`; the not-read log in `search-run.ts`; the `after-run.ts`
    and `announce.ts` logs; the two run routes; and the market crawlers.
  - `src/ingestion/market/rematch.ts` (Task 41) still logs `firstLine`. It is a candidate for the
    same change.
  - review-m3 M3: a cause whose first line is empty falls back to `firstLine(e)`.
- [x] **Verify:** tests cover a DrizzleQueryError-like error whose cause has a message and a
  code, a plain Error, and a non-Error. tsc, lint and the full vitest pass.
  -- `errors.test.ts` has 6 new cases. The new `recorded-run.test.ts` covers a failed query,
  recorded as "deadlock detected on <url without query> (40P01)", and a `RunStop` that keeps its
  message.

### Task 46: Matcher precision pass on real data

**Files:** `src/lib/price-compare/match.ts`, `src/lib/price-compare/match-labels.ts`, and the matcher
tests.

- [x] **Step 1:** Export the live matched checks read-only, label every high pair as the same
  product or not, and fix the matcher with general rules. Pin the real pairs in `match-labels.ts`.
  **Reason:** the first live rematch, at 2026-11-05 00:26 UTC, gave 100 equivalents and 46 cards
  hidden as inflated. The team lead's spot-check found false high matches:
  - ISDIN Fusion Water Magic Repair vs Magic Color;
  - Schneider Orion 10 A outlets vs Tramontina 20 A outlets, because amperes aren't a size unit;
  - Buddemeyer Vision Fill vs Toque de Pluma.
  Under the one-offer rule, each one can hide a real deal. The matcher was tuned on Buscapé's
  short product names, and Kabum and Amazon titles are longer.
  **Code Reference:** cause → `src/lib/price-compare/match.ts` (`SIZE_UNITS`, the anchor and
  flanker rules); impacted → `src/ingestion/market/match-local.ts`, `src/db/verdict-sql.ts`.
  -- **MODIFIED:** done and approved by review-m1 after one round of refinements.
  - Rules:
    - amperes are unified into the "Na" model word, with a voltage guard and no bare number
      after it;
    - plural count slots;
    - "light" is a tier word;
    - a name-zone slot conflict, with an edit-distance 2 typo guard;
    - a Kabum brand present on the card and missing from the ML title caps the pair at medium,
      but only when the ML title names its own word the card lacks.
  - Labels (`match-labels.ts`):
    - 41 same and 7 different;
    - 5 open false pairs as it.fails: Buddemeyer Vision Fill vs Toque de Pluma, Penalty Max
      1000 Locker, Forth Mata Pragas twice, DPS Pocket;
    - 11 synthetic same pairs (iPhone 15 [Apple], PS5 Slim [Sony], HyperX [Kingston], WD
      Green and Purple, Redmi, RTX Ventus, mixed-voltage pairs).
  - Results:
    - live precision rose from 0.778 to 0.891 (41/46, Vonixx undecided), with recall kept at
      1.000;
    - old fixtures are unchanged;
    - over all 21,809 checks, high matches went from 50 to 44.
  - Redeployed 2026-11-05 01:00 UTC.
- [x] **Verify:**
  - precision and recall, before and after, on the real sample and on the old fixtures;
  - every existing expectation passes;
  - tsc, lint and vitest pass;
  - then a review and a redeploy in an idle window.

### Task 44: Deploy (team lead)

- [x] **Step 1:** Run the gates: tsc, lint and the full vitest suite. Then a final review of
  Tasks 40-43 together.
  **Reason:** the parts were built in parallel.
  **Code Reference:** all of the above.
  -- **MODIFIED:** the gates passed at 23:54 UTC: tsc 0, lint clean, vitest 149 files and 2,586
  tests. The joint review was replaced by five reviewers:
  - review-m1 (Task 40);
  - review-m2 (Task 41, with three rolled-back live Postgres probes);
  - review-m4 (Task 43);
  - review-m3 (Tasks 42 and 45, with a rolled-back live run of both crawlers through the real
    repositories, and a diff of the ML launch against the deployed source map).
  They also covered the cross-task contracts: terms, campaign price, status fields and
  CompareResponse.
- [x] **Step 2:** While `/api/ml/status` is idle and at least 15 min before `nextRunAt`:
  - stop the timer and the service;
  - apply migration 0015;
  - build;
  - delete the Buscapé `price_checks` rows (all current rows, our own data);
  - start the service and the timer;
  - lift the price-comparison pause with `POST /api/hold {"priceChecksPaused": false}`. The team
    lead set it on 2026-11-04 21:31 UTC to keep the old Buscapé worker idle until the deploy.
  **Reason:** this follows the README update steps and the migration rule.
  **Code Reference:** `README.md` update steps, `deploy/systemd/promo-cps.service`.
  -- **MODIFIED:** done 2026-11-04 23:55 UTC, with the VPN off and the next cycle at 01:39 UTC.
  - Migration 0015 applied: 16 migrations, the 3 tables created, and `items_check_key_idx`
    skipped as existing. The team lead had created it at 22:47 UTC.
  - The build passed, and the 742 Buscapé `price_checks` rows were deleted.
  - The service and timer started, with health up after 2 s, and the pause was lifted.
- [-] **Step 3:** In the journal, watch the first Kabum department pages, the first Amazon session
  and the first rematch pass. Fix any skipped Kabum slugs.
  **Reason:** department slugs and Amazon's page shapes are only proven live.
  -- **MODIFIED:** first minutes, at 23:57 UTC:
  - Kabum: "pass started with 26 departments (sitemap)", then hardware pages 1-6 of 145 at
    about 11 s each, giving 299 offers, 211 with an active campaign price.
  - Amazon: the best-seller root plus one department, in its own Chrome, giving 52 offers.
  - The rematch at boot covered 21,809 keys in 13 s, 0 with an equivalent, since the catalog was
    nearly empty.
  - No block and no error. Still to watch: the first Amazon searches (after the best-seller
    pass) and the end of the first department.
- [-] **Step 4:** In the browser, with every request outside localhost blocked, check the Ofertas
  coverage line, the Conta panel and "Comparar agora". Then spot-check about 20 flagged cards.
  -- **MODIFIED:** checked at 23:57 UTC, with every non-localhost request aborted:
  - Conta shows both site blocks: "Rodando: 1 página a cada 10 s", "Departamento 1 de 26
    (hardware), página 2", Amazon "Páginas hoje: 1 de 1.000" and "Buscas: 0 feitas, 17.667 na
    fila".
  - Ofertas shows "Com preço de mercado: 0% das ofertas com 30%+ OFF".
  - One "Comparar agora" (no_match) returned `{no_match, amazonQueued: true}` and showed "busca
    na Amazon na fila", with focus kept on the button.
  - The spot-check of flagged cards waits until coverage builds.
- [ ] **Verify:** `/api/health` shows both crawlers; `market_offers` grows; at least one Amazon
  search is recorded; the docs are updated.

## Execution Protocol

**How to execute this plan:**

1. Read the entire Context section before starting any task.
2. Execute tasks in the order given in the Progress Summary. 40 and 41 run in parallel, and so do
   42 and 43.
3. After completing each checkbox, mark it as done: `- [ ]` -> `- [x]`.
4. After completing each Task (all its checkboxes done), update the plan file immediately.
5. If a step fails or needs modification:
   - Do NOT silently deviate. Add a note below the checkbox explaining what changed.
   - Format: `- [x] **Step N:** [original] -- **MODIFIED:** [what actually happened and why]`
6. If you discover the plan is wrong or incomplete mid-execution:
   - Stop executing.
   - Add a `> **BLOCKER:**` callout at the current position.
   - Report to the team lead before continuing.
7. Never skip a verification step. If verification fails, stop and report.

**Progress tracking:**
- Completed: `- [x]`
- In progress: `- [-]`
- Blocked: `- [ ]` with a `> **BLOCKER:**` note
- Modified: `- [x]` with a `-- **MODIFIED:**` suffix

**Resume instructions:** If picking up this plan in a new session, read the Context section
first, then scan all checkboxes to find the first unchecked `- [ ]` item. That is where to resume.
