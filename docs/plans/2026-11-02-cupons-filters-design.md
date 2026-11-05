# Cupons filters and offers for a coupon set: design

Date: 2026-11-02. Asked by Fernando: "a better filter for cupons and a way to check offers for
all cupons on given filter. The most important is the lowest compra minima with the biggest
limit." He chose reading unread coupons in the next cycle (no extra ML traffic) and left the
rest of the design to the agent.

## What the data says

- 1,931 coupons, 1,785 with a listing. Every live coupon has a minimum and a limit.
- For percent coupons a huge limit means "no cap": 8% OFF, minimum R$ 1, limite R$ 10.000.000.
  A raw "limit / minimum" ratio is dominated by those placeholders, so it is not the ranking.
- Only one coupon has linked offers before the first cycle; a full discovery rotation takes
  about 30 h at 300 listings per cycle.

## The number: desconto na compra minima

The share of the price the coupon takes off when you buy exactly its minimum.

- Fixed: `value / max(minimum, value)`. R$ 10 OFF min R$ 11 = 91%; R$ 200 OFF min R$ 400 = 50%.
- Percent: `min(percent, limit / minimum)`, or the percent when the minimum is 0 or missing.
- Unparsed, or a fixed coupon without a value: no number; sorts last.

Shown on every coupon row. Percent coupons also show "rende ate R$ X" (`limit / percent`): the
price up to which the full percent applies. A limit of R$ 100.000 or more reads "sem limite".
The number is one SQL expression (filter and sort over all coupons) mirrored by a pure,
tested TypeScript function for display; tests keep the two in step.

## Cupons filters and sort (URL params, pt-BR)

Kept: `status`, `escopo`, `tipo`, `vence`, `pagina`. New:

| Param | Meaning |
|-|-|
| `minimoMax` | compra minima up to R$ X |
| `limiteMin` | limit from R$ Y (for fixed coupons the limit is the value) |
| `descontoMin` | desconto na compra minima from N% |
| `comOfertas=1` | only coupons with linked, fresh offers |
| `q` | text in the title or store (trimmed, at most 80 characters, LIKE wildcards escaped) |
| `ordem` | `desconto` (default), `economia`, `minimo`, `limite`, `ofertas`, `vence` |

0 or empty means no filter, as on Ofertas. Ties break on `campaign_id` so pages are stable.

**Revised after the first real cycle (2026-11-02):** the default sort put "80% OFF, minimo R$ 1,
limite R$ 1" second although it can save at most R$ 1, which ignores the "biggest limit" half of
the request. Each coupon also gets its maximum saving (`maxSavingCents`: the limit for percent
coupons, unbounded when uncapped, the value for fixed ones), shown as "Economia maxima: R$ X" or
"sem limite". The default `desconto` sort ranks coupons that can save less than R$ 5 after all
others, then by desconto na compra minima, and says so under the sort select. `economia` sorts by
maximum saving (unbounded first). Ended or expired coupons come last in every sort.

## Offers for a coupon set

Cupons gets "Ver ofertas destes cupons": a link to Ofertas with `cupons=<the canonical coupon
filter query>` (no page, no sort). Ofertas reads it with the same coupon parser and keeps offers
linked (fresh link) to at least one LIVE coupon matching those filters, in one `EXISTS` built
from the same coupon condition builder the Cupons page uses. The filter bar shows one chip
("Cupons: minimo ate R$ 100, ativo") with a way to remove it. `cupons` is an alert key, so an
alert on such a view works; `normalizeAlertQuery` re-normalizes the nested query. An empty
`cupons` value means no filter; an unparsable one drops to no filter.

## Priorizar no proximo ciclo

Cupons gets "Priorizar no proximo ciclo" for the current filter. It sets
`coupons.discovery_priority_at = now` (new nullable column, migration 0002) on the matching
live coupons that have a listing. The discovery rotation puts a coupon first while it is
pending: `discovery_priority_at` is set and `discovery_tried_at` is null or older than it;
pending ones are ordered by priority time, newest first, then strength. A coupon stops being
pending as soon as the next cycle tries it, so nothing has to be cleared. No extra ML traffic:
the cycle still reads at most its budget. Rows show a "Prioridade" badge while pending, and the
confirmation says how many were prioritized and when the next cycle runs (or that automatic
runs wait for the first cycle). `POST /api/coupons/priority` goes through `withApi`; it loads no
page, so it needs no browser-only confirm.

## Out of scope

Coupon stacking (two coupons on one item), per-category coupon taxonomy, and reading
unread coupons immediately (Fernando chose the next cycle).

## Total saving with coupons applied, on Ofertas (added 2026-11-02, after the first cycle)

Fernando: "the list to show me the biggest change in total value, in percentage and in actual
reais if we have the coupons applied, so I can order by that and also filter."

Data after the first cycle (14,010 items): 10,909 already show their price with the coupon applied
(`coupon` or `pix_coupon` basis, all with a "de R$ X" list price), and ML's "NN% OFF" there is the
floored list-to-shown change (R$ 28,52 against R$ 66,29 shows 56% for 56,98%). About 1,100 carry a
coupon that is not applied yet (linked to a coupon, or a "15% OFF com Cupom" hint); the rest have no
coupon. Only the hint text was stored, so sorting on it needs numbers.

**Final price** (one SQL expression, mirrored by a pure tested function):
1. basis includes a coupon: the shown price (ML already applied it);
2. else the best linked live coupon on a fresh link that the price qualifies for (price at least
   its minimum): percent `min(round(price x percent), limit)`, fixed `min(value, price)`;
3. else the shown price.
Case 2 is an estimate (ML has not applied the coupon), marked "estimado". A card hint alone
("R$ 120 OFF com Cupom") never makes an estimate: it does not carry the coupon's minimum or limit,
and applying it put a R$ 15 item at "100%" (decided 2026-11-02 after the first build). Such a card
shows the hint as text, "Cupom no anuncio: 15% OFF (condicoes nao informadas)".

**Reference price:** the list price when present and above the final price, else the shown price.
**Economia total:** reference minus final, in R$ and as a share of the reference.

Ofertas cards show "Economia total: R$ X (Y%)" and, for estimates, "Preco com cupom: R$ Z
(estimado)". New sorts `economia` (percent) and `economiaReais`; new filters `economiaMin` (%,
the same display-rounded threshold as Cupons) and `economiaReaisMin` (R$). Both filters are alert
keys. (Migration 0003 added three hint-number columns for the hint estimate; once hint-only
estimates were dropped, migration 0004 removed them.) Coupon stacking stays out of scope.
