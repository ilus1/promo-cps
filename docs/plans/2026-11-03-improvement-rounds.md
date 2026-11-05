# Improvement rounds (autonomous)

Started 2026-11-03 at Fernando's request: "do rounds of review thinking and improvement on what we
currently have. Stop whenever you feel like you have a complete-ish application for this project's
set value and target. If there are any questions, assume I'll go with the recommended approach."

## Target (from the original request)

Find all available Mercado Livre coupons, the items each applies to, and good deals by an agreed
logic (ML discount, real 30-day drop, total saving with coupons), and alert him; also let him follow
general searches or specific items (Buscas). Local, usable prototype on his secondary account.

## Rules for every round

- No extra ML traffic: only the scheduler's own cycles load ML; agents never press anything that
  loads ML, never navigate to mercadolivre.com.br, never POST to run, login or verify.
- Edits to `src/ingestion/*` or `src/db/*`, migrations and dev-server restarts only while
  `/api/ml/status` shows the cycle idle and no Buscas running.
- Each change: implementer, then spec and quality review, then a local browser check.
- Recommended option is taken for every open choice; decisions are recorded here.
- The live dev server compiles every save, so saves are ordered to compile after each one
  (definitions and imports before their users); a broken save is a 500 on every page.
- Cycle times move by up to 15 minutes either way; the idle window is read from "Próxima
  execução" on Conta, with no `src/db` or `src/ingestion` edit from 15 minutes before it.
- A page change that needs a new `src/db` shape is written together with that shape, in one idle
  window, or kept compatible until then (2026-11-03: Ofertas returned 500 while its new tab counts
  waited for an idle window to change `countDealsByTab`).

## Rounds

### Round 1

- Reviews: user workflows and value gaps; robustness and data quality on the live data.
- Reviews done 2026-11-03 (value: 10 items; robustness: 8 items, data clean: no zero prices,
  discount matches prices, links all valid, 223 product ids under several item ids).
- First automatic cycle, 2026-11-02 22:31-22:51 local: `ok`, 444 page loads, no wall; full harvest
  1,998/1,998 (44 new), 20 ended by the two-harvest rule, 20 activated (0 failed), 300 listings
  (0 failed), 13,219 items. Totals after it: 26,701 items, 25,070 coupon links over 586 coupons.
- Round 1A, robustness (touches the cycle; starts after the 01:31 cycle and the final-review
  migration and restart):
  1. `isFullHarvest` counts only seen coupons: any skipped entry or 0 seen means not full; one cycle
     never ends more than max(30, 5% of live) coupons, and records why it refused.
  2. A tripped load breaker (timeouts, network errors, missing page state) ends the run `failed`
     ("paginas nao carregaram (rede ou leitor)"), keeping the hold; `blocked` only for wall URLs
     and HTTP 403/429.
  3. On scheduler start, orphan runs (no status) become `failed` ("interrompido: o servidor
     reiniciou durante a execucao"); `context.close()` gets a timeout.
  4. Re-alerts only on a drop of at least `MIN_DROP_RATIO` and R$ 1 below the stored hit.
  5. Activation order: largest maximum saving first, coupons that save under R$ 5 last.
  6. Indexes on `item_sources(source_type, last_seen_at)` and `items(status, observed_at)`.
- Round 1B, what Fernando sees (starts now; `src/db` only while idle):
  1. Ofertas text search `q` (title, case- and accent-insensitive, every word must match), an
     alert key, first pill.
  2. Categoria groups by `domain_id` with type-ahead over all values.
  3. Coupon identity: `couponLabel` ("20% OFF, Loja X") in the Ofertas filter, chips and Cupons;
     the 4 preview products on each Cupons row; Cupons `q` also matches preview titles; "nenhuma
     oferta lida ainda" when a coupon has no linked offers.
  4. Honest counts ("N itens, M ofertas") and the seller on each card.
- Status 2026-11-03 07:55 UTC: Round 1B built (text search, domain categories, coupon labels and
  previews, honest counts, seller; 1,302 tests) and in review. Final-review migration 0005 applied
  and the dev server restarted (scheduler on the final-review code). Cycles so far: 19:31 partial,
  22:31 ok, 01:31 ok, 04:31 partial (one empty listing each time it was partial). Round 1A
  dispatched, to finish before the 10:31 UTC cycle.
- Round 1B review (2026-11-03): 6 Important (raw coupon ids outside the top 100, Cupons q phrase
  match, invisible preview matches, brand shown as seller, `ofertas` splitting the alert key,
  ~0.45 s fixed cost likely from Postgres JIT) and 9 Minor; all decided and sent back. pg_trgm and
  unaccent are not installed (would need admin rights and Fernando's OK).
- As built (Round 1B, decisions):
  1. Accent-insensitive text without `unaccent` (not installed; installing it needs admin rights and
     Fernando's OK): the typed words are folded in JS and each letter with accented forms becomes a
     regex class (`f[oóòôõö][nñ][eéèêë]`), matched with `~* all (array[...])`. A first attempt with
     `translate()` plus `ilike` cost about 330 ms on 52k items; the regex costs about 40 ms.
  2. Ofertas `q` and Cupons `q` share one rule: trimmed, whitespace collapsed, capped at 80
     characters, every word must match, any order. Cupons matches the title, the store name and the
     preview product names together.
  3. Categoria keeps the `categoria` key, now holding the `domain_id` (product type), with a
     type-ahead over all values (100 shown at a time). Still an alert key.
  4. `couponLabel` gives "20% OFF - Store" for store coupons and the title for ML coupons, without
     repeating a store name already in the title. It is used by the Cupom filter, its chip, the card
     chips and the Cupons rows; a selected coupon outside the top 100 is looked up by id.
  5. Cupons rows show up to 4 preview products from `raw->'items'`; with `q`, the products that
     match come first. Only images on `http2.mlstatic.com` are shown (a stored `http:` URL is
     upgraded to `https:`). A coupon with no linked offers shows "nenhuma oferta lida ainda" instead
     of "Ver ofertas".
  6. The Ofertas header reads "N itens, M ofertas"; an offer is the `offersOnly` rule (ML discount,
     drop or saving above 0). "Só ofertas" is a filter (`ofertas`), but not an alert key, because
     alerts already imply offers only: `q=fone` and `ofertas=1&q=fone` are the same alert.
  7. The card shows "Vendido por {store}" only when ML's text has the form "{brand} por {store}"; a
     bare name can be a brand or a store, so nothing is shown for it.
  8. Postgres JIT is off for the app's connections (`connection: { jit: 'off' }`): a count that took
     330 ms with JIT on takes 13 ms.
  9. The Cupons filter on Ofertas selects the matching live coupons in one uncorrelated subquery
     instead of joining per link.
  10. Search text has one module (`src/lib/text-search.ts`: `SEARCH_TEXT_MAX`,
      `normalizeSearchText`, `searchTextOf`, `searchWords`, `wordRegexes`, `nfc`); words dedupe
      case-insensitively. Item titles, sellers and coupon texts are stored in NFC, so the accent
      classes match them (rows stored before this are not rewritten).
  11. The Categoria type-ahead (`typeaheadChoices`) focuses its input, matches the label only (every
      word, no accents or case), pins the selected value first only while nothing is typed, and
      Enter picks the first row shown.
      Labels carry no counts, and the panel says the names are Mercado Livre's, in English; there is
      no synonym map yet.
  12. The Cupons text filter says "Texto no título, na loja ou nos produtos" and uses the same
      normalizer as Ofertas.
- Round 1B re-review 2026-11-03 08:25 UTC: approved, 6 Minor follow-ups. 50 hostile search inputs
  all match literally, with no regex error. Every page loads in 0.06-0.32 s. The follow-ups:
  - Enter picks the first row shown;
  - the panel note is tied to its input;
  - Cupons search and previews use one item rule;
  - the accent classes hold both cases, so they no longer depend on the database collation;
  - alert links open the offers-only view (with the Round 2B fixes);
  - this file's layout.
- Round 1A built and live 2026-11-03 07:57 UTC (migration 0006, restart), in review.
- Round 1A review (2026-11-03): spec compliant, 2 Important, 9 Minor; all decided and sent back.
  - The two-Aplicar-clicks breaker stays `blocked` (ML's risk check, Task 10); only the page-load
    breaker became `failed`.
  - The ending cap refuses all, not "end up to the cap". A refusal is confirmed by repetition: the
    next full harvest ends them when the previous cycle refused a count within one limit of the
    current one, so a real mass removal (an event set pulled early) ends one cycle later and a
    one-off anomaly is still refused.
  - The hang kill matches Chrome processes in `/proc` by an exact `--user-data-dir=<profile>`
    argument and a `chrome` executable, never by a pkill pattern (the built pkill call failed on
    the leading `--` and would have matched `profile-old` and shells).
  - The load-breaker hold is a structured marker in the run's counts, not a match on its text.
  - Orphan runs: the sweep uses the process start, so a hot reload never marks a live run; a
    second server on the same database would mark the first one's live run failed until it
    finishes, so Round 3 stops the dev server before starting the service. An orphan row does
    not count as the previous status for session alerts.
  - Re-alerts use integer maths at the 1% and R$ 1 boundary.
  - Re-review 2026-11-03 08:15 UTC: approved. Only Chrome's browser process keeps the profile
    flag as its own argument (children rewrite their command line), so only it is killed, and
    the children exit with it. Six Minor follow-ups went to whoever owned the file at the time:
    - the kill normalizes both paths and logs how many processes it killed;
    - the tests use the real child-process shape;
    - a dead clause is removed;
    - one "entradas ignoradas" constant, singular included;
    - an orphan marker in the run's counts;
    - the re-alert ratio in basis points.

- Round 1 closed 2026-11-03 08:12 UTC: both rounds' fixes applied (1,383 tests), dev server
  restarted on them, re-reviews dispatched.

### Round 2

Data at planning (2026-11-03 08:15 UTC, four cycles): 52,263 items, all fresh; 323 Vistos, 1
Salvo; 181 items have more than one price segment and history starts 2026-11-02 16:50, so no real
drop can show before 2026-11-09; 23 items have a drop ratio, none positive. 1,245 catalog products
appear under several item ids (2,795 items, 5%).

- Round 2A, the cycle and Buscas (no migration):
  1. `cycleHealth`: a pure check over the run's counts that flags a reader that may have changed
     (coupons read under 90% of ML's total, skipped entries, unparsed over 5%, under 20 items per
     listing read, dropped cards over 5%, failed or empty listings over 10%, no coupon links
     written, basis `other` over 5%). The result is stored in the run's counts; a notification is
     sent when a new warning appears and once a day while any lasts (an improvement does not
     notify); Conta and Ofertas show "O leitor do Mercado Livre pode ter mudado: ...".
  2. Empty listings are counted on their own and no longer make a cycle `partial`; `partial`
     means a page really failed. Too many empty listings is a health warning.
  3. Pruning after each finished cycle: items not observed in 90 days (never Salvos), ended or
     expired coupons older than 60 days with no links, runs older than 180 days. Nothing qualifies
     yet.
  4. Schedule jitter: each automatic slot moves by a random offset of up to 15 minutes either way,
     chosen once per slot and shown in "Próxima execução". No quiet hours (alerts matter at night
     too).
  5. A Busca from a typed term: Buscas accepts plain text and builds the
     `lista.mercadolivre.com.br` search URL; Ofertas with a text search shows "Seguir 'x' no ML",
     a link that opens Buscas prefilled and creates nothing. A new Busca is read by the scheduler
     within about a minute of being added (a never-attempted Busca skips the post-tick cooldown);
     a Busca with no results is an empty read, not a failure; a Busca due near a cycle runs inside
     it, so Buscas never become a second ML session every 3 h.
  As built (Round 2A):
  - Health is `counts.health` (bitmask, order in `HEALTH_CODES` of `src/lib/cycle-health.ts`) plus
    `counts.healthNotify` (1 when this cycle should notify). The decision is taken inside the cycle
    from the last worked cycle's mask and the last run with `healthNotify` = 1, so "once a day"
    comes from the runs.
  - New counts: `discoveryRead`, `discoveryEmpty`, `discoveryLinks` (counted with the same pure
    `sourceLinks` the database write uses), `discoveryBasisOther`.
  - Only the `LISTING_RESULTS_MISSING` throw is "empty". A results array with no cards (`found` 0)
    is still a listing failure. Empty listings still count toward the reader streak that stops
    discovery, and still mark the coupons' discovery attempt as failed (same retry as before).
  - The banner reads the latest finished cycle (any status); a failed cycle has no health, so it
    shows nothing then.
  - Pruning runs in the cycle's serialized job right after `finishRun`; a failure is logged and
    never fails the cycle. Coupons are "old" when `ended_at` or `expires_at` is older than 60 days.
    Foreign keys cascade segments, links and alert hits.
  - Jitter: `slotJitterMs` derives the offset from a hash of the slot (the un-jittered due time), so a restart keeps it;
    `cycleDueAt` takes the offset and the previous finish as a floor. Search Buscas keep their own
    intervals, unjittered.
  - Review fixes: a Busca whose page state has no results is an empty read on page 1 (`ok`, 0 items, `counts.buscaEmpty`, no failure, no reader streak) and the end of the results on page 2 or later; a results array with no parsable cards is still a failure. Health denominators use `discoveryCards` (parsed cards over the listings read). A new warning code notifies (`mask & ~previous`), an improvement does not, and the daily reminder is due half a cycle early (22 h 30 min for 3 h cycles), so it lands on the cycle closest to 24 h; a failed lookup of the last notification counts as never notified.
  - Buscas and cycles: each Busca has a slack of half the shorter of the cycle and its own interval (`buscaSlackMs`): in the cycle step it counts as due when it comes due within its slack, and in the scheduler a Busca due less than its slack before the cycle's jittered time waits for the cycle. A 3 h Busca is thus read by the nearest cycle, a 1 h one (30 min slack) still runs between cycles. A Busca never attempted (`lastStatus` null) skips the post-tick cooldown; one that was attempted and failed still waits. A search run that ends not ok marks the Busca it did not read as tried (`failed`, `lastRunAt` unchanged, `markUnreadTried`), so a launch that cannot start does not loop; a cycle that fails before its Busca step leaves that to the next search tick.
  - Pruning deletes items in batches of 5000 (at most 20 per cycle), each its own transaction with a 5 s `lock_timeout`, instead of a statement timeout. Migration 0010 adds `searches.last_items` (applied 2026-11-03 08:50 UTC); Buscas show "nenhum resultado no ML" next to the last-read time when the last read was `ok` with 0 items. The not-read marking runs in a `finally` (a failure inside it is logged, never masks the run's error) and uses the stop status (`blocked`, `session_expired`) when the run ended that way, otherwise `failed`. The batch delete repeats the age and status conditions so the recheck after the row lock includes them. "Half" is the shared `HALF_DIVISOR`. An empty results array on page 1 also counts as `buscaEmpty`.
  - Text slugs: runs of other characters become one "-" ("fone/headset" is fone-headset); a host given without a scheme is a URL. Migration 0009 indexes `alert_hits(item_id)` (applied 2026-11-03 08:37 UTC). 
  - Busca text: `classifyBuscaInput` (text with no `://` becomes the lista URL, then `classifyMlUrl`
    decides). Only creation accepts text; editing a URL still needs a URL. The name defaults to the
    term in the client (`buscaNameOf`). The prefill param is `termo`.
  Review 2026-11-03 08:35 UTC: spec compliant, pruning safe by construction (FK cascades
  checked), every health threshold far from the four real cycles. 2 Important (a zero-result Busca
  failed every cycle; Buscas drifted into their own session after jitter) and 15 Minor; all
  decided and sent back, including migration 0009 (index on `alert_hits(item_id)` for the prune
  cascade) and a jitter offset derived from the slot, stable across restarts.
  Re-review 2026-11-03 08:44 UTC: the fixes are applied, and three of them caused new Important
  problems, all decided and sent back:
  - A search run that fails before reading now records its Buscas as tried. Otherwise the
    never-tried exemption from the cooldown loops Chrome launches when the browser can't start.
  - Each Busca's slack is half of the shorter of its own interval and the cycle's. A Busca that
    starts out of step joins the nearest cycle, and a 1 h Busca still runs between cycles.
  - The prune deletes items in batches of 5,000, at most 20 per cycle, under a lock timeout. A
    statement timeout would have made a large backlog roll back on every cycle and never finish.
  The reviewer agreed that an empty Busca is not a reader warning.
  Third pass 2026-11-03 08:56 UTC: approved. Simulated over 400 cycles from every start offset,
  3, 6 and 24 h Buscas open at most one separate session before joining the cycles. A Chrome launch
  failure no longer loops. Five small follow-ups were sent:
  - mark not-read Buscas in a `finally`;
  - recheck age and status on the batched delete;
  - a stopped run records its own status for Buscas it didn't reach;
  - shorter empty-read wording;
  - one "half" constant.
  Closed 2026-11-03 08:59 UTC: the five follow-ups were applied, and the team lead read the
  batched delete and the `finally` (1,605 tests).
- Round 2B, Salvar and Visto (migration 0007):
  1. Visto records the price it was marked at. When a Visto item is read again at least 1% and
     R$ 1 cheaper (the re-alert rule, one shared function), it goes back to Novos with "Preço
     caiu desde que você viu: era R$ X".
  2. Alerts evaluate Novos and Salvos, so saving an item never silences it.
  3. Salvos ignores the 72 h freshness filter and says "lido há N dias" on a stale card.
  4. Bulk Visto on Novos: "Marcar esta página como vista" and "Marcar os N filtrados como
     vistos", with a count confirmation.
  5. Digests keep one offer per catalog product (the cheapest) and list samples in the alert
     view's own sort.
  As built (Round 2B):
  - Migration 0007 adds `items.seen_price_cents`. Every status change except to Novos stores
    `price_cents`; Novo clears it.
  - One rule, `isMeaningfulDrop` (src/lib/price-drop.ts), and its SQL mirror `meaningfulDrop`
    (src/db/sql.ts), used by the alert re-announce and by the cycle upsert (`reopenSeenOnDrop` in
    src/db/items.ts); a test checks both on a grid.
  - Only SEEN items reopen; SAVED never moves. The stored price is kept after reopening, so the card
    shows the drop (Novos only).
  - Alerts evaluate Novos and Salvos: `DealListOptions.tab` accepts a status list.
  - Salvos freshness: the condition is `status = SAVED or observed_at >= since`, so counts and lists
    agree. Busca and cupom link filters still use the fresh-link rule. Stale cards say
    "lido há N d".
  - Bulk Visto: POST /api/items/seen takes `{ ids, asOf }` (max one page, only Novos items change)
    or `{ query, asOf }` (the Ofertas URL query, parsed by the Ofertas parser, forced to Novos);
    only items observed at or before `asOf`, the page's render time, are marked. The confirmation
    is inline, states the consequence, names its action ("Marcar os N") and opens on Cancelar.
  - Digests: all matching items are recorded per item; the digest keeps the cheapest per
    `coalesce(product_id, id)`. Samples follow ML discount order, because the sort is not part of
    an alert.
  - Migration 0008 backfills `seen_price_cents` for existing Vistos and Salvos with their current
    price (not the price at the moment they were marked), so they can come back on a drop.
  Review 2026-11-03 08:31 UTC: spec compliant; the cycle reopen costs nothing measurable and
  never overwrites a status set during a cycle. 2 Important, 9 Minor, all decided and sent back:
  - bulk Visto marks only items read before the page was drawn (`asOf`);
  - a product is announced again only at a meaningful drop below the cheapest earlier hit of the
    same product;
  - the unfiltered button reads "Marcar todos os N de Novos como vistos";
  - the confirmation states the consequence, its button names the action, and focus starts on
    Cancelar;
  - `skip locked` on the bulk update;
  - alert links open the offers-only view.
  Re-review 2026-11-03 08:41 UTC: approved. With 32,553 simulated earlier hits the sibling check
  stays a hash join (263 ms for an unfiltered alert, 42 ms for `q=fone`, once per alert per
  cycle); the bulk update never waits on a cycle. The three follow-ups, done by the team lead:
  `WIDENING_KEYS` typed as filter keys; the As built bullet and the README bulk line updated.
- Round 2C, the card (after 2B, same files):
  1. Price history on each card: lowest and highest price since the first read, and "mesmo preço
     desde dd/mm". The queda sort and the "abaixo do menor preço" filter say "Quedas reais aparecem
     a partir de dd/mm (7 dias de histórico)" while no item can have one.
  2. The coupon's part of the saving: a card whose price includes a coupon, with exactly one
     linked live coupon, shows "Cupom: -R$ Y (estimado) - desconto do vendedor: -R$ Z"; a new
     sort "Maior economia do cupom (R$)". Economia total stays as Fernando asked for it.
  3. "Faltam R$ X para o pedido mínimo" when the price is under a linked coupon's minimum, with the
     unit count (up to 3) that reaches it and what the coupon is then worth.
  As built (Round 2C):
  - History comes from one query of the page's `price_segments` rows, folded by the pure `priceHistory`.
    Segment count, first read, lowest and highest use the segments still inside HISTORY_DAYS (a segment
    that began before the window keeps its own start). "Mesmo preço desde" is the start of the latest run
    of consecutive segments at the current price, so a basis-only change does not reset it. Dates read
    dd/mm; a card with a history line does not also say "sem histórico". The notice uses
    `min(first_seen_at)` of all segments (about 4 ms) plus HISTORY_MIN_DAYS, for the queda sort and the
    `queda` filter.
  - Coupon part (`couponPart`, `couponPartSql`): basis `coupon` only, exactly one fresh live link and no `coupon_hint` (the hint may name another coupon). A
    percent of 100 is unusable; a result of 0 is null. A seller part under R$ 1 counts as 0 (ML rounding).
    The pure and SQL rules gave identical results on all 29k coupon-basis rows (checked read-only); a test
    pins the SQL formula and grids it against the pure rule.
  - Sort `economiaCupom` ranks coupon-basis items by that estimate and non-coupon items by their
    estimated coupon discount (the `DISCOUNT` in saving.ts); everything else is null, last. It costs
    about 270 ms against about 130 ms for `economiaReais`; accepted.
  - Estimated cards read "Preço com cupom: R$ Z (estimado, -R$ Y)".
  - Minimum gap (`minimumGap`): only coupons whose minimum is above the price count. Reachable in
    MAX_MINIMUM_UNITS (3) with a value of at least TRIVIAL_SAVING_CENTS: ranked by value per unit, then
    fewer units, then the smaller gap. With none reachable there is no line (the coupon's own "pedido
    mínimo" chip stays). The text names the minimum and the coupon, and that coupon's own chip is
    dropped. 7,014 of 12,504 non-coupon-basis cards with a linked coupon show the line.
  - The two new lines never show together (coupon basis vs no coupon basis), so a card gains at most two.
  Re-review 2026-11-03 09:00 UTC: approved, and the live data checks pass:
  - 0 mismatches between the SQL and pure coupon part;
  - no Faltam line promises under R$ 5, and 7,014 of 12,504 eligible cards show one;
  - no card shows "sem histórico" next to a history line.
  Follow-ups:
  - no coupon part when ML's own hint is on the card (60 cards credited the wrong coupon);
  - a history range that repeats one price reads as "mesmo preço";
  - tests and README fixes.
  The "Can't perform a React state update on a component that hasn't mounted yet" warning and a
  hydration mismatch seen during the rounds both come from Next's dev hot reload, which refreshes
  a page while it is still hydrating, right after an agent saves a file. They are not app code,
  quiet loads are clean (23 loads), and the production build in Round 3 removes them.
- Decided against: collapsing Ofertas by catalog product (5% of items, and it would change counts,
  pages and alert matching; the digest dedupe covers the noise in alerts); a default price floor
  (9 items under R$ 1); a native dark theme (Dark Reader handles it; the hydration noise is dev
  only and goes away with the production build in Round 3); the alert preview count (low value).
- Round 3 (last): systemd user service plus a watchdog timer (like olxmapper), switch from the dev
  server to the production build, README section; final review.
  - The service is bound to the desktop session (`After` and `PartOf=graphical-session.target`):
    the login window and notify-send need the session's display and DBus, which the user manager
    holds only while Fernando is logged in. Cycles therefore run while he is logged in (lingering
    is on, but a service started at boot would have no display).
  - The service sources `.env` the same way `npm start` does; nothing parses it separately.
  - The watchdog is a separate hourly timer that reads only `GET /api/health`. It notifies once
    when the server stops answering, when the scheduler is paused, or when no cycle has started
    in 2 x RUN_EVERY_HOURS + 1 h, then once a day while that lasts.
  - The team lead does the switch in an idle window: stop the dev server, clear `.next`,
    `npm run build`, then install and enable the units. After that, every code change needs a
    rebuild and a service restart.
  - Review 2026-11-03 09:10 UTC: 0 Critical; the `$$` in ExecStart was the one real unit bug.
    Confirmed:
    - login start and logout stop on this GNOME session;
    - the environment the unit gets;
    - that GET route handlers and pages stay dynamic in the production build;
    - that `register()` runs under `next start`.
    Three Important fixes:
    - staleness is measured from the last started cycle or the server start, whichever is later,
      so a long logout or a morning boot is not an alarm;
    - `schedulerEnabled` comes from `AUTO_RUN`, so a scheduler that failed to start is caught;
    - the timer is enabled only after the service answers, because a past `OnBootSec` fires at
      once.
  - Switched 2026-11-03 09:14 UTC, with the cycle idle and the next cycle at 10:19 UTC.
    - `npm run build` passed: every page and route is dynamic, only `icon.svg` is static.
    - The units are symlinked into `~/.config/systemd/user`, and `promo-cps.service` is enabled
      (graphical session).
    - The service holds DISPLAY, WAYLAND_DISPLAY, XAUTHORITY and the DBus address, runs with
      NODE_ENV=production, listens on 127.0.0.1:8510, and the scheduler kept the same next run.
    - `promo-cps-watchdog.timer` was enabled after `/api/health` answered; its first run
      reported "active: none; notified: none".
    - Every page answered 200 (0.01-0.42 s), with no console errors.
    - From here on, every code change needs `systemctl --user stop promo-cps && npm run build &&
      systemctl --user start promo-cps`, and the dev server must not run.
- Final review 2026-11-03 09:20 UTC: complete-ish, yes.
  - Every part of the target works on live data, pages answer in 0.03-0.31 s, and the data shows
    no systematic error.
  - One blocking check: no notification had ever gone out, with 0 alerts and 0 Buscas. The team
    lead created "Teste do alerta (pode excluir)" through the app (Alertar on desconto 60% and
    economia R$ 200, 322 offers; a local write, no ML traffic) before the 10:19 UTC cycle. It
    proves the digest end to end and is deleted after.
  - Gap: no git history and no rollback. Fernando commits; the first commit is his.
  - Small bugs went to Round 4.

### Round 4 (polish from the final review)

- The hint line:
  - a price hint reads "Preço com cupom no anúncio";
  - a hint that duplicates a linked coupon chip is hidden.
- Text search anchors each word at a word start, so "fone" stops matching "microfone" (74 of
  230).
- "lido há" for read times; "Visto" stays the status.
- Coupon chips carry "mín. R$ X".
- The Cupons header reads "N cupons, M válidos".
- The Salvos tab drops the freshness pill.
- Alertar on an unfiltered view says what it covers, and that the sort is not saved.
- The README update step pauses the watchdog, and the README gains a rollback paragraph.
- Not done: popovers scoped to the current results (M), and a denser filter card at 390 px
  (M, desktop app).
- The rule works in basis points (`BASIS_POINTS`, `keepBasisPoints`), so a fractional `MIN_DROP_RATIO` is not rounded to a whole percent.
- Bulk Visto sends `asOf` (the render time, ISO, at most one minute ahead of the server clock) and only marks items with `observed_at <= asOf`, so reads and reopened items after the render stay in Novos. The route returns `marked`, shown after the refresh. The UPDATE selects ids `for update skip locked`, ordered by id. Without a filter the button reads "Marcar todos os N de Novos como vistos".
- Focus: Cancelar when the confirmation opens, back to the button on Cancelar, the result line after Confirmar.
- Digest: a `prior` CTE (the alert's earlier hits on fresh items, lowest price per product) suppresses the announcement of a sibling item unless it is a meaningful drop below it; the hit is still recorded. Measured read-only on live data (10k candidates, no earlier hits yet): about 100-125 ms for the whole select.
- Digest and Alertas "Abrir" open the view with `ofertas=1` through `dealHref` (`viewHref`).

### As built (Round 4)

1. Hint text. `src/lib/coupon-hint.ts` now holds the pure hint rules moved out of
   `src/ingestion/ml/observed-card.ts` (`CouponHint`, `CouponTerms`, `hintMatches`, the tolerances,
   `PERCENT_OFF`), so the ingestion link step and the card use the same match. The card only has the
   stored text, so `hintOfText` reads percent, amount-off and price-after from it. A price hint ("R$
   1.257 com Cupom") renders "Preço com cupom no anúncio: R$ 1.257" with no terms suffix. A percent
   or amount hint that `hintMatches` one of the coupon chips shown (the first `MAX_COUPON_CHIPS`)
   renders no hint line, because the chip carries the terms; a price hint is never hidden this way.
2. Text search: `\m` was tried first and dropped, because it never matches after a digit ("ml" in
   "300ml": 3,125 -> 291) or before ², ½ or ǅ. `wordRegexes` now puts a lookbehind on the previous
   character only: `(?<![[:alpha:]_])` before a word that starts with a letter,
   `(?<![[:alnum:]_])` before one that starts with a digit or underscore, nothing before any other
   start (`+5`, `(x)`, `½`). So "2fone" and "300ml" match, "microfone" does not. `wordMatchers` and
   `textMatchesWords` are the exact JS mirror (the same source with the two lookbehinds swapped for
   Unicode ones), also used to rank Cupons previews. A read-only run of 30 cases showed Postgres and
   JS agreeing, except titlecase `ǅ` against `ǆ` (Postgres case folding only; no boundary
   difference). Live counts of matching titles (all tabs): `fone` 232 -> 159, `oleo` 701 -> 676,
   `ml` 3,125 (with `\m` 291) -> 3,121, `kg` 933 -> 932, `notebook` 168 -> 168, about 30 ms each.
3. "lido" for read times: `observedLine` always says "lido há N h" (`seenLine` is gone, the
   freshness branch with it); the pill is "Incluir não lidos nas últimas 72 h" built from
   `STALE_AFTER_HOURS`; the chip prefix is "na lista do cupom:". No other place used "visto" for a
   read time (Busca has none).
4. Coupon chips read "na lista do cupom: LABEL (mín. R$ X, até dd/mm/aaaa)" when the minimum is
   above zero. The amber chip no longer repeats the value: it says "abaixo do pedido mínimo" when the
   price is under it, and is still left out for the coupon the "Faltam" line already names.
5. Cupons header: `countValidCoupons` (filters plus `liveCoupon`, through `validConditions`) is
   fetched only when no status filter is set; the line is "N cupons, M válidos" (M respects the
   other filters), and with a status filter it stays "N cupons encontrados".
6. Salvos drops the freshness pill (`freshnessApplies`). Alertar on a view with `narrowsList` false
   shows "Este alerta cobre todas as N ofertas de Novos e Salvos." (N is the offers of those two
   tabs under the current filters) and always "A ordenação não é salva no alerta." (`alertFormNotes`).
7. README: the update step stops and restarts the watchdog timer around the build, a Rollback
   paragraph was added, and the wording above was updated.
8. Review fixes: the alert scope note uses `alertNarrows` (alert keys except the freshness pill), so
   "Só ofertas" alone still shows it; `ALERT_STATUSES` is shared by alerts, the page and the note
   text (built from `ITEM_TAB_LABEL`); the notes are in the alert input's `aria-describedby`; the
   freshness pill stays on Salvos when `antigos=1` is in the URL so it can be turned off; the chip of
   the coupon the "Faltam" line names leaves out "mín."; `HINT_PRICE_LINE_LABEL` is built from
   `COUPON_PRICE_LABEL`; the Conta count reads "cupons lidos"; the README update and Rollback steps
   stop the timer, stop the service, build, start the service, wait for `/api/health` and only then
   start the timer.
- Review 2026-11-03 09:50 UTC, after one fix pass: approved.
  - Postgres and the JS word matcher differ on 0 of about 1.09M title and preview checks.
  - Every hostile input matches literally.
  - Each query takes 23-42 ms.
  - "ml" and "kg" are back (3,121 and 932) and "fone" is down to 159.
- Deployed 2026-11-03 09:51 UTC with the README update steps:
  - stop the timer and the service, build, start, wait for `/api/health`, start the timer;
  - the timer did not fire on start, so there was no false alarm;
  - the scheduler kept its next run, 10:19:20 UTC.
  Checked in the browser:
  - `q=fone` shows 157 items, and "ml" shows 3,115 again;
  - chips read "(mín. R$ M, até dd/mm/aaaa)", and read times say "lido há";
  - Cupons reads "2.068 cupons, 1.853 válidos";
  - 0 console errors.
- First cycle under the service, 2026-11-03 10:19:20-10:39:54 UTC: `ok`.
  - The harvest was full (1,854 of 1,856), with 18 activated and 5 ended.
  - It read 300 listings with 0 failed and 0 empty: 13,970 items and 12,103 coupon links.
  - The health mask is 0, and the prune deleted nothing.
  - The next slot is 13:08:34 UTC (jittered).
  - The test alert recorded 84 hits at the end of the cycle, and `notify-send` reported no
    failure, so a digest reached the desktop. The alert was then deleted through Alertas
    (Excluir).
  - The journal shows that Chrome moves itself into its own `app-com.google.Chrome-*.scope`,
    outside the service's control group. The README now says the app's own profile kill, not
    `KillMode`, covers a hung Chrome.
  - Totals: 65,097 items, and 236 items with more than one price segment.

## Stopped (2026-11-03 10:45 UTC)

The rounds stop here: the application is complete-ish for its target. The final review said yes;
its one blocking check (a real alert digest) passed under the service; every plan task and done
criterion is met; and the app runs supervised on the production build.

Left for Fernando:
- the first commit (there is no git history yet, so rollback needs it);
- his own alerts and Buscas.

Left open on purpose:
- popovers scoped to the current results;
- a denser filter card at 390 px;
- 42 cards with identical chips (same coupon terms);
- real drops, which show from 2026-11-09 once items have 7 days of history.

## After the rounds (2026-11-03, Fernando's requests)

- Fake-discount detection (Buscapé comparison), its Round 2 (conflict matcher, continuous worker,
  coverage) and the request hold (VPN and manual pause) are designed and recorded in
  `2026-11-03-fake-discount-design.md`.
- They were deployed at 22:22 UTC with the README update steps.
- The service starts held while the company VPN is connected.

