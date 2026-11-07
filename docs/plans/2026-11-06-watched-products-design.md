# Watched products: design

Date: 2026-11-06. Replaces the broad discovery of `2026-10-31-promo-cps-design.md` (Ofertas,
Buscas, Alertas) and the market catalog of `2026-11-04-market-catalog-design.md`.

## Why

Fernando: "I think we need to rework this app. Seems like keeping track of all the possible
products is not viable. Rather than doing like right now, lets try to create targeted searches
where we have alerts for prices/promotions to a 1:1 match products in all major retails."

At that point the app read 300 ML listings per cycle and held 135k Kabum and Amazon offers, with
0 alerts and 0 Buscas configured. The catalog crawl was paused on 2026-11-06 13:57 UTC.

## Decisions (Fernando)

- The core becomes "Produtos monitorados". Ofertas discovery, the catalog crawl, Buscas, Alertas
  and the fake-discount verdicts are replaced. ML coupon harvest and activation stay, because
  coupons lower the ML price of watched products.
- Matching: the barcode (EAN/GTIN) first. Where a store has no barcode, matching is automatic,
  using the existing matcher at high confidence. There is no confirmation step. Each listing
  shows how it was matched, and a wrong one can be removed.
- Stores: Mercado Livre, Amazon and Kabum, plus Americanas, Buscapé (as the aggregator for
  Magalu, Casas Bahia and others), Magalu, Casas Bahia and the VTEX stores, where feasible.
- Approach 1, targeted lookups per watched product: one matched listing per store, refreshed a
  few times a day.

## Probes (2026-11-06, VPN off, at most 3 requests per site)

| Store | Find | Refresh | Barcode |
|-|-|-|-|
| Americanas | VTEX API `/api/catalog_system/pub/products/search?fq=alternateIds_Ean:<ean>` or `?ft=<text>`, plain HTTP | same API, `fq=productId:<id>` | in the data (`items[].ean`); an EAN filter returned all 10 listings of the 520BT, marketplace sellers included |
| Amazon | `/s?k=<ean or text>` in Chrome; the EAN search returned exactly 1 result | `/dp/<asin>` in Chrome: `corePrice`, "Em estoque", seller, brand, model | searchable, not shown on the page |
| Kabum | `/busca/<text>` only renders in Chrome; the rendered page embeds `catalogServer` (60 per page) | `/produto/<code>` over plain HTTP (`__NEXT_DATA__` product: price, offer, available) | none |
| Buscapé | `/search?q=<text>` over plain HTTP, product cards | product page over plain HTTP: `__NEXT_DATA__` offers with merchantName (KaBuM!, Magazine Luiza, Amazon, Americanas...) | not searchable |
| Mercado Livre | the app's ML browser, a search page as the Buscas step reads it | the same search, giving the card price and couponHint | not verified; agents may not load ML |
| Magalu | 403 in plain HTTP and Chrome | only through Buscapé | |
| Casas Bahia | wall in plain HTTP and Chrome | only through Buscapé | |
| Carrefour, Fast Shop | 403, and an Akamai "DNS failure" | out | |

The captures are in `/tmp/probe-watch/` and `/tmp/probe-retailers/` (untrusted data).

### Correction after Task 60 (2026-11-06 15:00 UTC)

impl-w1's parse of the real Buscapé product page found that:
- Offers live in `initialReduxState.offers.offerList` (`sellerName`). The server renders only 6
  of 49 offers, from 3 merchants: KaBuM!, Want Import and Amazon.
- The Magalu and Americanas names in the probe came from `smartRecommenderHits`, which are
  unrelated products.
- So Buscapé does NOT reliably reach Magalu or Casas Bahia. Both stay uncovered until a direct
  source works.
- A Buscapé product groups every color of an item. A Buscapé offer therefore counts only when its
  own title matches the product (high confidence, no color conflict), and merchants read directly
  (KaBuM!, Amazon, Mercado Livre, Americanas) are dropped from it.
- The matcher also rated other colors as high: "Preto" matched "Branco". chooseMatch now rejects a
  color conflict, and among high matches it prefers one that names the same color.

## Model

- **watched_products:**
  - id, name, query (the search text), ean (nullable), ean_source;
  - target_price_cents (nullable), drop_percent (default 10), active, created_at.
  - `ean_source` is one of: `manual` (typed by Fernando), `link` (read from the link he pasted),
    or `americanas` (the only distinct EAN among high-confidence Americanas title matches).
- **watched_listings:** one per product and store:
  - retailer (`ml`, `amazon`, `kabum`, `americanas`, or `buscape` with a merchant name), ref
    (ML item or catalog id, ASIN, Kabum code, Americanas productId, Buscapé product slug), url and
    title;
  - match (`barcode`, `auto` or `link`), removed (Fernando rejected it, so it is not tracked or
    re-found);
  - price_cents, list_price_cents, final_cents (ML: price minus the couponHint coupon), in_stock;
  - checked_at, last_error.
- **listing_price_segments:** listing_id, price_cents, first_seen_at, last_seen_at. A new segment
  starts only when the price changes, as `price_segments` does today.
- **watch_alerts:** product_id, kind (`target`, `low_30d` or `drop`), price_cents, listing_id,
  sent_at. This log keeps one notification per product, kind and price.

## Flow

1. **Add:** a name, or a link from ML, Amazon, Kabum, Americanas or Buscapé, plus an optional EAN
   and target price.
   - A link gives the first listing (match `link`) and its title.
   - An Americanas link gives the EAN too.
   - When no EAN is known, the app looks the title up at Americanas. It adopts an EAN only when
     the high-confidence matches all carry the same one (`ean_source=americanas`).
2. **Resolve, per store, each one paced and hold-aware:**
   - Americanas: by EAN, else by title, then the matcher.
   - Amazon: by EAN, else by title.
   - ML: by EAN, else by title, in the ML cycle.
   - Kabum: by title in Chrome.
   - Buscapé: by title, taking the best product card, whose page lists every merchant.
   - A barcode hit is `barcode`. A title hit needs a high-confidence match and is `auto`.
   - Resolve runs on add and again weekly, so new listings appear. Removed listings are never
     re-added.
3. **Refresh:**
   - every watched listing every 3 h, except ML, which refreshes in the ML cycle (also 3 h);
   - one request per listing, Buscapé's page giving several merchants;
   - the price history is updated.
4. **Alerts,** evaluated after each refresh, on the best final price across stores:
   - `target`: the price is at or below the target;
   - `low_30d`: a new 30-day low;
   - `drop`: at least `drop_percent` below the previous best, counting only stores that already
     had a price before this check. A store's first price is a discovery, not a drop (correction
     after the 2026-11-06 deploy, whose first resolve sent false drops).
   - Delivery is a desktop notification through `notify-send`, logged in watch_alerts so it isn't
     repeated.

## Traffic

About 30 products × 5 sources × 8 refreshes a day is roughly 240 requests a day per site. The VPN
and manual holds stop everything. Chrome sources (Amazon, Kabum search) never run while an ML job
is queued or running. Each site keeps the 15 min, 1 h, 4 h, 24 h backoff.

## UI

- **Produtos (`/`, replacing Ofertas):** watched products, each with its best price, the store
  and how far that is from the 30-day low, plus an "Adicionar produto" form (name or link, EAN,
  target price).
- **Product detail:** one row per store, with price, list price, final price (ML coupon), match
  type ("código de barras", "automático" or "link"), a link, the last check and "Remover este
  anúncio". Also the 30-day low and the alert settings.
- **Cupons and Conta** stay. Conta's "Comparação de preços" panel becomes "Monitoramento": source
  states, the next refresh and the last alert.
- **Removed:** Ofertas, Buscas and Alertas pages and their API routes.

## Removal

- **Code:** the discovery step, the Buscas step, Alertas, the market crawlers (Kabum catalog pass,
  Amazon queue and best sellers), the rematch loop and the verdicts.
- **Tables:** they stay until the new flow is proven. A later migration drops market_offers,
  market_searches, price_checks, searches, alerts and alert_hits.
- **Kept:** items, price_segments and coupons, because coupons and their activation still use
  them.
