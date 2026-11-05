# promo-cps: Mercado Livre coupon and deal finder: design

Date: 2026-10-31

## Goals

1. Harvest every coupon available to Fernando's Mercado Livre (ML) account, with the terms its list
   entry shows (minimum, limit, validity) and a sample of the products it applies to: page 1 of each coupon's listing, read in rotation. Full
   listings are not read (median ~330 items, up to 762,911); his Buscas cover what he watches.
2. Rank products into a list of good deals by written, explainable rules: ML's discount, plus a
   badge when the price is a real drop below the item's own 30-day low.
3. Let him watch general interests (a pasted ML search) and specific items (a pasted product
   page), and get a desktop notification when a watched view gains a good deal.
4. Run locally, on a schedule, mirroring olxmapper's stack and shape.

Out of scope: buying, cart or checkout; stores other than ML; email, push or mobile alerts;
price forecasting; systemd packaging (later).

## What was verified on 2026-10-31 (his logged-in session)

- `/cupons` needs login; a logged-out load redirects to `/login/identification`.
- ML's public API (`api.mercadolibre.com/sites/MLB/search`, `/items`) answers 403. Plain HTTP on
  `lista.mercadolivre.com.br` redirects to `/gz/account-verification`.
- Headless Chromium (headless shell and new headless, any user agent) gets the verification page,
  an error page, or `/captcha/wall`. Headed Chromium and headed Chrome on an Xvfb display, not
  logged in, load search and coupon listings normally from the same IP right after. Cause:
  headless detection. In the confirmation test, Playwright's bundled Chromium (149) and Google
  Chrome (152) both passed. (Superseded on 2026-11-02: ML refused logins from the bundled Chromium, so the app uses system Google Chrome; see the "Browser" bullet below.)
- Every page carries its state as JSON at `window._n.ctx.r.appProps.pageProps`.
- Coupons: `/cupons/filter?all=true&page=N`, 30 per page, `filteredCouponsData.pagination.total`
  pages (102 for 3051 coupons), ~0.7 s and ~400 KB per page. Per coupon (`rawCoupons[]`):
  `campaign_id`, `title.text`, `initial_subtitle.text` ("Em produtos selecionados" or
  "Em produtos de <Loja>"), `amount.accessibility.{min_amount,cap_amount}.{fractional_amount,
  decimal_amount}`, `status.id` (ACTIVE/INACTIVE), `activation_type` (EU_QUERO/AUTOMATIC),
  `code`, `future_coupon_info.{start_date,expiration_date}` (ISO), `items[]` (4 previews),
  `action` (INACTIVE: "Aplicar" button; ACTIVE: link in `action.value`).
- Sample of 330: 83% ACTIVE. Store coupons are AUTOMATIC and active; ML's "selecionados" coupons
  are EU_QUERO and almost all inactive. All titles parse as "%" or "R$".
- Amounts: `fractional_amount` is a pt-BR integer string ("4.999" = 4999, "10.000"); centavos are
  in `decimal_amount` ("R$ 16.99 OFF" has fractional "16").
- Terms (`GET /cupons/api/terms?campaign_id=<id>`): `min_amount` is a minimum payment per order;
  `cap_amount` is a per-user total discount ceiling; discounts are "não cumulativo"; some
  coupons exclude items sold by ML (1P); a coupon can end early when stock or budget runs out.
- Activation: `POST /cupons/api/activate?coupon_activate_code=<code>&campaign_id=<id>&origin=filter&activation_method=EU_QUERO`.
  Tested once ("R$ 600 OFF em Informática"): it became ACTIVE and its `action.value` became
  `lista.mercadolivre.com.br/_Container_intel-600?coupon_campaign_id=14566020`, a named
  container, with 28 notebooks priced "com Cupom". A guessed `_Container_<campaign_id>` fails for
  12 of 20 inactive coupons, so links are never built, only read.
- Listing links: `/pagina/<store>/`, `/loja/<store>/`, `_CustId_<seller>` (redirects to the store
  page and drops `coupon_campaign_id`), `_Container_<NAME>-seller-<id>`, `_Container_<id>`.
  In a sample of 11 of the 102 pages, 277 active coupons point to 276 distinct listings (so about
  2,500 distinct listings exist today). Sizes: median ~330 items, one of 762,911.
  ~1.9 s per page of 48. Sorts: relevance (default), `_OrderId_PRICE`, `_OrderId_PRICE*DESC`.
- Product cards (`polycard`): `metadata.{id,product_id,url,url_params,is_pad}`, components
  `title`, `price` (`current_price.value`, `price_labels` with the "de" price, `discount_pct`,
  `discount_complement`, `installments`), `shipping_v2` (free shipping, FULL), plus
  `metadata.tracks.sold_quantity`. Sponsored copies (`is_pad: "true"`) carry a click-tracker URL
  and duplicate organic cards; organic cards carry
  `www.mercadolivre.com.br/<slug>/p/<product_id>` plus `?pdp_filters=item_id:<id>`.
- Price basis: `discount_complement` says what `current_price` assumes: "com Cupom",
  "no Pix", "no Pix com Cupom", or nothing. On a logged-in page, ML prices every ACTIVE coupon
  into `current_price`.
- Logged out (2026-11-01, headed browser, fresh profile):
  - Readable: search pages and coupon listings, with prices, ML discount, Pix basis, store coupons
    priced in ("com Cupom" on 46 of 48 cards of a store coupon's listing), a separate per-card
    `promotions` component with a "com Cupom" price, and the public Ofertas page.
  - Not readable: the coupon list (`/cupons/filter?all=true` redirects to login), the terms API
    (401), activation (an account action), product pages (captcha wall on the first direct visit).
  - Anonymous sessions were walled quickly: after 3 pages the next fresh anonymous session got
    `/captcha/wall` on every page, while the logged-in session loaded the same listing normally at
    the same time. Logged in, about 60 pages loaded without a wall that night.
  - Conclusion: login is required for the coupon list, Mercado Livre's own coupons and activation,
    and it is what keeps page reads unblocked at the planned volume.
- Login (2026-11-02): five login attempts in Playwright's bundled Chromium were refused at identification (`no-feasible-authenticators`); the same account and IP stayed logged in in system Chrome launched without automation flags. Moving that session's cookies into the app profile worked: the hidden app browser read the coupon list (1,927 coupons) without logging in.
- Captured 2026-11-02 on the secondary account (6 page loads, 1 activation; fixtures in
  `src/ingestion/ml/__fixtures__/`, exact paths in plan Task 12):
  - The coupon count varies per account: 1,926 coupons over 65 pages here (the ~3,051 above was the
    personal account).
  - Prices of R$ 1.000 and up lose their centavos in `current_price.value` (the displayed price);
    `metadata.tracks.price.price` is exact but present on only some cards. The app stores the
    displayed price everywhere, so mixing sources never creates fake price changes; the 1% drop
    minimum makes the lost centavos irrelevant.
  - A coupon that is not priced in shows as a separate card component `promotions[type=coupon]`
    ("15% OFF com Cupom", "R$ 200 OFF com Cupom", or "R$ 1.674 com Cupom" as the price after the
    coupon). On one store listing 45 of 48 cards had only this (items below the coupon minimum), but
    on a coupon listing 8 of 12 such hints were other coupons. So a hint links an item to the
    listing's coupon only when it matches that coupon (same percent, same amount, or the matching
    price after it); otherwise the hint is shown on the card without attributing it.
  - "Frete grátis" was the account's first-purchase perk on 108 of 109 cards (label "por ser sua
    primeira compra"); only free shipping without that perk counts as the item's free shipping.
  - Sold quantity is bucketed (25, 50, 100, 500, ...); search pages list each card twice in the page
    data (dedupe by id); no sponsored card duplicated an organic one in these captures.
  - Product pages (`page: "pdp"`) show the best offer chosen by ML; its item id
    (`initialState.history.id`) can differ from other sellers' offers of the same product.
  - Activating needs the page's `x-csrf-token` and runs reCAPTCHA first, so the app clicks
    "Aplicar" in the page instead of replaying the request. The activated coupon's listing link
    appears on the next harvest (verified).
- Not yet observed: activation at volume, session lifetime.

## Architecture

- **Stack (mirrors olxmapper):** Next.js 16 App Router + TypeScript + Tailwind; PostgreSQL 16 on
  127.0.0.1 with its own role and database `promocps`; Drizzle (postgres-js); Vitest.
  `next start -H 127.0.0.1 -p $PORT`. No login screen, no iron-session.
- **Browser (`src/ingestion/browser.ts`, rewritten):** system Google Chrome (`channel: 'chrome'`), headed, launched like the Playwright MCP browser: without `--enable-automation` and with `--disable-blink-features=AutomationControlled` (`navigator.webdriver` false). Verified 2026-11-02: ML refused every login in Playwright's bundled Chromium (`webdriver` true, "Chrome for Testing") with `no-feasible-authenticators`, while system Chrome without the automation flag stayed logged in. The app runs on Fernando's secondary ML account, never his personal one; its only login path is the "Entrar no Mercado Livre" button (sessions are never copied in from other browsers). Headed via
  `launchPersistentContext(ML_PROFILE_DIR)`. Scheduled runs launch it on an Xvfb display the app
  starts for the run (`src/ingestion/xvfb.ts`: `Xvfb -displayfd <fd> -screen 0 1366x768x24
  -nolisten tcp`, so Xvfb picks a free display number itself and a lock left by a killed run
  never blocks the next one; stopped after the run). One browser per run; pages load one at a
  time with `PAGE_DELAY_MS` between them.
- **Login:** the "Entrar no Mercado Livre" button (`/conta`) asks the server to launch the same
  profile headed on his real display (inherited `DISPLAY`/`WAYLAND_DISPLAY`) at ML's login page.
  The server only watches the page and never navigates it. It reports logged in once the page has
  settled on the coupons page (`/cupons`, 3 s unchanged), refused as soon as ML shows
  `no-feasible-authenticators` (ML refused every login method; observed on 2026-11-01, followed by a
  redirect to `/`), and unconfirmed when the page settles on the home page (`/`, 5 s) with no block
  seen. The window closing
  or 10 min passing ends the attempt. The route only accepts a same-origin browser request with an
  explicit `{ confirm: true }` body, so no bare or scripted request can open a window (a click in a
  browser still can, which is why agents never click it). A login requested while
  a run holds the browser shows as queued. First-time setup and re-login after expiry use the same
  button.
- **Local-only actions:** the routes that act (Rodar agora, login launcher, Busca and alert
  changes) accept a request only when its `Origin`/`Host` is `127.0.0.1:$PORT` or
  `localhost:$PORT`, so a page open in his everyday browser cannot trigger them. The check runs
  once, in the shared API wrapper (`with-api.ts`), for every non-GET route.
- **One profile, one user at a time:** login and every run go through the same serialized
  promise chain on `globalThis` (olxmapper `run.ts` pattern).
- **Reader (`src/ingestion/ml/page-state.ts` loads `pageProps`; cards in `src/ingestion/ml/cards.ts`):**
  coupon listings and store pages read only `initialState.results[].polycard`; search pages read the
  `results` of the streamed response paths (and `initialState`); product pages read fixed paths. The
  whole-tree polycard walker remains only for `ml:capture`'s summary.
- **Capture (`npm run ml:capture -- <url>`):** mirrors `olx:capture`: loads a URL through the
  runner, saves raw `pageProps` to `src/ingestion/ml/__fixtures__/` (gitignored), prints what the
  readers extract.
- **Scheduler:** `instrumentation.ts` starts it; `AUTO_RUN=off` disables it.

### olxmapper reuse

| olxmapper file | Here |
|-|-|
| `src/db/client.ts`, `drizzle.config.ts`, `vitest.config.ts` | copied |
| `src/lib/format.ts`, `src/lib/with-api.ts`, `src/lib/api.ts`, `src/components/filters/FilterPopover.tsx`, `src/components/filters/fields.tsx` | copied (`BairroPanel.tsx` is OLX-specific and stays behind) |
| `src/env.ts` | adapted: new keys (see Config) |
| `src/ingestion/run.ts` | adapted: serialized chain also guards login |
| `src/ingestion/schedule.ts` | adapted: one cycle interval plus per-Busca intervals |
| `src/lib/desktop-notify.ts` | adapted: deal digest, session alerts |
| `src/db/alerts.ts`, `src/components/AlertButton.tsx` | adapted: several named alerts, `alert_hits` |
| `src/lib/feed-query.ts`, `src/lib/query-params.ts`, `src/components/FilterBar.tsx` | adapted: deal filters |
| `src/components/ListingCard.tsx` | adapted into `DealCard` |
| `src/app/searches/SearchAdmin.tsx` | adapted into Buscas (ML URLs only) |
| `src/ingestion/browser.ts` | rewritten: headed, Xvfb, persistent profile |
| iron-session, `src/proxy.ts`, login page, OLX/other site adapters, enrichment worker, suspects, areas | dropped |

## Data model

Money is integer centavos.

| Table | Columns | Rules |
|-|-|-|
| `coupons` | `campaign_id` PK, `title`, `kind` (`percent`/`fixed`/`unparsed`), `percent_off`, `amount_off_cents`, `min_payment_cents`, `cap_cents`, `scope_label`, `is_store`, `status`, `activation_type`, `activate_code`, `listing_url`, `starts_at`, `expires_at`, `raw` jsonb, `first_seen_at`, `last_seen_at`, `ended_at`, `activation_tried_at`, `activation_error`, `last_discovered_at`, `discovery_tried_at`, `discovery_priority_at` | Upsert by `campaign_id`. `ended_at` only after two consecutive full harvests miss it, and cleared if the coupon is listed again. `listing_url` only from `action.value`. |
| `items` | `id` (MLB) PK, `product_id`, `title`, `thumbnail`, `url`, `category_id`, `domain_id`, `seller_label`, latest `price`, `basis`, `basis_text`, `list_price`, `ml_discount_pct`, `sold_quantity`, `full`, `free_shipping`, `coupon_hint`, `observed_at`, `drop_ratio` (null without history), `status` (`NOT_SEEN`/`SAVED`/`SEEN`) | Snapshot updated on each observation; `drop_ratio` recomputed for items observed in the run. The key is the item id (settled: product pages are read by the item id shown, `history.id`; `product_id` is stored alongside). |
| `price_segments` | `item_id`, `price`, `basis`, `first_seen_at`, `last_seen_at` | New row only when price or basis changes, else `last_seen_at` moves. Nothing is pruned in v1. |
| `item_sources` | `item_id`, `source_type` (`coupon`/`search`), `source_id`, `first_seen_at`, `last_seen_at` | Never deleted by a run. A link not seen within `STALE_AFTER_HOURS` is aged: its coupon chip is hidden and it no longer counts for the Cupom filter. |
| `searches` | `id`, `name`, `url`, `kind` (`search`/`product`), `enabled`, `run_every_hours`, `last_run_at`, `last_status`, `last_error` | `https` only, host exactly `mercadolivre.com.br` or ending in `.mercadolivre.com.br`; kind detected from the URL; anything else is rejected on save with the reason. |
| `runs` | `id`, `kind` (`cycle`/`search`/`login`), `started_at`, `finished_at`, `status` (`ok`/`partial`/`failed`/`session_expired`/`blocked`, and for login runs `logged_in`/`unconfirmed`/`refused`/`timed_out`), `pages`, `counts` jsonb, `error` | Last status per kind drives UI banners and session notifications. |
| `alerts` | `id`, `name`, `query`, `created_at` | Several allowed; `query` normalized with olxmapper's `normalizeAlertQuery`. |
| `alert_hits` | `alert_id`, `item_id`, `price`, `alerted_at` | One row per alert and item. Re-alert only when the new price is lower than the stored one; that re-alert updates the row's `price` and `alerted_at`. |

Coupon terms (`/cupons/api/terms`: 1P exclusion, early end by stock or budget) are not read in
this version. ML's logged-in price already reflects whether a coupon applies to an item, and the
app does no coupon arithmetic, so the list fields above are what the UI shows.

## Run pipeline

A cycle runs every `RUN_EVERY_HOURS` (and on "Rodar agora"). Buscas also run on their own
interval. Steps, in order, inside one browser session:

1. **Preflight** (the harvest's first page, not a separate load). Start Xvfb, launch the profile,
   load `/cupons/filter?all=true`. A redirect to `/login/identification` ends the run as
   `session_expired`; `/gz/account-verification` or `/captcha/wall` ends it as `blocked`. Neither
   retries in a loop. Busca-only runs have no preflight and read pages that load logged out, so only
   a cycle proves the session works (the scheduler pause and "Sessao ativa" use the last worked cycle).
2. **Coupon harvest.** Read pages 1..`pagination.total`, capped at one page past what ML's total needs and stopped early by
   an empty or unreadable page. Upsert every coupon, dedup by
   `campaign_id` (activations shift pages mid-read). Parse amounts from `fractional_amount` +
   `decimal_amount`; `kind` from "%" or "R$" in the title, else `unparsed` (kept, counted in the
   run summary). A harvest is full when every page loaded as the page it was asked for, ML's total is
   above zero, the page count covers that total at page 1's page size, and the coupons read fall
   short of the total by less than one page. ML's total
   drifts while it is read (1,933, then 1,932, on 2026-11-02), so a coupon is ended only after it is
   missing from two consecutive full harvests; a partial harvest ends nothing.
3. **Activation.** Up to `ACTIVATE_PER_RUN` coupons (0 = off) that are INACTIVE, EU_QUERO, valid
   now, not ended, and not tried in the last 24 h, strongest first. Each is a click on the coupon's
   "Aplicar" button on the coupons page where it was last seen; success is the activate response
   for that `campaign_id` with a `link` action. Success or ML's error text is stored. Two clicks in a
   row with no response stop the run as blocked; candidates never attempted are not recorded.
   `listing_url` arrives with the next harvest.
4. **Buscas.** Each enabled, due Busca: a `search` URL reads `SEARCH_PAGES` (2) pages; a `product`
   URL reads its page (reader built from the slice 1 capture). Every card becomes an observation
   and an `item_sources` link to the Busca.
5. **Discovery.** Coupons with a `listing_url`, valid and not ended, ordered by `discovery_tried_at`
   (never-tried first, so every coupon is attempted once per rotation and a listing that keeps failing
   moves to the back), strongest first within that order, read page 1 of `listing_url` as given, up to
   `DISCOVERY_PAGES_PER_RUN` pages minus the pages the cycle's Buscas read, so a cycle stays near
   the harvest plus that budget however many Buscas exist. A `listing_url` shared by several coupons is read once per
   run and its cards are linked to all of them. Cards whose basis includes a coupon get an
   `item_sources` link to the coupon(s). `last_discovered_at` moves, so the next cycle continues
   the rotation (about 2,500 listings today, ~2,800 after activation: ~9 to 10 cycles, ~30 h).
6. **Drops.** `drop_ratio` is recomputed for each page's items as they are recorded.
7. **Record** the run: status, pages, counts (coupons seen/new/ended/unparsed, activated/failed,
   items observed, Busca and discovery counts).
8. **Alerts**, after the run row is finished and outside the run chain: digests for every
   finished cycle or Busca run whatever its status, and a session notification when the status
   changed from the previous run of the same kind.

**Observation.** For each card (sponsored duplicates merged by item id): upsert `items`, extend or
open a `price_segments` row. Basis from `discount_complement`: "Pix" and "Cupom" give
`pix_coupon`, "Pix" gives `pix`, "Cupom" gives `coupon`, none gives `none`; any other text is
`other` (stored in `basis_text`, excluded from scoring). Missing fields stay null (unknown), never
0 or false. URL from the organic card's `url` + `url_params`.

**Coupon strength.** ML coupons (`is_store = false`) before store coupons; within each group, by
equivalent percent: the percent itself, or a fixed amount divided by its minimum payment, capped
at 100% (minimums of R$ 1.00 exist). A
coupon whose equivalent percent is unknown (`kind = unparsed`, or a fixed coupon with a null or
zero minimum payment) sorts last within its group and is never divided.

**Failures.** A page error or timeout retries once after `PAGE_DELAY_MS`, then is skipped and the
run becomes `partial`. A browser crash fails the run; writes are per page and idempotent, so the
next run simply starts over. A missing `Xvfb` binary, a missing Google Chrome, a profile
already in use, or Xvfb failing to start ends the run as `failed` with the real cause in
`runs.error`. The statuses `session_expired`, `blocked` and `failed` each send one desktop
notification when the status changes (not on every run). The last finished cycle's `session_expired`, `blocked` or `failed` shows a banner on Ofertas until a later cycle works (or, for `session_expired`, a later login succeeds).

## Deal ranking (his answer, 2026-10-31)

Discovery usually first sees an item with its coupon already in the price, so an own-history
score alone would drop flat coupon prices out of the list after 7 days. Ranking therefore uses
ML's discount, and history marks real drops:

- **Rank:** `ml_discount_pct`, ML's percent off its "de" price, coupon and Pix included as shown.
  This is the default sort on Ofertas.
- **Real drop:** `min_prev` = lowest price among the item's `price_segments` other than the
  current one (the open segment holding today's price), with `last_seen_at` in the last
  `HISTORY_DAYS` (30). With history (first segment at least `HISTORY_MIN_DAYS` (7) old) and
  `price < min_prev`: `drop_ratio = (min_prev - price) / min_prev`, shown as the badge
  "X% abaixo do menor preço em 30 dias" when it is at least 1% (`MIN_DROP_RATIO`). The badge
  stays while the price holds. Equal or higher price, or a drop under 1%: no badge. History is the
  time since the earliest price seen in the 30-day window (the current price's first sighting
  counts): under 7 days of it (a new item, or one back after a gap), `drop_ratio` is null and the
  card says "sem histórico". Earlier prices with the unrecognized `other` basis never take part, and
  a current price with that basis earns no badge.
- **Pix:** Fernando pays by Pix (his answer, 2026-10-31), so every basis is a price he could have
  paid and history compares across bases. Basis is kept per segment, so a card-payer mode can
  later compare only non-Pix prices.
- **An offer** is an item with `ml_discount_pct > 0` or a real-drop badge. Items with neither stay
  browsable in the feed but are never alerted.

## Interface (pt-BR, mirrors olxmapper)

- **Header:** Ofertas, Cupons, Buscas, Alertas, Conta, plus a status chip (last run, login state).
- **Ofertas (`/`):** olxmapper's pill-bar filters with popovers: Busca, Cupom, preço máximo,
  desconto mínimo, economia mínima (% and R$), só abaixo do menor preço, vendidos mínimo, FULL,
  frete grátis, categoria, and a coupon set (`cupons`, from Cupons). Sort: desconto ML (default),
  economia total (% and R$), queda real, preço, recentes (economia: see the cupons-filters design). Tabs Novos / Salvos / Vistos. Filters live in the URL.
  Items not observed within `STALE_AFTER_HOURS` are hidden unless the "incluir não vistos
  recentemente" filter is on.
  Paginated server-side (48 per page, `LIMIT/OFFSET` over indexed columns); the client never
  loads the full set.
- **Deal card:** image, title, price with its basis as text ("no Pix com Cupom"), ML's discount
  and "de" price ("47% OFF, de R$ 8.786"), the real-drop badge ("12% abaixo do menor preço em
  30 dias") or "sem histórico", when it was last seen ("visto há 5 h"), sold
  quantity, FULL, frete grátis, linked coupon chips labelled "visto na lista do cupom" (title,
  validade, "pedido mínimo R$ X" when the price is below it; only coupons not ended and not past
  `expires_at`). The chip records where the item was seen, not which coupon ML applied. Link to
  the ML item.
  Meaning never by color alone.
- **Cupons (`/cupons`):** every harvested coupon, server-paginated: title, escopo (ML or loja),
  status (Ativo / Inativo / Encerrado), compra mínima, limite, validade, linked items, last
  discovery, activation error. Filters: status, tipo, escopo, vence em breve. Links: "Ver no ML"
  (`listing_url`) and "Ver ofertas" (Ofertas filtered by the coupon).
- **Buscas (`/buscas`):** olxmapper's SearchAdmin: name, pasted ML URL (search or product page),
  enabled, interval, Rodar agora, last status and error.
- **Alertas:** "Alertar" on Ofertas saves the current view under a name; `/alertas` lists and
  deletes them.
- **Conta (`/conta`):** login state, "Entrar no Mercado Livre", last runs with their status.
- **Empty and error states** name the real cause (no coupons yet, login expired, blocked, no
  history yet) instead of an empty table.

## Alerts

- After each cycle or Busca run: for each alert, offers observed in this run that match its saved
  view, excluding items with an `alert_hits` row at the same or lower price. The view decides how
  strict an alert is: adding "só abaixo do menor preço" alerts only on real drops.
- An item matching several alerts is announced once, under the first alert, and a hit is recorded
  for every alert it matched, so deleting one alert never re-announces it under another.
- One `notify-send` digest per alert (olxmapper format: count + top samples, Abrir opens the
  view), so a busy run sends at most one notification per alert.
- Hits are recorded before notifying, so a failed notification never repeats an alert.
  `notify-send` failures are logged.
- Session notifications: Abrir opens `/conta`.

## Config (`.env`, validated by zod like olxmapper)

| Key | Default | Meaning |
|-|-|-|
| `DATABASE_URL` | none | local Postgres 16 |
| `PORT` | 8510 | never 8500 (olxmapper) |
| `ML_PROFILE_DIR` | required, absolute path (setup writes `$HOME/.local/share/promo-cps/profile`) | Google Chrome profile with the ML session |
| `AUTO_RUN` | on | scheduler switch |
| `RUN_EVERY_HOURS` | 3 | cycle interval |
| `PAGE_DELAY_MS` | 1500 | pause between page loads |
| `ACTIVATE_PER_RUN` | 20 | 0 turns activation off |
| `DISCOVERY_PAGES_PER_RUN` | 300 | about 15 min of reading; a cycle's Busca pages come out of it |

Named constants in code (`src/lib/constants.ts`), not config:

| Constant | Value | Meaning |
|-|-|-|
| `SEARCH_PAGES` | 2 | pages per search Busca |
| `HISTORY_DAYS` | 30 | real-drop window |
| `HISTORY_MIN_DAYS` | 7 | history needed before the real-drop badge |
| `MIN_DROP_RATIO` | 0.01 | smallest drop that earns the badge or an alert |
| `STALE_AFTER_HOURS` | 72 | items and coupon links not seen for longer are hidden or aged; above the longest Busca interval (24 h) and one discovery rotation (~30 h) |

The session lives only in `ML_PROFILE_DIR`; nothing from it is logged or stored in the database.

## Known limitations

- A "com Cupom" price says some coupon is in the price, not which one. Coupon chips record where
  the item was seen ("visto na lista do cupom"), not which coupon ML applied.
- Discovery samples page 1 of each coupon listing; items deeper in a listing appear only when a
  Busca finds them.
- Activation at volume: the first full cycle (2026-11-02) activated 19 coupons and failed 1 with no
  wall; ML's limits beyond that are unknown, hence the default cap of 20 per run.
- How long an ML session lasts is unknown; expiry is detected and reported, not prevented.

## Build slices

1. **Skeleton, browser, capture.** App, db, env, Xvfb + headed profile runner, Conta page with
   the login button, `ml:capture`. Capture fixtures: a coupon page, an active coupon's listing, a
   store listing, a search, a product page, one activation response.
2. **Coupons.** Harvest, activation, Cupons page.
3. **Deals.** Card reader, observations, price segments, discovery, real-drop badge, Ofertas.
4. **Buscas.** Search and product Buscas.
5. **Schedule and alerts.** Scheduler, alerts, notifications, session banners.
