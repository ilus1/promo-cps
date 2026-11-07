# Watched products Implementation Plan

## Context

**Problem:** Fernando: "Seems like keeping track of all the possible products is not viable.
Rather than doing like right now, lets try to create targeted searches where we have alerts for
prices/promotions to a 1:1 match products in all major retails." The app read 300 ML listings
per cycle and crawled 135k Kabum and Amazon offers, while 0 alerts and 0 Buscas were configured.

**Current State:**
- **ML cycle:** `src/ingestion/cycle.ts:L95-L125` runs harvest, activate, the Buscas step
  (`runDueBuscas`) and discovery.
- **Market catalog:** `src/ingestion/market/crawlers.ts` (`startMarketCrawlers`, started in
  `src/instrumentation.ts`) runs the Kabum catalog pass, the Amazon queue and best sellers, and
  the rematch loop. It was paused on 2026-11-06 13:57 UTC through the price-only hold.
- **Pages:**
  - Ofertas (`src/app/page.tsx`), Buscas (`src/app/buscas/`) and Alertas (`src/app/alertas/`),
    with API routes in `src/app/api/{searches,alerts,items}`;
  - Cupons (`src/app/cupons/page.tsx`) and Conta (`src/app/conta/page.tsx`).
- **Reusable pieces:**
  - parsers: `parseAmazonSearch` and the wall rules (`src/lib/market/parse-amazon.ts`), the Kabum
    product mapping and campaign rule (`src/lib/market/parse-kabum.ts`), `storableOffers`
    (`src/lib/market/pages.ts`);
  - matching: `matchCandidates` and `priceBand` (`src/lib/price-compare/match.ts`);
  - crawl rules: backoff, day key, pace (`src/lib/market/crawl-rules.ts`);
  - runtime: `withAmazonBrowser` (`src/ingestion/market/amazon-browser.ts`), `requestHold` and
    `chainIdle`, `sendDesktopNotification` (`src/lib/desktop-notify.ts:L102`);
  - ML reading: the card readers and coupon hint (`src/ingestion/ml/`, `src/lib/coupon-hint.ts`).
    `ObservedCard.couponHint` is at `src/ingestion/ml/observed-card.ts:L5-L24`;
  - text safety: `storableText` (`src/lib/storable-text.ts`).
- The latest migration is 0016.

**Goal:** Fernando adds a product by name or link and gets alerts when its price drops or hits a
target. The app finds the product 1:1 at ML, Amazon, Kabum, Americanas and Buscapé's merchants:
barcode first, otherwise automatic. It tracks only those listings.

**Approach:** see `docs/plans/2026-11-06-watched-products-design.md`; Fernando approved
approach 1.
- A barcode (EAN) match comes first. When there is none, a high-confidence `matchCandidates`
  result gives an automatic match, with no confirmation step.
- There is one listing per store per product, refreshed every 3 h. ML listings refresh inside the
  ML cycle, with the coupon hint giving the final price.
- Alerts fire on a target price, a new 30-day low and a drop of X%.

**Scope Boundaries:**
- No Magalu or Casas Bahia directly (both walled): they come through Buscapé's merchants.
- No VTEX besides Americanas.
- Tables are not dropped in this plan; a later migration drops them.
- Coupon harvest, activation, Cupons, Conta, holds, the scheduler and the watchdog stay.

**Key Files:**
- `src/lib/watch/types.ts`: the shared contract, written by the team lead.
- `src/lib/watch/*`: pure parsers, matching, links, EAN and alert rules.
- `src/db/schema.ts` and `drizzle/0017_*`: the new tables.
- `src/db/watch-*.ts`: repositories.
- `src/ingestion/watch/*`: source clients, resolver, refresher, alerts loop and the ML cycle step.
- `src/app/page.tsx`, `src/app/produtos/[id]/page.tsx` and `src/components/Watch*`: UI.
- `src/app/api/watch/*`: API routes.

**Dependencies / Assumptions:**
- The fixtures are in `/tmp/probe-watch/` (untrusted, read as text only):
  - `americanas-1.json`, `americanas-ean.json` (VTEX API);
  - `amazon-ean.html` (search), `amazon-dp.html` (product page);
  - `kabum-search.html` (rendered Chrome search with `catalogServer`), and
    `/tmp/probe-retailers/kabum-product-925350.html` (product page);
  - `buscape-1.html` (search), `buscape-product.html` (product page with merchant offers).
- ML search by EAN is unverified. The ML step tries the EAN, checks the top card against the
  product name with the matcher, and falls back to the title.
- Agent rules: no code comments, ASCII in code, named constants, no git, no `.env`, no requests,
  no `npm run dev`, no service changes, no applied migrations.

## Progress Summary

- [x] Task 60: pure watch layer (impl-m1)
- [x] Task 61: storage (impl-m2)
- [x] Task 62: runtime, API routes and removal of discovery and the market crawl (impl-m3)
- [x] Task 63: UI and README (impl-m4)
- [x] Task 64: deploy (team lead)

Tasks 60 and 61 run in parallel. Tasks 62 and 63 start once 60 and 61 publish their signatures.

## Tasks

### Task 60: Pure watch layer

**Files:** `src/lib/watch/{links,ean,parse-americanas,parse-amazon-product,parse-kabum-product,parse-kabum-search,parse-buscape,choose-match,ml-final,alerts}.ts`,
their tests and fixtures in `src/lib/watch/__fixtures__/`.

- [x] **Step 1:** `ean.ts`: `normalizeEan` (digits only) and `isValidGtin` (GTIN-8/12/13/14
  checksum).
  **Reason:** a bad barcode would make wrong "exact" matches everywhere.
  **Code Reference:** cause → design "Model".
- [x] **Step 2:** `links.ts`: `parseProductLink(url): ProductLink | null` for:
  - ML item (`MLB-?\d+`) and catalog (`/p/MLB\d+`);
  - Amazon `/dp/<ASIN>` and `/gp/product/<ASIN>`;
  - Kabum `/produto/<code>`;
  - Americanas `/<slug>/p`;
  - Buscapé `/<category>/<slug>`.

  Unknown hosts give null.
  **Reason:** adding a product by link.
  **Code Reference:** cause → design "Flow" 1.
  -- **MODIFIED:** also reads Amazon `/gp/aw/d/<ASIN>` and ML `/up/MLBU...` links that carry the item in
  `wid=MLB...` or `pdp_filters=item_id:MLB...`; an `/up/` link without an item gives null.
- [x] **Step 3:** The parsers. Each returns `SourcePage<...>` with the market wall rules, a status
  check and `storableText`:
  - Americanas VTEX JSON to `ListingCandidate[]`: EAN from `items[].ean`; price is the lowest
    `commertialOffer.Price` among sellers with `AvailableQuantity > 0`; merchant is that seller.
  - Amazon product page to `ListingQuote`: the corePrice price, the struck list price, in stock,
    the seller.
  - Kabum product page to `ListingQuote`, reusing the campaign rule in `parse-kabum.ts`.
  - Kabum rendered search: find the `catalogServer` JSON anywhere in the HTML, then the existing
    product mapping into candidates.
  - Buscapé search cards and product page offers: one `ListingQuote` per merchant.

  Trim the fixtures from the probe files.
  **Reason:** each source must be testable without requests.
  **Code Reference:** reuse → `src/lib/market/parse-amazon.ts`, `src/lib/market/parse-kabum.ts`,
  `src/lib/market/pages.ts`.
  -- **MODIFIED:**
  - Buscapé: the probe contradicts the design. The product offers are
    `initialReduxState.offers.offerList` with `sellerName`, not `merchantName`. The page server-renders
    only the first 6 of 49 offers, from 3 merchants (KaBuM!, Want Import, Amazon). The `merchantName`
    values (Magazine Luiza, Americanas) belong to `pageProps.page.smartRecommenderHits`, which are
    unrelated recommended products. Search candidates have merchant null. One Buscapé product groups
    all colors, so its offers may be another color.
    Each offer carries its own title (`name`), which becomes the quote title.
    `parseBuscapeProduct(status, html, productName?)` keeps only offers whose title
    `candidateConfidence` rates `high` against the product name, so other colors are dropped. It then
    keeps each merchant's cheapest offer. It always drops KaBuM!, Amazon, Mercado Livre and
    Americanas, compared through `merchantKeyOf`, because those stores are read directly. On the probe
    this leaves one quote: Want Import, "JBL Tune 520BT - Preto", R$ 207,13.
  - Kabum product page: `offer` has only `startDate`/`endDate`, no prices, and `prices` already hold
    the campaign price (9444.43 card, 8499.99 PIX, against 14443.33/12999 in the catalog captured
    80 minutes earlier). The offer is passed to the campaign rule, which then falls back to `prices`.
  - Kabum search: the rendered page's `catalogServer` is inside `__NEXT_DATA__`
    (`pageProps.data`), so `parseKabumListing` is reused unchanged; the plain HTTP page gives
    `unknown` ("sem catálogo").
  - Americanas also accepts HTTP 206, the VTEX partial-content status of paged searches (the probe
    did not save statuses, so this is unverified). The url is built from `linkText`, not the API `link`.
  - Amazon: blank `a-offscreen` prices are skipped, so the desktop price display is read when the
    core area is blank. An unavailable item without price gives `empty` ("sem estoque"), like
    Americanas; Kabum does the same for `available: false` without price.
  - HTML text goes through `storableHtmlText` (`source-page.ts`): decode, then `storableText`, then
    collapse whitespace, so `&#0;` cannot reach the database.
- [x] **Step 4:** `choose-match.ts`: `chooseMatch(product: {name; ean}, candidates,
  {searchedByEan}): ChosenMatch | null`.
  - If a candidate's EAN equals the product's EAN, the match is `barcode`.
  - If the search was by EAN and the top candidate is at least `medium` against the name, the
    match is `barcode`.
  - Otherwise, the cheapest candidate that `matchCandidates` rates `high` is `auto`.
  - Otherwise, null.
  **Reason:** Fernando chose barcode first, then automatic.
  **Code Reference:** reuse → `src/lib/price-compare/match.ts` (`matchCandidates`).
  -- **MODIFIED:** the matcher rates other colors `high` ("JBL Tune 520BT Preto" matched the Branco
  and Azul Kabum listings, and the cheapest was Branco). `candidateConfidence(name, candidate)`, now
  exported for the resolver, gives null on a color conflict (preto vs branco, and so on); among `high`
  matches one naming the same color beats one naming none. A candidate carrying a different valid EAN
  is never matched by the EAN-search or `auto` branches.
- [x] **Step 5:** `ml-final.ts`: the final price of an ML card, from its price and `couponHint`,
  using `src/lib/coupon-hint.ts`.
  **Reason:** ML coupons lower the ML price of watched products.
  -- **MODIFIED:** `mlQuote` keeps the card price for a `coupon` or `pix_coupon` basis, whose price
  already has the coupon, as `finalPrice` in `src/lib/deal-saving.ts` does.
- [x] **Step 6:** `alerts.ts`: `decideAlerts(product, bestNow, history: PricePoint[], sent,
  now): WatchAlertDecision[]`:
  - `target`: best at or below the target;
  - `low_30d`: strictly below every point in the last 30 days, with at least 1 day of history;
  - `drop`: at least `dropPercent` below the previous best.
  - Never repeat a kind at the same or a higher price already sent for that product.
  **Reason:** Fernando wants price and promotion alerts.
  -- **MODIFIED:** the window also counts the price in effect at its start (the latest point before
  it), which gives the same result as the clamped points of `bestHistory`. `drop` needs the best
  strictly below the previous one, so a 0% setting never fires on an unchanged price.
- [x] **Verify:** `npx vitest run src/lib/watch`, tsc and eslint on `src/lib` all pass.
  -- **MODIFIED:** 264 tests in 12 files, `merchant-key.test.ts` included. `merchantKeyOf` also drops
  every non-alphanumeric character ("KaBuM!" and "Kabum" give "kabum"), keeping the folded name
  when nothing alphanumeric is left. `WATCH_DROP_PERCENT_DEFAULT`, `WATCH_RESOLVE_DAYS`,
  `WATCH_LOW_WINDOW_DAYS` and `WATCH_REFRESH_HOURS` moved to `src/lib/constants.ts`.
  `watch-listings.ts` and `watch-products.ts` re-export theirs, because their tests and
  `src/app/page.tsx` import them from there.

### Task 61: Storage

**Files:** `src/db/schema.ts`, `drizzle/0017_*` (generated, not applied),
`src/db/watch-products.ts`, `src/db/watch-listings.ts`, `src/db/watch-alerts.ts`, and their tests.

- [x] **Step 1:** Add the tables in the design's "Model" section:
  - watched_products, watched_listings and listing_price_segments;
  - watch_alerts, with a unique key on product and listing for each live store, and on product,
    retailer, ref and merchant for Buscapé merchants.
  -- **MODIFIED:**
  - Migration: `drizzle/0017_lowly_excalibur.sql`, generated and not applied. It replaced
    `0017_goofy_jetstream.sql` and `0017_special_wolfpack.sql` after the review fixes below.
  - `watched_products` adds `resolved_at`, for the weekly resolve.
  - Listing key:
    - `watched_listings.merchant` is `text not null default ''`, where `''` means a single-store
      listing; views show it as null. It is the display name;
    - `watched_listings.merchant_key` (same default) is `merchantKeyOf(name)` from
      `src/lib/watch/merchant-key.ts` (accents and case folded), which `parse-buscape.ts` also
      uses to dedupe merchants;
    - a unique index on (product_id, retailer, ref, merchant_key);
    - a partial unique index on (product_id, retailer, merchant_key) where `removed = false`, so
      each store or Buscapé merchant has one live listing;
    - a removed row is a tombstone for its ref.
  - `watched_listings.unavailable_since`: the first check since which the listing has not quoted a
    price (out of stock, failed, or gone from its page). Every non-quoting write keeps the earliest
    value, and an in-stock quote clears it. Only the history reads it.
  - `listing_price_segments` also stores `final_cents`, and a nullable `ended_at`: where an
    out-of-stock spell (including a merchant gone from its page) began, set on the open segment
    when the listing comes back at a different price. An error spell leaves it null, since an
    error means the price is unknown, not that the product is unavailable.
  - `watch_alerts` is unique on (product_id, kind, price_cents).
  **Reason:** this is the new core data.
  **Code Reference:** precedent → `price_segments` in `src/db/schema.ts`.
- [x] **Step 2:** Repositories:
  - products: create, update and deactivate; `productsDueForResolve(now)`, weekly or never
    resolved;
  - listings: `upsertListing` (keeps `removed`), `removeListing`, `listingsDueForRefresh(retailer,
    now, limit)` (3 h), `recordQuote` (writes the price and segments, clears `last_error`) and
    `recordListingError`;
  - views: `listWatchedProducts(now)` and `watchedProduct(id, now)` giving `WatchProductView`
    (best final price, 30-day low from segments, listings);
  - alerts: `bestHistory(productId, since)`, `sentAlerts(productId)` and `logAlert`.
  - Every text write goes through `storableText` or `storableFields`.
  -- **MODIFIED:**
  - `upsertListing` returns its outcome, one of `inserted`, `updated`, `kept` (another live
    ref for that store stays) or `removed` (untouched).
  - `recordPageQuotes` handles a page quoting several merchants (Buscapé). It upserts each
    merchant, then quotes only the live rows.
  - A segment opens when the price or the final price changes. Out-of-stock quotes write none.
  - The best offer skips listings whose last check failed.
  - `recordListingError` also stamps `checked_at`.
  - `bestHistory(productId, since, before?)` is the step series of the best price, and
    `before` excludes the current check.
  - `markResolved` was added.
  - Review fixes (review-w2):
    - `bestHistory` counts each listing's price until its next observation, so the history agrees
      with the best offer:
      - a segment counts until the next segment of the same listing starts, or until its
        `ended_at` when that comes first. A stock-out between two prices counts neither price,
        while an error between them keeps the earlier one, so the next move is measured from it
        and not from the second-best store;
      - a listing's last segment is open-ended when the listing still quotes it (in stock, no
        error, same final price);
      - otherwise it counts until `unavailable_since`, falling back to `checked_at`. The review
        asked for `checked_at`, but that moves on every check, so a listing that stays out of
        stock (or a merchant that left a Buscapé page, re-marked on each page refresh) kept its
        stale price forever and hid later drops;
      - the best is evaluated at every segment start and finite end;
      - the query reads the segments seen since the window start plus each listing's latest
        segment before it.
    - `quotesPrice(listing)` in `watch-listings.ts` is the rule shared by the best offer and the
      history.
    - `recordPageQuotes` marks the page's live merchants that are missing from the quotes as out
      of stock, checked now, with no error and no segment. An empty quote list marks them all.
    - `recordPageError(productId, retailer, ref, error, now)` records a failed page on its live
      merchant rows.
    - `merchantKey(merchant)` now gives the folded key, and `merchantName(merchant)` the display
      name.
    - `recordQuoteIn` reads the listing's `unavailable_since` and `in_stock` (for update) before
      its update. When a new segment opens and the listing was out of stock, the previous open
      segment gets `ended_at` = `unavailable_since`. The same-price extension is unchanged.
    - The view's `low30dCents` is the lowest point of `bestSteps` over the last 30 days, from the
      same segment query (`productSegments(productIds, since)`) that `bestHistory` uses, so the
      view and the history agree.
    - `watchedProduct(id, now)` reads only active products, so a stopped product is not found.
      `productsDueForResolve` and the due-listing and due-page queries already skip inactive
      products. `updateProduct` still finds a stopped product, so `PATCH active: true` can resume
      it.
  **Reason:** the runtime and the UI read and write through these.
- [x] **Verify:** tsc, lint and the full vitest pass. Read-only EXPLAIN of the view queries.
  -- **MODIFIED:** the new tables don't exist yet, so the selects were EXPLAINed with read-only
  stand-ins of the same shape, and all of them planned. tsc and lint show one error and one
  warning, both in Task 60's `parse-americanas.ts`.
  -- **MODIFIED (review fixes):** the watch storage tests pass (watch-alerts 18, watch-listings
  24, watch-products 12), the full vitest passes, and lint has no errors. tsc shows errors only
  in the stale `.next/types/validator.ts`, left by the Task 62 removal in progress. The new `bestHistory` select ran read-only against CTE
  stand-ins and picked exactly the expected segments.

### Task 62: Runtime and API, removal of discovery and the market crawl

**Files:** `src/ingestion/watch/*`, `src/ingestion/cycle.ts`, `src/instrumentation.ts`,
`src/app/api/watch/*`. Deletions: the market crawlers and rematch, the discovery and Buscas
steps, the searches, alerts and items API routes that only Ofertas, Buscas and Alertas used.

- [x] **Step 1:** Source clients, each paced per site, hold-aware, with backoff:
  - Americanas: HTTP JSON (search by EAN or text, refresh by productId);
  - Buscapé: HTTP (search, product page);
  - Kabum: product page over HTTP, search in Chrome;
  - Amazon: search and product page in Chrome.

  The Chrome sources run only when `chainIdle()`, using the existing Amazon browser and its
  profile.
  **Reason:** a few requests per product replace the catalog.
  -- **MODIFIED:**
  - `src/ingestion/watch/site-gate.ts`: per-site gate (any `requestHold`, the price pause
    included; backoff 15 min, 1 h, 4 h, 24 h on a wall or 3 unreadable pages; HTTP 10 s + 3 s,
    Chrome 30 s + 10 s; Chrome only while `chainIdle()`). Its counters live in memory and reset
    on a restart.
  - `chrome-pool.ts`: one lazily opened Amazon-profile Chrome shared by both loops, one page load
    at a time, closed when no pass uses it and at once when an ML job starts.
  - `sources.ts`: one function per request. The HTTP client is
    `src/ingestion/market/http-client.ts` (`fetchMarketPage`, renamed from `kabum-client`).
  - Kabum search loads with the scroll settle, so the client-side render can finish (unverified:
    no real request was made).
- [x] **Step 2:** The resolver, on add and weekly: per store, search, then `chooseMatch`, then
  `upsertListing`. A removed listing is never re-added. EAN discovery through Americanas follows
  the design.
  -- **MODIFIED:**
  - `src/ingestion/watch/resolve.ts`, order: the pasted link, Americanas, Amazon, Kabum, Buscapé.
  - A link product is created with name = query = the canonical link URL. The link step reads its
    page, names the product (`query = compareQuery(title)`) and records the quote. An Americanas
    link also gives the EAN (`link`). An ML link only becomes the ML listing; the ML cycle names it.
  - A barcode search with no match falls back to the text search (Americanas, Amazon).
  - Store listings are keyed with `merchant: null`, so there is one live listing per store;
    only Buscapé keeps one per merchant.
  - A store that is held, blocked, walled or unreadable stays pending in memory, and only the
    pending stores are retried; `markResolved` runs once every store is done. A product whose
    request failed (wall or unreadable page) backs off from 1 min to 1 h before its next try.
  - A link page without a quotable offer still names the product: the Amazon, Kabum, Buscapé
    and Americanas parsers return the product title with the failure (`SourcePage` failures
    gained `title?`; an Americanas product with no SKU in stock is now 'empty' with its name
    instead of an empty 'ok' list). A link that gives no title (404, unknown Americanas product)
    keeps its listing with the error, where there is a ref, and the product is marked resolved
    instead of retried.
- [x] **Step 3:** The refresher: due listings every 3 h. The quote goes through `recordQuote`,
  then `decideAlerts` on the product, then a desktop notification and `logAlert`.
  -- **MODIFIED:**
  - `refresh.ts` runs the sites in parallel, `WATCH_REFRESH_BATCH` (20) per site per pass.
  - Buscapé pages go through `pagesDueForRefresh`, then `parseBuscapeProduct` with the product
    name, then `recordPageQuotes`, which takes an empty list for an 'empty' page. A failed page
    goes to `recordPageError`. Only a pasted Buscapé link reads its page without a name, before
    the product has one; a test covers link, then name, then a refresh filtered by that name.
  - `price-alerts.ts` (`checkAlerts`) logs first and notifies only when `logAlert` is true, so a
    concurrent check can't notify twice. The text is "Preço baixou: <nome>", then
    "R$ X na Amazon" and the reason; it links to `/produtos/<id>`.
- [x] **Step 4:** The ML cycle step `watchMl`, replacing discovery and Buscas:
  - for each active product, load the ML search by EAN, else by query, and read the cards with
    the existing readers;
  - run `chooseMatch`;
  - the final price comes from `couponHint`;
  - then `recordQuote` and the alerts.
  - Keep harvest and activation.
  -- **MODIFIED:**
  - `src/ingestion/steps/watch-ml.ts` and `watch-ml-pages.ts`.
  - Exactly one ML search page per product per cycle. A tracked listing is searched by the kind
    that found it (barcode with an EAN, else the query). Without one, the EAN is searched unless
    the last EAN search for that product found no match (kept in memory), then the query.
  - A tracked listing found in the cards is quoted from them. One missing from its own search gets
    the error "O anúncio não apareceu na busca do Mercado Livre".
  - A page with results but no readable card is a reader failure; 3 in a row stop the step. The
    monitoring pause is checked before every product.
  - Cycle health now reads `watchPages`, `watchEmpty`, `watchCards` and `watchDropped`; the
    discovery-only warnings (`fewItems`, `noLinks`, `basisOther`) are kept as codes that never fire.
    `listings` warns only from `HEALTH_MIN_WATCH_PAGES` (10) pages: more than 10% failed, or every
    page empty. An empty ML result is otherwise normal.
  - The EAN miss is decided after adopting: only an adopted candidate clears it.
  - Removed refs (every row of that ref removed, so a Buscapé page counts only when all its
    merchants were removed) are loaded in one query per ML step or resolve pass and filtered out
    before `chooseMatch` at every store, so the next-best candidate wins.
  - An ML link listing reads its product page and names the product. Those reads use the breaker's
    uncounted `probe`, so a dead link never trips the consecutive-load stop (a wall still stops the
    run). After `LINK_FAILURES_IN_ROW_MAX` (3) link failures in a row, the remaining links of the
    step are skipped (any good read resets the streak) while the searches go on. At the end of the
    step a failed link advances its counter only if another link page of the same step was read in
    full (`linkRead`); search pages and the harvest don't count, so an item-page layout change
    gives up nothing. A lone dead link with no other link product is never given up. Products go in order of their ML listing's last check, never
    checked first, so links skipped in one cycle lead the next.
    After `LINK_GONE_CYCLES` (3) such cycles the listing gets `ML_LINK_GONE`
    ("O anúncio do link não existe mais no Mercado Livre. Remova-o para buscar outro."), which
    is written with `recordListingGone` (out of stock, so a cleared error never re-quotes the old
    price) and stops reading it; "Buscar agora" clears it. No ML fixture
    shows a recognisable gone-item page and `loadPageProps` hides the HTTP status, so the give-up
    is count-based only.
  - A product still named by its link (or any URL) is never text-searched: with an EAN only the
    EAN is searched, without one the ML step skips it (`watchSkipped`) and the resolver counts the
    text-only stores as done. An ML link stays pending in the resolver until the ML cycle names it,
    or until its link listing is given up or removed.
  - The step skips under the price-only pause.
  - Cycle counts `watchProducts`, `watchMatched` and `watchFailed` replace the discovery and
    Busca counts.
  - Tested with fakes only; no ML page was loaded.
- [x] **Step 5:** API routes:
  - `POST /api/watch` to add (name or link, EAN, target);
  - `PATCH` and `DELETE /api/watch/[id]`;
  - `DELETE /api/watch/listings/[id]`, which removes the listing;
  - `POST /api/watch/[id]/refresh`, which queues a resolve and refresh.
  -- **MODIFIED:**
  - `POST` returns 201 `{id, started}`, with `started` false when `AUTO_RUN=off`.
  - `PATCH` and `DELETE` return 404 for a stopped product (a `PATCH {active: true}` still
    resumes it), checked with the light `activeProductExists` in `src/db/monitoring.ts`. A name or EAN change re-runs the search. `DELETE` deactivates.
  - Refresh returns 202, 409 with the hold text, 409 "Verificações automáticas desligadas
    (AUTO_RUN=off)" or 404. It clears `resolved_at` and marks the product's non-ML listings due.
  - The listing `DELETE` returns 404 when the listing is removed or its product is stopped.
  - Validation is `CreateWatch` and `UpdateWatch` in `src/lib/validation.ts`, on
    `src/lib/watch/input-rules.ts`.
  - Loops: `startWatch()` in `src/instrumentation.ts` (`src/ingestion/watch/loops.ts`), with a
    resolver and a refresher loop, an error backoff from 1 min to 1 h, and nothing started when
    `AUTO_RUN=off`.
  - `watchStatus(now)` gives the `WatchStatus` of `src/lib/watch/types.ts`. Its queries are in
    `src/db/monitoring.ts`.
  - `/api/health` carries `watch: [{retailer, state, blockedUntil}]` instead of `market`.
- [x] **Step 6:** Delete:
  - the market crawler loops and the rematch;
  - the discovery and Buscas steps;
  - the searches and alerts API and repositories;
  - the dead constants and env (`DISCOVERY_PAGES_PER_RUN`).
  - The tables stay.
  -- **MODIFIED:**
  - `src/ingestion`:
    - `market/{crawlers,kabum-crawler,amazon-crawler,crawl-page,crawler-status,match-local,rematch}`;
    - `steps/{buscas,buscas-pages,discover,discover-pages}`, `search-run` and `announce-queue`;
    - the scheduler's Busca ticks: `schedule.ts` now plans cycles only;
    - `after-run`, which keeps only the session and health notifications.
  - `src/db`:
    - `alerts`, `searches`, `deals`, `items`, `price-checks`;
    - `market-{coverage,offers,searches}`, `crawler-state`, `target-tiers`, `match-targets`,
      `verdict-sql`, `saving` and `check-sql`;
    - in `coupons.ts`: the discovery-attempt, prioritize, linked-items and preview queries, and the
      `withOffers` filter and `ofertas` sort (the text search keeps reading the first 20 items,
      `COUPON_TEXT_ITEMS_LIMIT`);
    - `prune.ts` no longer prunes price checks and market offers.
    - `check-key` stays, because the items index in `schema.ts` uses it.
  - `src/lib`:
    - `alert-digest`, `alert-rules`, `bulk-seen`, `busca-rules`, `coupon-rules`, `deal-query`,
      `deal-view`, `deal-saving`, `drop`, `minimum-gap`, `price-history`, `observations`,
      `pg-errors`, `price-check-rules`, `price-check-view`, `price-drop`, `coupon-preview`;
    - `price-compare/{verdict,links}`, `market/tokens`;
    - `filter-labels` now has only the coupon labels;
    - `ml-url` keeps the URL safety and search slug helpers;
    - the dead labels, domain aliases and constants;
    - `DISCOVERY_PAGES_PER_RUN`, from `env.ts` and `.env.example`.
  - API routes: `searches`, `alerts`, `items/*` and `coupons/priority`.
  - Also removed after review: `cardsOfPage`, `linksToCoupon`, `coupon-order` (verify now reads
    `verifyTargets`), the coupon-hint matching, `listingFromMatch`, and the unused format, batch,
    freshness, query-params, with-api, matcher and Kabum listing helpers.
- [x] **Verify:** tsc, lint and the full vitest pass, with fake deps for every loop.
  -- **MODIFIED:**
  - Lint is clean, and vitest passes: 122 files, 2233 tests, 5 expected fails (after the review
    fixes, which removed dead modules and their tests).
  - Post-deploy fix: 'drop' compares the previous best only with the best over the known
    listings, those with a price segment before this evaluation (`alertHistory` returns their ids
    from the same segment query; `decideAlerts` gets the view's listings and computes the known
    best in memory), so a store's first quote never fires a drop, and the drop names the known
    store. 'target' and 'low_30d' (which already needs a day of history) use the overall best.
  - `WatchProductView` gained `resolvedAt`; a link-named product with `resolvedAt` set shows
    `NAME_UNREAD_TEXT` instead of "Buscando o nome do produto...".
  - tsc is clean except the stale `.next/types/validator.ts`, the old build's list of deleted
    pages and routes, which the next build regenerates.
  - No request was sent to any site, and Chrome was never launched.

### Task 63: UI and README

**Files:** `src/app/page.tsx` (Produtos), `src/app/produtos/[id]/page.tsx`,
`src/components/Watch*`, `src/lib/watch/view.ts`, `src/app/conta/page.tsx`, the nav, `README.md`.
Deletions: the Ofertas, Buscas and Alertas pages and components.

- [x] **Step 1:** Produtos:
  - the list, with the best price, store, 30-day low and alert summary;
  - the "Adicionar produto" form (nome ou link, EAN, preço alvo);
  - an empty state.
  -- **MODIFIED:** `src/app/page.tsx`, `src/components/WatchAddForm.tsx`, `WatchProductCard.tsx`,
  `WatchBestPrice.tsx`, `FieldError.tsx`. The card shows the target note (not a full alert summary,
  which is on the detail page). After an add the form clears, focus returns to the name field and a
  status line links to the new product. The form checks links and the 200-character name like
  `CreateWatch`, and the server's field errors show under their fields. A product whose name is
  still its link shows the store, "Buscando nome do produto..." and the link (`productHeading`).
- [x] **Step 2:** Product detail:
  - store rows (price, list price, final price, match label "código de barras", "automático" or
    "link", last check, link, "Remover este anúncio");
  - the alert settings;
  - "Buscar agora".
  -- **MODIFIED:** `src/app/produtos/[id]/page.tsx` with `WatchListings`, `WatchSettingsForm` and
  `WatchActions`; "Parar de monitorar" added (`PATCH {active:false}`, then back to `/`). Removing a
  listing moves focus to the "Lojas" heading. A 409 from "Buscar agora" shows the hold text next to
  it. A stopped product's page 404s once `watchedProduct` filters `active` (impl-w2).
- [x] **Step 3:** Conta's "Monitoramento" panel replaces "Comparação de preços". The nav becomes
  Produtos, Cupons, Conta.
  -- **MODIFIED:** the panel reads `watchStatus(now)` from `src/ingestion/watch/loops.ts` through
  `monitorPanel` in `view.ts`; "Parado" (`stopped`) shows in amber like held and blocked, and ML has
  no "Requisições hoje". Últimas execuções labels the new `watchProducts`, `watchMatched` and
  `watchFailed` counts; old runs keep their old labels. The nav marks Produtos active on
  `/produtos/*` too. Also deleted:
  `src/app/{buscas,alertas}`, the components AlertButton, BulkSeenButtons, CompareButton, DealCard,
  DeleteAlertButton, FilterBar, StatusButtons and PrioritizeButton, the views alert-note,
  bulk-seen-view, cycle-banner, deal-empty, busca-view, priority-view, typeahead and
  `lib/market/view.ts` with their tests, the dead filter controls, api.ts calls and labels.
  `price-check-view` stays (`src/db/price-checks.ts` imports it). Cupons lost "Ver ofertas destes
  cupons", "Priorizar no próximo ciclo", the row's "Ver ofertas", "Ofertas ligadas", "Última busca
  de ofertas", previews and the priority badge, and the "Só com ofertas ligadas" filter toggle; the
  "Mais ofertas ligadas" sort stays (it lives in `domain.ts` and `db/coupons.ts`).
- [x] **Step 4:** README: the new purpose, the stores and their limits, the pace, the holds and
  the alerts.
  -- **MODIFIED:** also rewrote Pages, the cycle steps, Configuration (no
  `DISCOVERY_PAGES_PER_RUN`), Persistence and Known limitations; removed Deal ranking, Ofertas,
  Buscas, Alertas and the catalog. The price-only pause follows `steps/watch-ml.ts` (it holds ML's
  watch step too); the `/api/health` line is kept generic until Task 62 settles that route.
- [x] **Verify:** tsc, lint and the full vitest pass, with pure view tests.
  -- **MODIFIED:** after review-w4's fixes (failed checks read as "Última tentativa", shared
  `src/lib/watch/input-rules.ts`, the price hold renamed "Monitoramento", the "Mais ofertas
  ligadas" sort and `comOfertas` filter removed, a stop confirmation on Produtos via `?parado=1`,
  `storeInText` for the alert body, the `started: false` notice on add): lint is clean, vitest passes
  (123 files, 2233 tests, 5 expected failures), and tsc errs only in the stale
  `.next/types/validator.ts`, which the deploy's `npm run build` regenerates.

### Task 64: Deploy (team lead)

- [x] **Step 1:** Run the gates and the reviews. In an idle window: stop the service, apply 0017,
  build, start, then lift the price-only pause.
  -- **MODIFIED:** deployed 2026-11-06 19:39 UTC (0017 applied, 18 migrations), the pause lifted at
  19:41. A second code-only deploy at 19:49 UTC shipped the alert fix below, the add form's clean
  `/` reload (a stale "Produto retirado" notice survived `?parado=1`) and the color hint in the
  name help text. A third code-only deploy at 20:00 UTC shipped `quotesPrice` in one place
  (`src/lib/watch/listing-state.ts`) and the "searched, no store found" texts: NO_MATCH_TEXT with
  "Buscado há X" on the card and the best-price section, and "Nenhum anúncio acompanhado." in Lojas.
- [x] **Step 2:** Add 2 to 3 real products and watch the first resolve and refresh in the journal.
  Check Produtos and the detail page in the browser, with outside requests blocked.
  -- **MODIFIED:** the watch loops log nothing per request, so the resolve was read from the DB and
  Conta's Monitoramento panel. Products added:
  - JBL Tune 520BT Preto with its EAN: Amazon and Americanas by barcode, Kabum and Buscapé (Want
    Import) automatic, all within 40 s.
  - "Echo Dot 5ª geração" by name: Americanas, Kabum and Buscapé (Magazine Luiza); each store
    showed a different color, since the name has none.
  - "Kindle 11ª geração 16GB Preto": only an Amazon accessory at R$ 60,80. Removing it, then
    "Buscar agora", found no other match (a matcher follow-up).
  The browser checks passed: the add form's errors, Produtos, the detail rows, "Remover este
  anúncio", Conta Monitoramento, Cupons without "Mais ofertas ligadas", the `?parado=1` notice,
  and the old routes giving 404.
- [x] **Verify:** every store resolves or reports why not; the alerts log works.
  -- **MODIFIED:** the first resolve sent false 'drop' alerts (JBL R$ 207,13, Echo Dot R$ 449,10)
  as each new store came in cheaper than the first. Fixed in the 19:49 deploy: 'drop' only
  compares stores that already had a price before this check, so a store's first price is a
  discovery, and the notification names the store that dropped. ML is resolved by the first cycle
  after the deploy (20:34 UTC).

## Execution Protocol

**How to execute this plan:**

1. Read the entire Context section before starting any task.
2. Execute tasks in the order given in the Progress Summary.
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
