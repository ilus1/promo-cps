# Fake discounts: implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this
> plan task by task, with a review after each task.

**Goal:** flag and hide by default the ML offers whose final price is no better than the market (a
Buscapé match, or a cheaper listing of the same ML catalog product), and show a real saving on the
others.

**Design:** `docs/plans/2026-11-03-fake-discount-design.md`. It is validated: sections 1-3 with
Fernando, and 4-5 decided by the team lead when Fernando asked to move to implementation.

**Architecture:**
- A pure layer in `src/lib/price-compare/` cleans titles, parses Buscapé result pages, matches
  candidates and decides the verdict.
- A thin HTTP client and batch runner live in `src/ingestion/price-check/`. They have no browser
  and make no ML requests, and they run in the after-run queue, separate from the ML chain.
- Results go in a new `price_checks` table. One SQL condition builder in `src/db/deals.ts` decides
  "inflated", "cheaper sibling" and "real saving", each mirrored by a pure function.

**Tech stack:** Next.js 16, TypeScript, Drizzle 0.45 with postgres-js, Postgres 16, Vitest (pure
logic only, no database in tests).

## Rules (all tasks)

- The app runs as the systemd user service `promo-cps.service` on the production build.
  - Code edits are inert until the team lead rebuilds.
  - Never run `npm run dev`, `npm run build` or `next start`, and never touch the service or its
    units.
- Migrations are applied only while `GET http://127.0.0.1:8510/api/ml/status` shows the cycle idle
  with no Buscas, and at least 15 minutes before the "Próxima execução" on Conta. A migration is
  applied before any code that reads it.
- Never git add or commit. Fernando commits.
- Never read or print `.env`, cookies or tokens. DB probes use a throwaway script under `scripts/`,
  run with `npx tsx --env-file=.env <script>` in a READ ONLY transaction, then deleted.
- No ML traffic:
  - never navigate a browser to mercadolivre.com.br;
  - never press Rodar agora, Entrar no Mercado Livre, Resolver verificação, Ver no ML, Visto,
    Salvar, Excluir or the bulk buttons;
  - never POST to ML routes.
- Buscapé traffic during development:
  - only fixture captures and explicitly allowed live checks;
  - at most 10 requests per task;
  - never a loop.
- Code style:
  - no code comments;
  - ASCII punctuation in code;
  - named constants in `src/lib/constants.ts` or the module, never retyped;
  - pure rules tested at their boundaries;
  - pt-BR UI text;
  - match the surrounding code.
- Before any npm or npx command, run `source ~/.nvm/nvm.sh && nvm use` (Node 22.13.1). A task is
  done when `npx tsc --noEmit`, `npm run lint` and `npx vitest run` pass.

## Constants (add to `src/lib/constants.ts` unless a module owns them)

| Name | Value | Meaning |
|-|-|-|
| `PRICE_CHECKS_PER_RUN` | 80 | Hard cap on Buscapé lookups per run |
| `PRICE_CHECK_TOP_DEALS` | 50 | Biggest fresh Novos discounts checked per cycle |
| `PRICE_CHECK_ALERT_ITEMS` | 5 | Alert candidates per alert checked before digests |
| `PRICE_CHECK_ALERT_ITEMS_TOTAL` | 15 | Cap on alert-candidate lookups per run |
| `PRICE_CHECK_DELAY_MS` | 4000 | Pause between lookups (plus jitter up to `PRICE_CHECK_JITTER_MS` 1500) |
| `PRICE_CHECK_TIMEOUT_MS` | 15000 | Timeout for one lookup |
| `PRICE_CHECK_VALID_HOURS` | 72 | A `matched` check stays valid |
| `PRICE_NO_MATCH_VALID_HOURS` | 168 | A `no_match` check stays valid |
| `PRICE_CHECK_BACKOFF_HOURS` | 24 | Pause after a block |
| `PRICE_CHECK_FAILURES_STOP` | 3 | Consecutive failed lookups that stop a batch |
| `PRICE_CHECK_PRUNE_DAYS` | 30 | Checks older than this are deleted |
| `SIBLING_CHEAPER_PERCENT` | 90 | Sibling counts as cheaper at or below 90% of the price (integer maths) |
| `INFLATED_MIN_STORES` | 2 | Stores needed on a high-confidence match to flag |
| `MATCH_HIGH_OVERLAP` / `MATCH_MEDIUM_OVERLAP` | 0.6 / 0.5 | Word-overlap thresholds |
| `MATCH_HIGH_MIN_KEY_WORDS` | 2 | Model or size words that must match for high confidence |
| `SEARCH_RESULT_LIMIT` | 20 | Result cards read per search |
| `COMPARE_QUERY_MAX_WORDS` | 10 | Words kept in a cleaned query |
| `LIST_NEVER_PRACTICED_RATIO` | 0.7 | History badge: highest price below 70% of the "de" |
| `LIST_NEVER_PRACTICED_DAYS` | 30 | History badge needs this much history |

Buscapé search: `https://www.buscape.com.br/search?q=<query>`. Comparison links:
- Google Shopping: `https://www.google.com/search?tbm=shop&q=`
- Amazon: `https://www.amazon.com.br/s?k=`
- Magalu: `https://www.magazineluiza.com.br/busca/<query>/`

---

### Task 25: Buscapé fixtures and the pure comparison layer

**Files:**
- Create:
  - `scripts/buscape-capture.ts` (saves a Buscapé search page; makes no ML requests);
  - `src/lib/price-compare/__fixtures__/` (small trimmed fixtures, committed; the raw captures go
    in `__fixtures__/captured/`, gitignored);
  - `src/lib/price-compare/clean-title.ts`, `parse-buscape.ts`, `match.ts`, `verdict.ts`,
    `links.ts`, each with a test.
- Modify: `.gitignore` (the captured folder), `src/lib/constants.ts`.

**Step 1: Capture.**
- `npx tsx scripts/buscape-capture.ts "<query>" <name>` GETs the search page with a desktop Chrome
  User-Agent and `Accept-Language: pt-BR`, saves the HTML, and prints the HTTP status, size and
  card count. It reads no `.env` and has no ML code path.
- Capture 5 pages at most:
  - `veja-x14` ("Veja X14 Spray Tira Limo Cloro Ativo 500ml");
  - `vanish-5l` ("Tira Manchas Vanish Multiuso Pro Line 5L");
  - `jbl-520bt` ("Fone JBL Tune 520BT");
  - a generic title expected to give no match ("Cabo Tipo-c Carregamento Turbo 1 Metro 60w
    Trançado");
  - a nonsense query, for the no-result page shape.
- Trim each to its result-card markup, plus any no-results marker, into a committed fixture under
  50 KB.

**Step 2: `cleanTitle(title): string[]`.**
- Fold accents and lower-case. Reuse `src/lib/text-search.ts` folding.
- Split into words and drop the filler words, a named list: "para", "com", "de", "da", "do", "e",
  "oferta", "original", "envio", "rapido", "promocao", "lancamento", "novo", "kit"... "kit" is
  dropped from the query but kept as a pack word in the matcher.
- Keep the order and cap at `COMPARE_QUERY_MAX_WORDS`.
- `compareQuery(title)` joins the words with spaces.
- Tests:
  - Veja keeps "veja x14 spray tira limo cloro ativo 500ml";
  - an empty title gives an empty array;
  - an all-filler title gives an empty array;
  - a long title is capped.

**Step 3: `parseBuscapeSearch(html): BuscapeResult`.**
- Returns `{ kind: 'results', cards } | { kind: 'empty' } | { kind: 'unknown' }`.
- A card is `{ name, priceCents, store: string | null, storeCount: number | null, url }`.
  - Cards are the `data-testid="product-card::card"` elements, up to `SEARCH_RESULT_LIMIT`.
  - The name comes from `product-card::name` and the price from `product-card::price`, parsed with
    the app's BRL parser.
  - `store` is the store label shown on a single-offer card (Magazine Luiza, Amazon...).
  - `storeCount` comes from "Compare em N lojas" on an aggregated card.
  - Unescape HTML entities.
- `'empty'` means the no-results marker seen in the nonsense-query fixture.
- `'unknown'` means no cards and no marker. That covers a challenge page or a changed layout.
- Tests: every fixture, the expected card count, and exact fields for the first 3 Veja cards (the
  "Kit 03 ..." 3-pack at Magazine Luiza R$ 73,38, Magazine Luiza R$ 12,66, R$ 27,89, then Amazon
  R$ 16,26).

**Step 4: `matchCandidates(mlTitle, mlFinalCents, cards): Match`.**
- Returns `{ confidence: 'high' | 'medium' | null, offers, marketLowCents, marketStore, storeCount }`.
- Word kinds, pure:
  - model words are letters plus digits (`x14`, `520bt`, `s25`, `a56`);
  - size words are a number plus a unit (ml, l, g, kg, gb, tb, mah, w, pol, cm, mm, m), including
    a number and unit split by a space or comma (`500 ml`, `1,5l`);
  - pack words are `kit N`, `N unidades`, `c/ N`, `Nx`, `N pacotes`, `N un`.
- Hard rules for a candidate:
  - every model word of the ML title is in the candidate;
  - size words agree when both sides have them;
  - pack words agree, so a pack on one side only rejects the candidate;
  - a store whose folded name is "mercado livre" is excluded.
- Overlap is the share of the ML title's meaningful words found in the candidate.
  - High confidence: at least `MATCH_HIGH_MIN_KEY_WORDS` model or size words matched and an
    overlap of at least `MATCH_HIGH_OVERLAP`.
  - Medium confidence: an overlap of at least `MATCH_MEDIUM_OVERLAP`.
- Results:
  - `offers` are the accepted candidates at the best confidence level found;
  - `marketLowCents` and `marketStore` come from the cheapest accepted offer;
  - `storeCount` is the number of distinct stores among the offers, or an aggregated card's
    storeCount when that is larger.
- Tests (table-driven):
  - the Veja fixture is high, with low R$ 12,66 at Magazine Luiza, 2 or more stores, and the kit
    rejected;
  - Vanish 5L is high;
  - JBL 520BT is high, and 510BT / 720BT are rejected by the model word;
  - "500ml" against "1l" is rejected;
  - "Kit 3" against a single is rejected;
  - the generic cable gives null;
  - an empty list gives null;
  - a Mercado Livre store is excluded.

**Step 5: `priceVerdict(...)`, the pure mirror of the SQL in Task 27.**
- Inputs:
  - the check: status, confidence, checkedAt, marketLowCents, storeCount;
  - the item: final price, `showsSaving` (an ML discount above 0 or a coupon saving above 0) and
    status;
  - the cheaper sibling's price or null;
  - `now`.
- Output: `{ inflated, cheaperSibling, realSavingCents, realSavingRatio, hidden }`.
  - A check is valid only when it is `matched` with `checkedAt` at least `now -
    PRICE_CHECK_VALID_HOURS`.
  - `inflated` needs high confidence, `storeCount >= INFLATED_MIN_STORES`, `showsSaving`, and
    `final >= marketLow`.
  - `realSaving` is `marketLow - final`, for high confidence only.
  - `hidden` is `(inflated || cheaperSibling) && status !== SAVED`.
- Boundary tests:
  - exactly at the validity edge;
  - final equal to the market low (inflated) and 1 centavo below (not);
  - store count 1 against 2;
  - medium confidence never flags;
  - Salvos are never hidden.
- `cheaperSiblingOf(price, siblingPrice)`: `siblingPrice * 100 <= price * SIBLING_CHEAPER_PERCENT`.
  Test it at the boundary.

**Step 6: `compareLinks(title)`.**
- Returns the four URLs built from `compareQuery`, each with the right encoding (spaces become `+`,
  or `-` in the Magalu path).
- Tests: the exact URLs for the Veja title, and a title with "&" and "/".

---

### Task 26: storage, the Buscapé client and the batch

**Files:**
- Modify:
  - `src/db/schema.ts`, migration `drizzle/0011_*`;
  - `src/db/prune.ts`, `src/lib/prune-rules.ts`;
  - `src/ingestion/after-run.ts`, `src/db/alerts.ts`;
  - `src/lib/constants.ts`.
- Create:
  - `src/db/price-checks.ts`;
  - `src/ingestion/price-check/buscape-client.ts`, `check-item.ts`, `batch.ts`, `queue.ts`, with
    tests of their pure parts;
  - `src/app/api/items/[id]/compare/route.ts` and its test.

**Step 1: Schema and migration 0011.**
- The `price_checks` table:
  - `key` text primary key: the item's `product_id`, or `item:<id>`. Use one exported `checkKey`
    and its SQL twin `checkKeySql`;
  - `item_id` text, not null, the item that was checked;
  - `checked_at` timestamptz;
  - `status` text enum: matched, no_match, failed, blocked;
  - `confidence` text enum, nullable: high, medium;
  - `query` text;
  - `ml_price_cents` int;
  - `market_low_cents`, `market_store` and `store_count`, all nullable;
  - `offers` jsonb, default `[]`;
  - `source_url` text.
- An index on `checked_at`.
- An index on `items(product_id)`, for the sibling check and the join.
- Generate with drizzle-kit and check the SQL by eye. Apply while idle (see Rules), before Step 2.

**Step 2: `src/db/price-checks.ts`.**
- `saveCheck(row)` upserts by key.
- `latestBlock(now)` is the newest `blocked` row within `PRICE_CHECK_BACKOFF_HOURS`; it gives the
  pause state and "pausada até".
- `needsCheckCondition(now)`: no row for the item's key that is `matched` within
  `PRICE_CHECK_VALID_HOURS`, or `no_match` within `PRICE_NO_MATCH_VALID_HOURS`.
- `topDealsToCheck(now, limit)`: fresh NOT_SEEN items by `ml_discount_pct` desc, needing a check,
  with one item per key.
- `savedToCheck(now, limit)`: Salvos needing a check.
- `alertCandidatesToCheck(observedSince, now, perAlert, total)`: for each alert, the items that
  `dealWhere` for its view would announce (same filters, `ALERT_STATUSES`, `offersOnly`,
  `observedSince`, not already hit at the same or a lower price), in the view's order, needing a
  check. It returns up to `perAlert` per alert and `total` overall, deduplicated by key. Reuse
  `dealWhere`, `dealOrder` and `alertFilters` from alerts.ts; don't copy them.
- `priceCheckSummary(now)` for Conta: the last `checked_at`, counts by status in the last 24 h, and
  the pause.

**Step 3: `buscape-client.ts`.**
- `searchBuscape(query, fetchImpl = fetch)` returns
  `{ kind: 'ok', html } | { kind: 'blocked', status } | { kind: 'failed', reason }`.
  - It uses `PRICE_CHECK_TIMEOUT_MS` (AbortController), the same headers as the capture script, and
    follows redirects.
  - 403 or 429 is `blocked`. Any other non-2xx, or a network error, is `failed`.
- Tests use an injected fake fetch.

**Step 4: `check-item.ts`.**
- `checkItem(item, deps)` with `item = { id, productId, title, finalCents }`:
  1. build the query;
  2. if it's empty, save `no_match`;
  3. search;
  4. parse: `'empty'` becomes `no_match`, and `'unknown'` becomes `failed` with reason
     "pagina desconhecida";
  5. match;
  6. save `matched` (with the confidence, offers, low, store and count) or `no_match`.
- A `blocked` response is saved as `blocked`.
- It returns the saved status.
- Test it with fakes over all the fixtures.

**Step 5: `queue.ts` and `batch.ts`.**
- One promise tail on `globalThis` (`__promoPriceCheckTail`), like after-run's, so that batches and
  on-demand lookups never overlap.
- `runChecks(items, deps)`:
  - it checks the items sequentially, with `PRICE_CHECK_DELAY_MS` plus jitter between them;
  - it checks `latestBlock` first and returns `paused` if there is one;
  - it stops on `blocked`, and after `PRICE_CHECK_FAILURES_STOP` consecutive `failed`;
  - it never exceeds the cap it is given;
  - it logs `[price-check] N verificados, M com equivalente, K inflados, parou: <motivo>`.
- The pure part (stop rules, cap, ordering and deduplication of the three lists) has boundary tests.

**Step 6: After-run order (`src/ingestion/after-run.ts`).**
- Only for a finished cycle (`ok` or `partial`) or a Busca run:
  1. `runChecks(alertCandidatesToCheck(...))`, capped at `PRICE_CHECK_ALERT_ITEMS_TOTAL`;
  2. the existing digests, which skip hidden items automatically once Task 27 lands (until then
     nothing is hidden, so the order is still safe);
  3. for cycles only, `runChecks(saved + top deals)`, capped at `PRICE_CHECKS_PER_RUN` minus what
     step 1 used.
- Session and health notifications stay first and unchanged.
- A price-check error is caught and logged, and never stops the digests.
- Test the order with fakes.

**Step 7: The on-demand route.**
- `POST /api/items/[id]/compare` goes through `withApi` with the local-Origin check.
- It loads the item, queues `checkItem` on the same tail, waits for it, and returns `{ status }`.
- If there's a pause it returns 409 with the pause text, and an unknown id returns 404.
- Route test with the fakes.

**Step 8: Pruning.** Delete `price_checks` older than `PRICE_CHECK_PRUNE_DAYS` in the existing
prune transaction. Test the cutoff in prune-rules.

**Step 9: Live check, allowed.**
- Run `checkItem` once for the Veja item in our DB through a throwaway script, with the real
  Buscapé and the real DB.
- Report the saved row, then delete the script.

---

### Task 27: deal query (inflated, cheaper sibling, real saving, hidden by default)

**Files:**
- Modify:
  - `src/db/saving.ts` (export `finalPriceSql(now)`, computed once like `onceSql`);
  - `src/db/deals.ts`;
  - `src/lib/deal-query.ts` (filter `showInflated` with param `inflados`, which is an alert key;
    sort `economiaReal`; `narrowsList` and `alertNarrows` treat `inflados` as widening);
  - `src/lib/filter-labels.ts`;
  - their tests.

**Step 1: SQL builders in deals.ts, mirroring `priceVerdict`.**
- `validCheckJoin(now)` is one lateral or left join on `checkKeySql`, with validity in the join.
- `inflatedSql(now)`.
- `cheaperSiblingSql(now)`: an `exists` over fresh items with the same `product_id`, a different
  id, and `price_cents * 100 <= items.price_cents * SIBLING_CHEAPER_PERCENT`.
- `realSavingSql(now)`.
- `hiddenSql(now)` is `(inflated or cheaperSibling) and status <> SAVED`.
- A test pins the rendered SQL and grids the pure `priceVerdict` against it, the same pattern as
  `src/db/sql.test.ts`.

**Step 2: Wire them in.**
- `filterConditions` adds `not hidden` unless `showInflated`.
- `dealOrder` gets `economiaReal: realSaving desc nulls last`, then the existing tie-break.
- `listDeals` selects the check fields and the cheapest sibling (id, url, price) for each row.
  `DealRow` gains `priceCheck` and `cheaperSibling`.
- A count of hidden items for the current view: the same filters with `showInflated`, minus the
  default.

**Step 3: Measure, read-only.**
- EXPLAIN ANALYZE the default Ofertas list and count, the `economiaReal` sort, and the alert select.
  Each must stay under about 2x today's time.
- If the sibling `exists` is slow, rewrite it against the new `items(product_id)` index, not as a
  per-row scan.

---

### Task 28: UI and docs

**Files:**
- Modify:
  - `src/lib/deal-view.ts` (pure line builders and their tests), `src/components/DealCard.tsx`;
  - `src/app/page.tsx` (the header note "K ocultos por desconto inflado" with a link setting
    `inflados=1`, and the sort option);
  - `src/components/FilterBar.tsx` (the pill "Mostrar descontos inflados");
  - `src/app/conta/page.tsx` (the panel);
  - `src/lib/labels.ts`, `src/lib/price-history.ts` (the history badge);
  - `README.md`.
- Create: `src/components/CompareButton.tsx`.

**Step 1: Card lines, pure, with tests.**
- Inflated: a badge "Desconto inflado", plus "Fora do ML: R$ X na <loja> (N lojas); aqui R$ Y".
- High confidence and not inflated: "Economia real: R$ Z (P%) vs R$ X na <loja>". P is Z over the
  market low, with one decimal, using the shared formatter.
- Medium confidence: "Possível equivalente fora do ML: R$ X na <loja>".
- Cheaper sibling: "Mais barato em outro anúncio: R$ X", with a link to its URL.
- History badge: "preço 'de' nunca praticado". It needs history of at least
  `LIST_NEVER_PRACTICED_DAYS`, and the highest price in the window below
  `LIST_NEVER_PRACTICED_RATIO` times the "de".
- On every card, "Comparar:" with four small links (Buscapé, Google Shopping, Amazon, Magalu),
  opening in a new tab with `rel="noopener noreferrer"`.
- "Comparar agora" (`CompareButton`) shows while there's no valid check.
  - It POSTs to the route and shows "Comparando..."; then it refreshes, or shows the pause text or
    the error.
  - Focus stays sensible.
  - Never press it during development except once, allowed, on the Veja card.
- A card gains at most two lines plus the link row. Use the existing sizes and colours, and the
  badge style already used for badges.

**Step 2: Ofertas and Conta.**
- The header note shows only when K > 0.
- The pill sets `inflados=1`, and hidden cards then show their badge.
- The Conta panel "Comparação de preços" shows:
  - "Última verificação há N min";
  - "Nas últimas 24 h: N verificados, M com equivalente, K inflados";
  - or "Pausada até dd/mm hh:mm (Buscapé recusou)".

**Step 3: README.**
- What the comparison does, and that it uses Buscapé, once per item every 3 days, about 80
  requests per cycle, without ML.
- The hide rules and the guards.
- The links.
- The pause.
- That `scripts/buscape-capture.ts` refreshes the fixtures.
- Add the limitation: matching is by title, and generic items have no equivalent.

---

### Task 29: deploy and live check (team lead)

1. Run all checks. Then, in an idle window, use the README update steps: stop the timer and the
   service, build, start the service, wait for `/api/health`, start the timer.
2. In the browser:
   - Ofertas default, `inflados=1` and `sort=economiaReal`;
   - Conta's panel;
   - one "Comparar agora" on a card without a check.
3. After the next cycle:
   - read the `[price-check]` log line and the counts;
   - confirm no block;
   - spot-check 5 flagged cards against Buscapé by hand.
4. Record the results in the design doc.
