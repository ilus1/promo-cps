# Fake discounts: design

Date: 2026-11-03. Fernando: "I still see a bunch of products that have a fake discount, where the
product original price is inflated and then added a big discount, where the final product price is
even above the actual correct pricing. Ideally, we'll have a comparison of those products with
other promotions on other Brazilian websites, like Magalu or Amazon Brazil."

Fernando chose:
- free signals plus one-click links, plus an automatic check of a shortlist against a price
  comparator;
- the shortlist is his Salvos, alert candidates and the 50 biggest discounts per cycle, plus an
  on-demand button;
- flagged items are hidden by default.

## What the data and the probes say

The data (77,768 fresh items, 2026-11-03):
- ML gives no reference price. The "de" price is the card's `previous_price`, which is our list
  price.
- 45% of items have a catalog `product_id`. Where several sellers of one catalog product were seen
  (5,123 items), 573 of 3,995 show a "de" above 1.5 times the highest price any sibling actually
  charges. Example: "Fone Bluetooth 5.4 Dgx" at R$ 78,96, "de R$ 199,90 (60% OFF)", while a
  sibling sells for R$ 56.
- History starts 2026-11-02, so price-history signals are weak until about 2026-12-02.

The probes, one request per site:

| Site | Result |
|-|-|
| Buscapé | 200 over plain HTTP; server-rendered results with store-level offers (name, price, store) and aggregated products ("Compare em N lojas") |
| Zoom | same company and same structure as Buscapé |
| Magalu | 403 |
| Amazon | 200, but a heavy page with anti-bot |
| Google Shopping | no prices without JavaScript |

Two real ML titles searched on Buscapé:
- "Veja X14 Spray Tira Limo 500ml", R$ 12,01 on ML, "62% OFF, de R$ 32,09". Matches: Magazine Luiza
  R$ 12,66, Amazon R$ 16,26; the "Kit 03" 3-pack must be rejected. The real saving is about 5%.
- "Vanish Pro Line 5L", R$ 30,47 on ML. Other stores range from R$ 65 to R$ 136, so it is a real
  deal.

## 1. What counts as inflated

The test compares the final price, the one the app already computes with coupons, against a market
reference, not against the "de" price. A real saving is the market reference minus the final
price.

- Outside ML (Buscapé), the main signal.
  - The reference is the lowest matching offer from a store other than Mercado Livre, on a
    high-confidence match with at least 2 stores.
  - The item is flagged "Desconto inflado" when the card shows a saving (an ML discount or a coupon
    saving), the final price is at or above the reference, and at least 2 distinct stores sell at
    or below the final price (`second_low_cents`). An aggregated card alone never flags, so one
    mismatched card cannot hide an item. This was added after the Task 25 re-review.
- Inside ML, free.
  - Another fresh listing of the same `product_id` with the same title (compared
    case-insensitively) is at least 10% cheaper, by shown price. The title rule was added after
    the Tasks 27-28 review: 13% of same-`product_id` pairs were packs or other models, such as a
    "Kit C/10" against a single unit, or an Ecosport part against a Punto one.
  - The item is flagged "Mais barato em outro anúncio: R$ X", with a link to that listing.
- Our history, a badge only.
  - After 30 days of readings, "preço 'de' nunca praticado" when the item never sold within 30% of
    its "de" price.
  - It never hides anything.

Guards:
- A medium-confidence match only shows "possível equivalente: ..."; it is never flagged.
- Salvos are never hidden.
- A check older than 3 days is ignored.
- "Mostrar ocultos" (`inflados=1`) shows hidden items, marked.

## 2. Lookup and matching

- One GET to `https://www.buscape.com.br/search?q=<cleaned title>` from the server, with plain HTTP,
  no browser and nothing from the ML profile.
- Cleaning keeps brand, model and size words, drops filler ("Para", "Oferta", "Envio Rápido",
  "Original"...), folds accents and caps the query at 10 words.
- Parse the first 20 result cards: name, price, store, or "Compare em N lojas" for an aggregated
  product. A real-page fixture drives the parser tests.
- A pure matcher scores each candidate.
  - Hard rules:
    - model words (letters plus digits, such as "x14", "520bt", "s25") must appear on both sides;
    - size words (number plus unit: ml, l, g, kg, gb, tb, mah, w, pol, cm, mm) must agree;
    - pack words ("kit N", "N unidades", "c/ N", "Nx", "N pacotes") must agree;
    - Mercado Livre offers are excluded.
  - Overlap is the share of the ML title's meaningful words found in the candidate.
  - High confidence: at least 2 model or size words matched and an overlap of at least 0.6.
  - Medium confidence: an overlap of at least 0.5.
- Result per check:
  - the matching offers (store, price, name);
  - the market reference (the lowest matching price);
  - the store count, as distinct stores among the matching offers, or N for an aggregated card;
  - the confidence;
  - the Buscapé search URL;
  - the status: `matched`, `no_match`, `failed` or `blocked`.
- Checks are stored per catalog product, or per item without one.
  - `matched` is valid for 3 days.
  - `no_match` is valid for 7 days.
  - `failed` is retried next run.

## 3. Schedule, pace and blocks

- After each finished cycle (`ok` or `partial`), in the after-run queue, which is separate from the
  ML chain:
  1. check alert candidates first: for each alert, the items its digest would show, without a valid
     check;
  2. send the alerts, skipping anything now flagged;
  3. check Salvos without a valid check, then the 50 biggest ML discounts among fresh Novos without
     one.
- Items are deduplicated by product, with a hard cap of 80 lookups per run
  (`PRICE_CHECKS_PER_RUN`).
- A Busca run does steps 1 and 2 for its items.
- Lookups are sequential, about 4 s apart with jitter, so a full batch takes about 5 minutes. Only
  one batch at a time.
- "Comparar agora" on a card makes one lookup now, in the same queue.
- A block is any of: HTTP 403 or 429, a page with no result cards but a challenge or captcha, or 3
  network errors in a row.
  - The batch stops and checks pause for 24 h (`PRICE_CHECK_BACKOFF_HOURS`).
  - The pause is derived from the latest `blocked` row, so it survives restarts.
  - Conta and "Comparar agora" both say "Comparação de preços pausada até dd/mm hh:mm (Buscapé
    recusou)".
- Buscapé's terms likely disallow automated access. This stays low-volume and personal. If
  blocked, the app pauses and the free signals keep working.

## 4. UI and alerts (decided by the team lead, Fernando asked to move to implementation)

- Card lines:
  - inflated: a red badge "Desconto inflado", plus "Fora do ML: R$ X na <loja> (N lojas); aqui
    R$ Y";
  - matched and not inflated: "Economia real: R$ Z (P%) vs R$ X na <loja>";
  - medium confidence: a grey "Possível equivalente fora do ML: R$ X na <loja>";
  - a cheaper sibling: "Mais barato em outro anúncio: R$ X" (link);
  - the history badge;
  - every card: "Comparar: Buscapé - Google Shopping - Amazon - Magalu" (search links in
    Fernando's browser), and "Comparar agora" while there is no valid check.
- Ofertas:
  - inflated and cheaper-sibling items are hidden by default;
  - the header adds "K ocultos por desconto inflado" with a link that sets `inflados=1`;
  - `inflados` is an alert key, so alerts skip hidden items by default;
  - new sort "Maior economia real (R$)", where unchecked items come last.
- Conta panel "Comparação de preços": the last batch, checked, matched and flagged counts, and the
  paused state.
- Bulk Visto marks only what the list shows, so hidden items are left alone.

## 5. Data, tests and rollout

- Migration 0011:
  - a `price_checks` table: key text primary key (`product_id`, or `item:<id>`), item id,
    checked_at, status, confidence, query, market_low_cents, market_store, store_count, offers
    jsonb, source_url;
  - an index on `price_checks(checked_at)`;
  - an index on `items(product_id)` for the sibling check.
- Pruning deletes checks older than 30 days.
- One SQL condition builder for "inflated", "cheaper sibling" and "real saving", each mirrored by a
  pure function, with tests that keep them in step.
- Fixture-driven parser tests from captured Buscapé pages, using a capture script that makes no ML
  requests.
- Matcher tests on real title pairs, including kits, sizes and model numbers.
- The app runs as a production service, so code ships with the README update steps in an idle
  window, and the migration is applied before the code that reads it.

Out of scope: Amazon, Magalu and Google Shopping lookups by the app, which are links only; Zoom,
because it has the same data as Buscapé; EAN-based matching, because cards carry no EAN.

## Matching rules as built (Task 25 and its reviews)

The rules grew from 40+ real-world probe pairs:
- every bare number in the ML title must also be in the candidate (model generations, BTUs, roll
  counts, TV inches);
- tiers must be equal sets: pro, max, ultra, plus, mini, lite, fe, ti, super, xt, xtx, single
  letters such as Series X and S, and the bigrams "ipad air" and "macbook air";
- a candidate is rejected when it has an accessory, refill or condition word that the ML title
  lacks: capa, pelicula, refil, reposicao, almofada, pulseira, suporte, compativel, cabo, tampa,
  jarra, usado, seminovo, recondicionado, openbox, replica, defeito, importado and others;
- a multi-pack (kit, duo, par, "+") matches only another multi-pack;
- variant families must agree: resolution, panel type (QLED and others), fragrance concentration
  and whey type;
- every hard size must agree; soft specs (voltage, 4K, 5G, Hz) must agree only when both sides
  state them;
- candidates are used only between 1/5 and 3x the ML final price.

Residual risk: brand sub-lines that differ by one substituted word, such as "Golden Formula"
against "Golden Special". It is mitigated by the two-store rule, and Task 29 spot-checks 20 flagged
cards.


## As built (Tasks 27-28)

- Deal query:
  - the SQL twins of `priceVerdict` are in `src/db/verdict-sql.ts`, not `deals.ts`: `inflatedSql`, `cheaperSiblingSql`, `realSavingSql`, `hiddenSql`, plus `cheapestSiblingSql` for the card;
  - `src/db/check-sql.ts` holds `checkKeySql` and `validCheckCondition`; `needsCheckCondition` is `not exists` over the same condition, and the card's join uses it too;
  - `showsSavingSql` is in `saving.ts`, and the check candidates reuse it;
  - there is no lateral join: each builder is a correlated subquery on the `price_checks` primary key, so `dealWhere`, `filterWhere` and the alert queries need no change to their `from`;
  - `inflatedSql` prefilters with `key in (select key from price_checks where <valid high, stores, second low>)`, which Postgres hashes once; only the few rows in it run the exact `exists` and the final-price comparison (`greatest(market low, second low) <= final` equals the two comparisons of `priceVerdict`);
  - the sibling `exists` is guarded by `product_id is not null` and uses `items_product_idx`;
  - `listDeals` loads the card facts in a second query keyed by the page's ids (`priceCheck`, `cheaperSibling`), like the price histories, so the main list query is unchanged apart from `not hidden`.
- Filters:
  - `inflados=1` is `showInflated`, an alert key that widens (`alertNarrows` and `narrowsList` ignore it), and the pill is "Mostrar ocultos" (renamed in the review fixes);
  - the sort is `economiaReal`: real saving descending, unchecked last, then the id.
- Header note: `countHiddenDeals` counts the current tab with the same filters and `showInflated`, and is 0 on Salvos or when the pill is on.
- Card:
  - the red badge, then at most two lines (the check line and the sibling line), then one row "Comparar: ..." with the four links;
  - a real saving of 0 or less on a non-inflated item reads "Sem economia real: R$ X na loja";
  - a valid `no_match` shows "sem equivalente no Buscapé" in the link row, where the button was;
  - the history badge "preço 'de' nunca praticado" is `neverPracticedList`;
  - **Comparar agora** shows while there is no valid check (`matched` within 72 h or `no_match` within 7 d), and a `failed` answer shows an error note and keeps the button.
- Conta panel: `priceCheckPanel` shows the pause (with the latest block's reason), the last check, the 24 h counts and "Descontos inflados ativos: K", which counts fresh items flagged now (the summary has no per-24 h flag count).
- Measured read-only on 90,477 fresh items (milliseconds, best of 3):

| Query | Before | After |
|-|-|-|
| Ofertas list, default sort | 0 | 0 |
| Ofertas tab counts (with offers) | 108 | 210 |
| List sorted by Economia total (R$) | 240 | 355 |
| List sorted by Maior economia real | n/a | 200 |
| Alert select | 0 | 0 |

- Live counts at build time: 1,508 fresh items have a cheaper sibling (1,507 in Novos hidden by default), 0 are inflated and 1 has a valid check (the Veja item), because only one lookup has been made so far.

### Review fixes (Tasks 27-28)

- Cheaper sibling:
  - `product_id` also groups packs and different models, so a sibling now counts only with the same title (`lower(title)` equal), for both the hide and the card line; a different title under the same `product_id` is no signal;
  - a sibling whose `basis_text` contains "comprando" (`SIBLING_EXCLUDED_BASIS_MARKER`) is ignored, because its price is per unit for a multi-unit purchase (one item was hidden only by such a sibling);
  - `cheaperSiblingSql` is prefiltered by a hashed list of the `product_id` values that occur more than once in `items` (grouping by title too cost about 46 ms per query for no gain; the title rule stays in the `exists`); `sameListingTitle` is the pure twin of the title test.
- `countDealsByTab` now also returns `hidden` per tab, in one scan: a lateral `offset 0` computes the hidden flag once per row, and the counts are `filter` clauses on it. `countHiddenDeals` is gone.
- "Comparar agora": the button stays disabled until the refresh lands (`useTransition`), and the route answers with the existing status, without a lookup, when the item's key already has a valid check (`validCheckStatus`). After a compare, focus goes to the link row (`tabIndex -1`), or back to the button on a failure.
- Wording: the header note is "K ocultos (desconto inflado ou anúncio igual mais barato)", with "K ocultos" as the link, and the pill is "Mostrar ocultos". The param stays `inflados=1`.
- The "preço 'de' nunca praticado" badge sits in the top badge row. The compare and sibling links carry `aria-describedby`.
- Tests: the `verdict-sql` grids now read thresholds from the rendered params and cover `showsSaving`, the validity edge and 1 ms past it, medium confidence, a zero market low and a null store count; `realSavingSql` has its own grid; hidden is modelled over status x sibling x inflated.
- Measured read-only on 90,477 fresh items (milliseconds): the tab counts with the hidden count in the same scan take about 175, against 108 before Task 27, and the page used to run a second pass for the hidden count; the default list takes 8 (it was 0) and the descontoMin=30 alert select 7 (it was 0); the list sorted by Economia total (R$) takes 335; by Maior economia real, 190.
- Live counts after the title rule: 1,195 fresh items have a cheaper identical-title sibling (1,194 in Novos hidden by default, 1 in Vistos), 0 are inflated.
- On-demand lookups re-check `validCheckStatus` inside the queued task (`live.ts`), so two queued presses on cards sharing a key make one Buscapé GET; batches do not reuse checks.

## Deploy (Task 29)

- 2026-11-03 21:22 UTC, with the README update steps (stop the timer and the service, build,
  start, wait for `/api/health`, start the timer). The build passed, and the scheduler kept its
  22:06 UTC slot.
- Browser checks:
  - the Ofertas header reads "88.960 itens, 71.605 ofertas. 1.194 ocultos (desconto inflado ou
    anúncio igual mais barato)", and the "Mostrar ocultos" pill works (90,154 items with it on);
  - a hidden duplicate shows "Mais barato em outro anúncio: R$ 13,57" (Cabo Dgx 60w at R$ 18,29),
    and the cheaper twin stays visible;
  - one "Comparar agora" (Bolsa Mossdoom, R$ 160,53, "80% OFF") returned a medium match,
    "Possível equivalente fora do ML: R$ 37,91 na Magazine Luiza", so it is not flagged;
  - the Conta panel shows the last check, 24 h counts and active inflated;
  - every page answers in 0.01-0.27 s, with 0 console errors.

## Round 2 (2026-11-03 21:40 UTC, after Fernando's first use)

Fernando: "the method of comparing is a little too specific, even known brands and products like
notebooks from vaio show as no equivalent available. Also, I need this comparison to be as
automatic as possible. Ideally I want to see the list already filtered of all 'fake discounts'."

Diagnosis, from one Buscapé request for "Notebook VAIO FE16 AI PC Intel Core 5 320 - 16GB RAM
512GB SSD Linux DDR5 Wi-Fi 6 - Tela 16" (R$ 4.369 on ML):
- Buscapé lists the same notebook at Magazine Luiza R$ 6.300, Fast Shop R$ 6.665 and
  Webcontinental R$ 7.599, so it is a real deal.
- All three were rejected, because the matcher required every ML model word and bare number
  ("ddr5", the 6 of "Wi-Fi 6", the 16 of "Tela 16") to appear in the candidate. Long ML titles
  carry spec words that store names leave out.

Decided (Fernando chose a pace of 1 lookup every 6 s, and hide plus coverage):
1. Matching rejects on a conflict, not on a missing word:
   - Number slots: a bare number is keyed by its neighbouring words ("iphone 15", "core 5",
     "12 rolos"). It conflicts only when both titles have the same key with a different number.
   - Model-word shapes: digits become `#`, so "ddr5" is `ddr#` and "520bt" is `#bt`. Two words
     conflict when both titles have the same shape with different words (ddr4 and ddr5, s23 and
     s24, i5 and i7, 510bt and 520bt).
   - Sizes of the same unit must agree; BTU becomes a size unit.
   - Tiers, single letters, variant families, accessory and condition words, and packs stay as
     they are.
   - An anchor is needed: at least one ML model word or hard size must be in the candidate when
     the ML title has any.
   - Overlap is measured against the shorter of the two titles.
   - High confidence still needs every ML hard size present.
   - Every earlier false-positive pair stays rejected, and real recall fixtures (VAIO and other
     long titles) are added.
2. A background worker checks Buscapé all the time while the service runs:
   - it makes one lookup every 6 s (`PRICE_CHECK_INTERVAL_MS`), with jitter;
   - priority order: Salvos, then fresh Novos whose ML discount is 30% or more, biggest first (the
     priority tier uses the displayed % OFF only, because fake discounts are about ML's % OFF; the
     Economia total ratio would cost a per-row subquery), then the remaining fresh offers;
   - it deduplicates by key and skips keys with a valid check;
   - a block pauses it for 24 h, as before;
   - it replaces the after-cycle backlog. The alert-candidate checks before digests stay.
   - This is about 14,000 lookups a day at first, covering about 21,000 items with 30%+ OFF in
     about 1.5 days, then about 7,000 a day to keep each check fresh (3 days).
3. Ofertas:
   - fakes stay hidden by default;
   - a coverage line reads "Preços verificados: X% das ofertas com 30%+ OFF";
   - a "Só verificados" pill (`verificados=1`, an alert key) shows only items confirmed as real
     deals: a valid high check with a positive real saving.
   - Conta shows the worker's state: running or paused, queue size and coverage.

## Request hold: VPN and manual pause (2026-11-03 21:45 UTC)

Fernando: "make sure I can also stop the runner at any point, since I could be using my company VPN
at some point that it would be bad to run so many requests through it. Ideally, whenever I have my
fortinet connected to ca-DC-ipsec-vpn the requests would queue until I disconnect."

Found on this machine:
- FortiClient is installed in `/opt/forticlient`, and `forticlient vpn status` (as the user, no
  root) prints "Status: Connected" and "VPN name: CA-DC-IPSEC-VPN".
- The VPN is split tunnel: only 10.0.0.0/8 uses it, and ML and Buscapé route through the home
  gateway. But systemd-resolved's global DNS is the company's (10.1.1.150), so the app's name
  lookups can reach company DNS while the VPN is up.

Decided:
1. A VPN guard, `vpnConnected()`, runs `forticlient vpn status` through execFile with a 5 s
   timeout and caches the result for 30 s. It returns true when the status is Connected and the
   VPN name, compared case-insensitively, is in `VPN_HOLD_NAMES` (an env list, default
   `ca-DC-ipsec-vpn`).
   - When the command is missing, the guard is off (FortiClient isn't installed).
   - Any other error or a timeout means "held" for that check, logged once, and re-checked on the
     next tick.
2. A held state stops every automatic outbound request:
   - the scheduler doesn't start cycles or Busca ticks, and re-checks every minute; they run as
     soon as the hold lifts. A due cycle waits and is not skipped;
   - a running ML cycle stops between pages as `partial`, with the reason "VPN conectada", and
     the next cycle picks up the rotation;
   - the price-check worker waits before each lookup; the after-run alert checks are skipped (not
     awaited) while held, so the digests are not delayed, and the worker covers those items later;
   - manual actions (Rodar agora, a Busca's run, Comparar agora, the login and verify windows)
     are refused with "VPN da empresa conectada: desconecte para rodar".
3. A manual pause on Conta, stored in the database so it survives restarts:
   - "Pausar requisições" or "Retomar" holds everything, like the VPN;
   - "Pausar comparação de preços" or "Retomar" holds only the Buscapé worker;
   - Conta, the header and /api/health show which hold is active and why. The watchdog's
     "pausado" covers it.


### As built (Task 31b, UI)

- `verificados=1` ("Só verificados") is `onlyVerified`: `verifiedSql` is `realSavingSql > 0`, so it needs a valid high check; it is an alert key that narrows, and hidden items stay hidden unless "Mostrar ocultos" is on.
- Ofertas shows `coverageText(worker.coverage)` under the counts; Conta's "Comparação de preços" panel shows the worker state (pace, pause with reason, or "Verificação contínua parada"), the queue size, the coverage, and the last lookup of the worker. Both read `priceWorkerStatus(now)`.

### As built (request hold, UI)

- `src/lib/hold-view.ts` holds the pure texts (`holdBanner`, `holdChipText`, the two toggle views); `HoldToggles` on Conta posts to `/api/hold` and refreshes; `StatusChip` reads `holdState` and adds a line ("Em espera: VPN" or "Pausado").
- The Busca run shows the 409 text of the hold (`ensureBuscaRunOk`); the run, login and verify buttons already append the server's error to their failure text, and "Comparar agora" shows it as is.

### Review fixes (request hold and worker, server)

- The hold is checked again when a queued job starts (login, verify, cycle, Busca), before each
  page load and before each coupon click (`LoadBreaker.checkHold()`).
- VPN check:
  - execFile uses SIGKILL and races a timer;
  - the cache lasts 5 s when clear and 30 s when held or unverifiable;
  - `VPN_HOLD` maps every `VpnState` to a hold kind.
  - It fails closed: connected with no name holds. Output with no "Status:" line is `unknown`
    and becomes the `vpn_unknown` hold ("VPN não verificada"), which the watchdog notifies.
- Held cycles are recorded as `partial` with `counts.held = 1` and are skipped by every last-run
  reader. A cycle interrupted by the hold therefore runs again once the hold lifts.
- The watchdog stores `holdSeenAt` and counts it as activity, so a long hold is not "parado".
- Worker:
  - a failed row is retried after 6 h (`PRICE_FAILED_RETRY_HOURS`);
  - the queue gap equals the 6 s interval;
  - batches reuse a valid check.
  - Each tier is split into never-failed keys first and previously failed keys second, and
    each half keeps its index order.
  - An unknown page on a key that failed before is neutral for the 3-in-a-row block. This stops
    three always-failing queries from re-blocking every 24 h.
  - Network errors, timeouts, HTTP blocks and first-time unknown pages still count.
  - Left as is: three adjacent keys that always get HTTP 5xx can still block for 24 h.
- Matcher (Task 30 follow-ups):
  - a candidate-only GB value smaller than the ML title's smallest one counts as RAM;
  - "ps5 digital" is a different console;
  - a number-anchor fallback for word order;
  - display, teclado, carcaca, dobradica and touchpad are parts words.

## Deploy (Round 2 and request hold, 2026-11-03 22:22 UTC)

- Before the deploy:
  - The old build had no hold and its cycle was due at 22:06 UTC, so the service and timer were
    stopped at 22:03 UTC while the VPN was connected.
  - The gates passed: tsc, lint and vitest (129 files, 2,362 tests).
  - The unit gained `SuccessExitStatus=143`, so a normal stop no longer reads "failed".
- Deploy steps:
  - build;
  - `daemon-reload`;
  - the old matcher's 8 weak rows were deleted (5 `no_match`, 3 medium) so they are checked
    again; 3 high rows stay;
  - start the service, then the timer.
- Under the service, `/api/hold` returned `vpn.state` "connected" (CA-DC-IPSEC-VPN) and hold
  kind `vpn`.
- The overdue cycle tick at 22:23 UTC logged `held (VPN conectada), rechecking every 60 s`:
  - no run row was written;
  - no price check was saved;
  - the service's cgroup holds only `next-server`, with no browser running.
- The browser check blocked every non-localhost request so that product images stayed local:
  - the Ofertas header chip reads "Em espera: VPN", and the coverage line reads 0%;
  - the "Só verificados" and "Mostrar ocultos" pills are present;
  - on Conta, the Requisições banner names the VPN, and both toggles and the price panel read
    "Em espera: VPN conectada", with a queue of 21,329.
- Still to verify:
  - when the VPN disconnects, `/api/hold` must show `clear` and the worker must start. If
    FortiClient's disconnected output has no "Status:" line, everything stays held as
    `vpn_unknown`;
  - after the first coverage, spot-check about 20 flagged cards.
