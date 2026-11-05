# Market catalog: design

Date: 2026-11-04. Replaces the Buscapé lookups of `2026-11-03-fake-discount-design.md`. Every other
part of that design stays: the matcher, the verdict, the filters, the hold and the compare links.

## Why

Fernando: "seems like the comparison with buscape won't be a thing. It hits the limit too often. We
need to come up with a way to do that on our side. Most likely, we'll need to do the same match on
other retail websites and compare them locally."

The first real run (2026-11-03 23:18 to 01:03 UTC):
- the worker made 741 Buscapé lookups, then got HTTP 403 and paused for 24 h;
- results: 117 high matches (16%, mostly at Magazine Luiza, 1 to 2 stores), 93 medium, and 530 with
  no equivalent (72%);
- the unmatched items are mostly generic: phone cases, car parts, decoration and kits. They have no
  equivalent at large retailers under the same name, so no source can confirm them.
- The queue held 4,231 fresh Novos with 30% OFF or more. 1,914 of them have an ML catalog product
  (1,847 distinct products).

## Probes (2026-11-04, VPN off, at most 3 requests per site)

| Site | Plain HTTP | System Chrome (no automation flags) |
|-|-|-|
| Kabum | 200, listing data in `__NEXT_DATA__` | not needed |
| Amazon Brasil | 503 "Algo deu errado" | 200: search and best-seller pages |
| Magazine Luiza | 403 "tente novamente em 1 minuto" | 403 |

- **Kabum listing pages** (`/celular-smartphone/smartphones`):
  - `props.pageProps.data` is a JSON string. Its `catalogServer.data` holds 60 products, and
    `catalogServer.meta` holds `totalItemsCount`, `totalPagesCount` and
    `page {number, size}` (2,599 smartphones on 44 pages).
  - Each product has `code`, `name`, `friendlyName`, `manufacturer.name`, `sellerName` (KaBuM!,
    Magalu and marketplace sellers), `price` (card), `priceWithDiscount` (PIX), `oldPrice` and
    `available`.
  - Pages are reached with `?page_number=N&page_size=60`.
  - `robots.txt` allows category pages, but disallows `sort=` variants, `/busca/*?` and `?query=`.
    The home page carries no department menu, because the menu loads on the client.
  - `robots.txt` names `https://www.kabum.com.br/sitemap.xml`, a sitemap index with one
    `sitemap/<slug>.xml` per department. It lists 26 product departments plus institucional,
    hotsites, busca, promocao, lojas, marcas and servicos-digitais.
- **Amazon search** (`/s?k=samsung+galaxy+a55`):
  - about 60 `data-component-type="s-search-result"` cards with `data-asin`;
  - the price and the "De" price are in `.a-offscreen` spans;
  - sponsored cards are marked "Patrocinado".
- **Amazon best sellers** (`/gp/bestsellers/electronics`):
  - 30 ranked cards in the initial HTML (`zg-bdg-text` "#1", `p13n-sc-price`), with up to 50
    after scrolling;
  - `pg=2` gives the next page;
  - each page links to its subcategory nodes (`/gp/bestsellers/electronics/<node>`).
- **Magalu** walled both ways, so it is out. Its sellers still appear inside Kabum's marketplace.

The saved responses are in `/tmp/probe-retailers/` (untrusted data). Fixtures are trimmed copies of
them.

## Decisions (Fernando: crawl catalogs, Kabum and Amazon, moderate pace, 1 offer is enough)

### 1. A local market catalog replaces Buscapé

- The Buscapé client, the worker, the batch and the 24 h block are removed, and so are
  `scripts/buscape-capture.ts` and the `BUSCAPE_*` constants. The `price_checks` table, the matcher,
  the verdict and the UI filters stay.
- New table `market_offers`, with one row per retailer listing:
  - `key` (`kabum:<code>` or `amazon:<asin>`), `retailer`, `listing_id`, `title`, `brand`, `seller`
    and `url`;
  - `price_cents`, the at-vista price: Kabum's PIX price, or Amazon's displayed price. `list_price_cents`
    is the "De" price;
  - `in_stock`, `tokens text[]` (GIN index) and `source` (`kabum_catalog`, `amazon_search` or
    `amazon_bestsellers`);
  - `first_seen_at` and `last_seen_at`.
  - Upserts update the price, the stock and `last_seen_at`.
- An offer counts only while it is in stock and was seen within its retailer's window: Kabum
  4 days, since the crawl repeats every 3 days, and Amazon 7 days. Offers unseen for 30 days are
  pruned with the other old rows.

### 2. Kabum crawler (plain HTTP)

- At the start of each pass it reads the sitemap index, one request, for the department slugs,
  leaving out the non-product entries. When the index can't be read, it falls back to
  `KABUM_DEPARTMENTS`, the 26 product departments seen on 2026-11-04. Each department listing is
  read page by page up to `totalPagesCount`, capped at `KABUM_MAX_PAGES` per department.
  - A slug that returns 404 or 0 products is logged once per pass and skipped.
- Pace: one page every 10 s plus up to 3 s of jitter.
  - A full pass starts every 3 days, measured from the last pass's start.
  - The cursor (department and page) is persisted, so a restart resumes where it stopped.
- Page kinds:
  - **results:** the products are upserted;
  - **wall:** HTTP 403, 429 or 503;
  - **unknown:** HTTP 200 but no parsable `__NEXT_DATA__`;
  - **missing:** a 404.

### 3. Amazon crawler (system Chrome)

- Its own persistent profile, `amazon-profile` next to the ML profile directory, never the ML
  profile.
  - Same launch flags as the ML browser: system Chrome on Xvfb, with no automation switch.
  - A session keeps the browser open for up to 20 pages, then closes it.
- Pace and budget:
  - one page every 30 s plus up to 10 s of jitter;
  - at most 1,000 pages a calendar day (America/Sao_Paulo);
  - best sellers may use at most 200 of those pages.
- It never runs while an ML job is queued or running (`chainIdle()`):
  - this is checked before each page;
  - when a job appears, the session closes at the next page boundary;
  - an ML job never waits for Amazon.
- Two kinds of page:
  - **Queue-driven searches** (`/s?k=<compareQuery(title)>`):
    - The search key is the existing check key (catalog product, or the item), so one search
      serves every ML listing of that product.
    - Due keys come from the same targets as before, in this order: Salvos, then fresh Novos with
      30%+ OFF (biggest first), then the other fresh Novos that show a saving.
    - A key is due when it has never been searched or its last search is 7 days old.
    - Each search is recorded in `market_searches` (`key`, `query`, `searched_at`, `status`,
      `result_count`).
  - **Best sellers**: once a day, the root page `/gp/bestsellers/`, then each department's `pg=1`
    and `pg=2`, scrolling to load all 50 cards.
- Page kinds:
  - **results;**
  - **empty:** "Nenhum resultado";
  - **wall:** HTTP 403, 429 or 503, a captcha form (`validateCaptcha`, "Digite os caracteres") or
    the "Algo deu errado" page;
  - **unknown:** none of the above.

### 4. Shared crawl rules

- **Backoff per site.** A wall, or 3 unknown pages in a row, starts a backoff of 15 min, then 1 h,
  then 4 h, then 24 h. Each further wall moves one step up, and a results page resets the level.
  - A network error or timeout counts as unknown.
  - A missing or empty page counts as neither a success nor a failure.
- **Hold.** Before each page, `requestHold(now)` is checked. The VPN, "Pausar requisições" and
  "Pausar comparação de preços" all stop both crawlers. A held crawler waits and keeps its cursor.
- **Saved state.** Each crawler's state lives in a `crawler_state` row (`site` primary key):
  - the cursor (jsonb);
  - the backoff level and `blocked_until`;
  - the day key and its page count;
  - the last page time, the last error and when the last pass started.
- **Logs.** Each block, each skipped slug and each pass start and end is logged once, with the
  `[market]` tag.

### 5. Local matching (no requests)

- **Candidates.** `retrievalTerms(mlTitle)` gives the tokens a candidate must contain: the first
  name-zone word plus up to 2 model words (letters and digits, like `a55` or `fe16`). When there
  are no model words, it gives the first two name-zone words.
  - Candidates are valid offers whose `tokens @>` those terms, at most `MARKET_CANDIDATE_LIMIT`
    (300) and cheapest first.
  - `offerTokens(title)` uses the same normalization as the matcher.
  - Recall requirement: every labelled high pair in `match-pairs.test.ts` and in the fixtures must
    be retrieved.
- **Match.** `matchCandidates(mlTitle, finalCents, cards)` runs unchanged. Cards are
  `{name, priceCents, store, storeCount: 1, url}`, where `store` is "Kabum" or "Amazon", plus the
  seller when Kabum shows one.
- **Result.** It is written to the item's `price_checks` row (`status` matched or no_match,
  `confidence`, `market_low_cents`, `second_low_cents`, `market_store`, `store_count`, `offers`,
  `source_url` = the cheapest offer, `query` = `compareQuery(title)`).
- **When it runs.**
  - The items of a key are re-matched right after its Amazon search.
  - The local matcher re-matches every target every 6 h, after each ML cycle and after each Kabum
    department.
  - Alert candidates are matched locally before each digest.
- **Validity.** A local check is valid for 12 h. The verdict reads only valid checks, and the
  6-hourly pass keeps them fresh.

### 6. Verdict (Fernando: one offer is enough)

- **Inflated:** a valid high check whose `market_low_cents` is at most the ML final price, while
  the card shows a saving.
  - The `storeCount >= 2` and second-low conditions are removed, along with `INFLATED_MIN_STORES`.
- **Hidden:** as before, inflated or a cheaper sibling, and not Salvo.

### 7. UI

- **Ofertas coverage line:** "Com preço de mercado: X% das ofertas com 30%+ OFF". It is the share
  with a valid high check.
- **Card texts:** unchanged, with the store now named, for example "Mais barato fora do ML: R$ X na
  Kabum (Magalu)".
- **Conta, "Comparação de preços" panel, one block per site:**
  - state: rodando, em espera (hold reason), bloqueado até HH:MM or "aguardando a próxima
    passagem";
  - pages today against the budget, and the offers in the catalog;
  - Kabum: the pass progress (department and page);
  - Amazon: keys searched against keys due, and when best sellers last ran;
  - the last page time.
- **"Comparar agora":** re-matches the item locally at once and moves its key to the front of the
  Amazon queue. The answer is the local result, plus "Busca na Amazon na fila" when it is queued.
  It sends no request itself.
- `/api/health` carries the two crawler states. The watchdog does not notify for crawler blocks.

### 8. Development requests

Agents send no requests to any site. The team lead captures fixtures with
`scripts/market-capture.ts`:
- at most 10 requests per site for the whole implementation;
- only with the VPN off;
- stopping at the first wall.

## Rollout

- Migration 0015 adds `market_offers`, `market_searches` and `crawler_state`. It runs in an idle
  window at least 15 min before `nextRunAt`.
- The deploy uses the README update steps.
- At deploy, the Buscapé rows are deleted from `price_checks` (our own data), so every check is
  local.
- After deploy:
  - watch the first Kabum department and the first Amazon session in the journal;
  - fix any skipped Kabum slugs;
  - then spot-check about 20 flagged cards.

## As built and deployed (2026-11-04 23:55 UTC)

The build was implemented in Tasks 40 to 45 by four developers, each with an independent reviewer.
Changes from the text above that came out of review:

- Retrieval terms mirror the matcher's anchor as `{ all, any }`:
  - all = the anchor name words;
  - any = the model words, else the hard sizes, else the numbers; a single any word moves into all.
  - Candidates are `tokens @> all and (any empty or tokens && any)`, inside the matcher's price
    band (`priceBand`).
  - Order: offers holding more any terms first, then the effective price.
  - On 528 fixture titles: 1,227 accepted pairs, 0 retrieval misses.
- Kabum:
  - campaign prices ("AGORA OU NUNCA") are stored with `price_until`, and the regular PIX price
    applies after it ends;
  - open-box offers are skipped;
  - departments come from the sitemap index.
- Every parsed offer passes `storableOffers` (NUL stripped, int4 prices).
- Pages that parse to nothing count as unknown, never as an empty success.
- A page whose write fails is skipped or retried in 24 h, so one bad page can't stall a crawler.
- Amazon search keys whose page was unknown are retried after 24 h. Walls are never recorded per
  key.
- `items_check_key_idx` on `coalesce(product_id, 'item:' || id)`: created live at 22:47 UTC
  because Conta's inflated count took 2-3 min; it now takes 0.11 s.
- "Comparar agora" is local:
  - it always moves the key to the front of the Amazon queue;
  - it answers with `amazonQueued` and `amazonSearchedAt`, so a card shows "busca na Amazon na
    fila" or "Amazon buscada há X".
- Conta reads the crawler state live, and caches only the counts. `/api/health` keeps working
  when the market status fails (`market: null`).
- Failed runs keep the Postgres cause (`errorText`).

Deploy and first minutes:
- Kabum read hardware pages 1-6 of 145, about 11 s apart, giving 299 offers (211 on campaign).
- Amazon read the best-seller root and one department in its own Chrome, giving 52 offers.
- The boot rematch covered 21,809 keys in 13 s.
- There were no blocks.
