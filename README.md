# Promo CPS

A single-user coupon and deal finder for [Mercado Livre](https://www.mercadolivre.com.br) (ML) in Brazil. It harvests every coupon on the account, activates the strong ones, reads the items each coupon applies to, ranks the good deals, and sends a **desktop notification** when a saved alert gets a new or cheaper offer. It runs locally: a Next.js app bound to 127.0.0.1, a PostgreSQL database, and a headed Chrome on a virtual display for each run. No deployment platform is required.

Use a **secondary ML account**. The app reads and activates coupons at volume on whatever account its browser profile holds, so do not point it at your everyday account. Nothing is bought: the app never adds to a cart or checks out.

A cycle runs when you press **Rodar agora** on Conta, and then automatically every `RUN_EVERY_HOURS`. It reads ML one page at a time, with a pause between pages, in one browser session.

## Stack

- **Next.js 16** (App Router) + **TypeScript** + Tailwind
- **PostgreSQL 16** + **Drizzle** (`postgres-js` driver)
- **Playwright** as a library, driving the system **Google Chrome**
- **Xvfb** for runs in the background
- **zod** for config validation
- **Vitest** for pure logic (no database in tests)

## Requirements

- **Node 22.13.1**, pinned in `.nvmrc`. Run `source ~/.nvm/nvm.sh && nvm use` once per shell.
- A **PostgreSQL 16** server on this machine.
- **Xvfb** on the PATH. Background runs start their own display with it.
- **Google Chrome** installed. The app launches it with `channel: 'chrome'`, not Playwright's bundled Chromium, because ML refuses logins from the bundled Chromium (it runs with automation flags). So `npx playwright install` is not needed.

## Setup (local)

1. `source ~/.nvm/nvm.sh && nvm use`
2. Create the role and database (needs `sudo`), with a password of your own:

   ```bash
   echo "CREATE ROLE promocps LOGIN PASSWORD :'pw'; CREATE DATABASE promocps OWNER promocps;" | sudo -u postgres psql -v pw='<password>'
   ```

3. `cp .env.example .env`, then set `DATABASE_URL` with the same password and `ML_PROFILE_DIR` to an absolute path, for example `$HOME/.local/share/promo-cps/profile`. Keep `.env` out of git; it holds the password.
4. `npm install`
5. `npm run db:migrate`
6. `npm run build && npm start`, or `npm run dev` while developing. Open <http://127.0.0.1:8510>.

The app listens on 127.0.0.1 at `PORT`, default **8510**. Port **8500** is refused because olxmapper uses it.

## First login

Open **Conta** and press **Entrar no Mercado Livre**. A Chrome window opens on your desktop at ML's login page; sign in to the secondary account there. The app only watches that page and never clicks or types in it. Conta reports logged in once the page settles on the coupons page, or refused when ML shows that no login method is available.

The only login path is that button. Never copy a session or cookies from another browser into `ML_PROFILE_DIR`.

Then press **Rodar agora** on Conta to run the first cycle. Automatic runs stay paused until one manual cycle finishes `ok` or `partial`.

## Tests and checks

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Run it

1. `npm run build && npm start` (or `npm run dev`).
2. Open <http://127.0.0.1:8510>.
3. Scheduled runs need no action after the first manual cycle. The scheduler starts with the server, and `AUTO_RUN=off` turns it off.

## Running it permanently

`deploy/systemd/` holds user units that run the production build as a desktop service, plus a watchdog.

Install (once):

```bash
mkdir -p ~/.config/systemd/user
ln -s "$PWD"/deploy/systemd/* ~/.config/systemd/user/
systemctl --user daemon-reload
npm run build
systemctl --user enable --now promo-cps.service
for _ in $(seq 30); do curl -sf http://127.0.0.1:8510/api/health >/dev/null && break; sleep 2; done
systemctl --user enable --now promo-cps-watchdog.timer
```

The timer is enabled only once the server answers, because its first check is already due (15 minutes after boot has passed) and would report a false "servidor fora do ar".

- `promo-cps.service` runs `next start` with `.env` loaded the same way as `npm start` (port from `PORT`, default 8510). It follows the graphical session: it starts when you log into the desktop and stops at logout, so it always has the session's `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY` and D-Bus address. The ML login window and `notify-send` need them. It restarts 10 s after a crash, and a stop kills the whole control group, including a leftover Xvfb. Chrome moves itself into its own `app-com.google.Chrome-*.scope`, so it is outside that group: Playwright closes it when the server exits, and a hung browser is killed by the app itself (it finds Chrome by its exact `--user-data-dir` argument).
- Never run `npm run dev` and the service together: both use the same port and the same Chrome profile, and the dev server would start its own scheduler against the same database. Stop the service first.
- Logs: `journalctl --user -u promo-cps -f`.
- Update after code changes, while Conta shows no cycle running. The order matters: stop the watchdog timer first and start it last, otherwise its hourly check can fire during the build, or right after the start, and send a false "fora do ar".

  ```bash
  systemctl --user stop promo-cps-watchdog.timer promo-cps
  npm run build
  systemctl --user start promo-cps
  for _ in $(seq 30); do curl -sf --max-time 5 http://127.0.0.1:8510/api/health >/dev/null && break; sleep 2; done
  systemctl --user start promo-cps-watchdog.timer
  ```

  When dependencies changed, run `npm ci` before the build, while the service is stopped.
- Rollback: once the repo has commits, use the same order with `git checkout <last good>` and `npm ci` before `npm run build`, then the same start, wait for `/api/health` and timer start. Migrations are forward-only, so a rollback across a migration only works if the older code stays compatible with the newer schema. Until the first commit there is no version to roll back to.
- Disable: `systemctl --user disable --now promo-cps.service promo-cps-watchdog.timer`. This removes the symlinks, so installing again needs the `ln -s` step.

The watchdog (`scripts/watchdog.ts`, hourly, from 15 minutes after boot) reads `GET /api/health` and sends a `notify-send` notification for each of these problems, when it first appears and then at most once a day while it lasts:

- the server does not answer within 10 s, or answers with an error;
- the scheduler is paused (the notification shows the reason, such as an expired session);
- the last cycle that started, counting from the server's own start, is more than 2 x `RUN_EVERY_HOURS` + 1 h old, the scheduler is on and not paused, and no cycle is running. A failed planning attempt (retried every 10 minutes) is not a pause; if it lasts, this rule catches it.

`/api/health` also carries the state and block end of each price crawler (`market`), or `null` when they can't be read; neither a crawler block nor a `null` ever notifies. A cleared problem is forgotten and no "resolved" notification is sent. The state lives in `${XDG_STATE_HOME:-~/.local/state}/promo-cps/watchdog.json`. The watchdog is not tied to the graphical session, so after you log out it finds the server down, but `notify-send` has no desktop to show it on. That failure is logged and not recorded, so the problem stays unnotified. Lingering is already on for this user, so the timer also runs without a login. `PROMO_URL` in `promo-cps-watchdog.service` must follow `PORT`.

## Pages

All labels are in Portuguese.

- **Ofertas** (`/`): deals ranked by ML's discount, with tabs **Novos**, **Salvos** and **Vistos**. The filters are a pill bar with popovers (Busca, cupom, preço máximo, desconto mínimo, queda real, vendidos, FULL, frete grátis, categoria, economia, **Mostrar ocultos**, **Só verificados**), all kept in the URL. The text filter matches each word at the start of a word in the title, ignoring case and accents ("fone" finds "Fones" but not "Microfone"; a digit before a word still counts as a start, so "ml" finds "300ml"). Sorts: maior desconto do ML (default), maior queda real, menor preço, mais recentes, the total-saving sorts, maior economia real (R$) (the saving against the cheapest outside price; unchecked items last), and maior economia do cupom (R$), which orders by the coupon's part of the saving (estimated from the price when the price already includes one linked coupon, else the estimated coupon discount). A card shows its price with the basis as text ("no Pix com Cupom"), ML's discount and "de" price, the real-drop badge or, on a card with no history line, "sem histórico", **Economia total: R$ X (Y%)**, the estimated price when a linked coupon is applied in the estimate ("Preço com cupom: R$ Z (estimado, -R$ Y)"), and "Cupom no anúncio" when the card only shows a coupon hint that no coupon chip on the card explains (a hint that is a price shows as "Preço com cupom no anúncio: R$ X"). Each coupon chip reads "na lista do cupom: ... (mín. R$ M, até dd/mm/aaaa)", with an amber "abaixo do pedido mínimo" chip when the price is under that minimum. A card also has a price-history line ("Desde dd/mm: menor R$ X, maior R$ Y - mesmo preço desde dd/mm", or only "Mesmo preço desde dd/mm" with one price segment), "Cupom: -R$ Y (estimado) - desconto do vendedor: -R$ Z" when its price includes exactly one linked coupon and the listing carries no coupon hint, and "Faltam R$ X para o pedido mínimo de R$ M" when the price is under a linked coupon's minimum when up to 3 units reach it with the coupon worth at least R$ 5 (the line gives the units and what the coupon is then worth; otherwise the coupon chip shows the minimum). While no item has 7 days of history, the queda sort and the "Só abaixo do menor preço" filter show "Quedas reais aparecem a partir de dd/mm (7 dias de histórico)". **Alertar** saves the current view (the sort is not saved; with no narrowing filter, the form says the alert covers every offer in Novos and Salvos). **Visto** stores the price it was marked at: when a later read is at least 1% and R$ 1 cheaper, the item returns to Novos with "Preço caiu desde que você viu: era R$ X" (Salvos is never moved; marking Novo by hand clears the stored price). Salvos ignores the 72 h freshness filter (so it has no "Incluir não lidos nas últimas 72 h" pill), and every card says when it was read ("lido há N h"): "Visto" is only a status, never a read time. On Novos, **Marcar esta página como vista** and **Marcar os N filtrados como vistos** (with no narrowing filter, **Marcar todos os N de Novos como vistos**; both ask first, saying the items leave Novos and alerts until their price drops) mark in bulk; only what was read before the page rendered is marked, and the page then says how many were marked.
- **Cupons** (`/cupons`): every harvested coupon with its status (Ativo, Inativo, Encerrado; the header reads "N cupons, M válidos" unless a status filter is set), escopo, compra mínima, limite, "desconto na compra mínima", "economia máxima" (or "sem limite"), validade and "Ver no ML". Filters and sorts (menor compra mínima, maior limite, and others) are in the URL. **Ver ofertas destes cupons** opens Ofertas with the offers linked to the coupons in the current filter. **Priorizar no próximo ciclo** moves those coupons to the front of the discovery rotation; both actions show only when a coupon filter is active.
- **Buscas** (`/buscas`): a name and a pasted ML URL (a search page or a product page), or just a typed term: `fone bluetooth` becomes `https://lista.mercadolivre.com.br/fone-bluetooth` and the name defaults to the term. On Ofertas, a text search shows **Seguir 'termo' no ML**, a link that opens Buscas with the term prefilled; creating a Busca loads nothing from ML. Each Busca has its own interval (1, 3, 6, 12 or 24 hours), its last status, and **Rodar agora**.
- **Alertas** (`/alertas`): saved views, with their filters as chips, **Abrir** and **Excluir**.
- **Conta** (`/conta`): the login state, **Entrar no Mercado Livre**, the **Ciclo** panel with **Rodar agora**, **Execução automática** (next run or the reason for a pause), **Comparação de preços** (one block per site, Kabum and Amazon, with its state, pages and progress, then the coverage, the last check, the 24 h counts and the inflated items), **Verificação do Mercado Livre** (**Resolver verificação**), and **Últimas execuções**.

## How a cycle works

1. **Preflight.** The app opens the coupon list. A redirect to login ends the run as `session_expired`. A verification page or captcha wall ends it as `blocked`. Neither is retried in a loop.
2. **Harvest.** Every page of the coupon list is read (30 coupons per page), and each coupon is stored with its terms from the list. A coupon missing from two consecutive complete harvests is marked ended. A partial harvest ends nothing, and a harvest with any skipped entry is not complete. One cycle never ends more than 30 coupons or 5% of the live ones, whichever is larger. A larger removal is refused and recorded as `endingRefused`; it ends only when the next complete harvest confirms it with a similar count.
3. **Activation.** Up to `ACTIVATE_PER_RUN` inactive coupons that are valid now and were not tried in the last 24 hours are activated, largest maximum saving first (coupons that save less than R$ 5 last), by clicking **Aplicar** on the coupon's page. Two clicks in a row with no response stop the run as `blocked`.
4. **Buscas.** Each due Busca is read: a search URL reads 2 pages, a product URL reads its page.
5. **Discovery.** Coupon listings are read in rotation, page 1 of each, up to `DISCOVERY_PAGES_PER_RUN` pages minus the pages the Buscas used. Each item becomes an observation, linked to the coupons its card matches.
6. **Drops.** The real-drop figure is recomputed for each page's items.
7. **Record.** The run is saved with its status (`ok`, `partial`, `failed`, `session_expired` or `blocked`), pages and counts.
8. **Alerts.** Digests and session notifications are sent after the run is saved.

The run stops at once on a login or captcha page, and on HTTP 403 or 429. A page that fails is retried once, then skipped, which makes the run `partial`. A listing whose page state has no results is counted apart (`discoveryEmpty`) and does not make the run `partial`. When several pages in a row fail to load (timeouts, network errors, missing page state), the run ends `failed` and holds automatic runs like `blocked`, so an outage is not retried in a loop.

**Reader health.** After each cycle, the counts are checked for signs that ML changed its pages: coupons read under 90% of ML's total, any skipped entry, unparsed over 5% of coupons seen, fewer than 20 items per listing read, dropped cards over 5% of items, failed plus empty listings over 10% of discovery pages, no coupon links written, or price basis `other` on over 5% of items. The warnings are stored in the run (`health`, a bitmask), shown as "O leitor do Mercado Livre pode ter mudado: ..." on Conta and Ofertas, and sent as a desktop notification when a new warning appears (an improvement does not notify) and as a reminder about once a day while any warning lasts.

**Buscas and the cycle.** A Busca whose page state has no results is read as empty (status `ok`, `buscaEmpty`), not as a failure. A Busca that comes due within half of the shorter of the cycle and its own interval of a cycle runs in that cycle (a 3 h Busca is read by the nearest cycle; a 1 h Busca still runs between cycles), and the scheduler does not start a separate Busca run just before it. A Busca that last read `ok` with no items shows "nenhum resultado no ML" beside its last-read time; a Busca that was never attempted is read at the next scheduler check instead of waiting out the post-run cooldown, unless a run failed before reading it (then it counts as tried and waits).

**Pruning.** After each finished cycle, items not observed for 90 days (never Salvos, with their price history, links and alert hits), ended or expired coupons older than 60 days with no item links, and runs older than 180 days (never the latest of each kind) are deleted, items in batches of 5000 (at most 100,000 per cycle); the counts go to the server log.

**Jitter.** Each automatic cycle slot moves by an offset of up to 15 minutes either way, derived from the slot's own time (so "Próxima execução" shows the time the scheduler uses, also after a restart) and never earlier than the previous run's finish. There are no quiet hours.

**Pauses.** A refused login or an expired session pauses automatic runs until a later login or a run that worked. Until the first manual cycle finishes `ok` or `partial`, the scheduler stays paused.

**First live cycle (2026-11-02):** `partial` after 444 page loads, with no wall. Its harvest was complete (1,974 coupons read against ML's total of 1,977), it activated 19 coupons and failed 1, and it read 300 listings: 13,864 items, with coupon links to 292 coupons.

## Deal ranking

- **Rank:** `ml_discount_pct`, ML's percent off its "de" price, with the coupon or Pix already in the price as shown. This is the default sort on Ofertas.
- **Real drop:** the price is below the lowest price the item had in the last 30 days, once the item has at least 7 days of history. The badge shows from a 1% drop. The percent is `(lowest - price) / lowest`.
- **Offer:** an item with an ML discount above zero, a real-drop badge, or a total saving from a linked coupon. Only offers are alerted; other items stay browsable on Ofertas.
- **Economia total:** the drop from the "de" price to the price with coupons applied, in R$ and as a percent with one decimal. It is sortable and filterable on Ofertas.
- **Pix:** every price is kept with its basis, so a Pix price and a coupon price can be compared over time.

## Price comparison (fake discounts)

ML gives no reference price, so a big "de" price can be inflated. The app keeps its own catalog of what Kabum and Amazon Brasil sell, matches the price you would pay (the final price, coupons included) against it locally, and flags the offers whose discount is not real. No price aggregator is involved, and none of it touches ML or the ML profile.

- **Sources:** two crawlers fill the `market_offers` table, one row per retailer listing (title, seller, price, "de" price, stock and link).
  - **Kabum** is read over plain HTTP, with no browser. Each pass reads Kabum's sitemap index for the product departments (a fixed list of 26 when the index can't be read), then each department's listing page by page, 60 products a page. A department that answers 404 or has no products is skipped and logged once per pass.
  - **Amazon** is read in system Chrome on its own virtual display, with the same launch flags as the ML browser and its own profile, `amazon-profile`, in the same folder as the ML profile (`$(dirname "$ML_PROFILE_DIR")/amazon-profile`). The ML profile and session are never used. It searches each cleaned title (`/s?k=...`), one search per catalog product or item, in this order: Salvos, then fresh Novos with 30% or more off (ML's discount, biggest first), then the other fresh Novos that show a saving. A key is searched again after 7 days. Once a day it also reads the best sellers: the root page, then pages 1 and 2 of each department. A browser session lasts at most 20 pages.
- **Pace and budgets:**
  - Kabum: 1 page every 10 s (plus up to 3 s of jitter), and a full pass every 3 days, counted from the start of the last one. Its place (department and page) is saved, so a restart resumes there.
  - Amazon: 1 page every 30 s (plus up to 10 s), at most 1,000 pages a day (São Paulo calendar day), of which the best sellers take at most 200. It never runs while an ML job (a cycle, a Busca run, login or verification) is queued or running: it checks before every page and closes its session at the next page, and an ML job never waits for it.
- **Backoff:** each site backs off on its own. A wall (HTTP 403, 429 or 503, Amazon's captcha or its "Algo deu errado" page), or 3 unreadable pages in a row, stops that site for 15 min, then 1 h, then 4 h, then 24 h, one step up for each further wall. A page with results resets it. A network error or timeout counts as an unreadable page, and a missing or empty page counts as neither. Each block, skipped department and pass start and end is logged once with the `[market]` tag.
- **Matching is local and by title.** The candidates are at most 300 valid offers (in stock, and seen in the last 4 days on Kabum or 7 on Amazon), cheapest first, that contain the title's first name words and at least one of its model words, or of its sizes when it has none. Model, size, pack and tier words must agree, accessories and refills are rejected, and only prices between a fifth and 3 times the ML price count. A high-confidence match needs at least 2 key words and 60% word overlap; a medium one only shows "Possível equivalente fora do ML". The result goes to `price_checks`, with the cheapest offer's link, and is valid for 12 h.
- **When it matches:** every target is rematched every 6 h, after each finished cycle or Busca run and after each Kabum department. A key is rematched right after its Amazon search, and alert candidates are matched before each digest. Matching sends no request.
- **Desconto inflado** (red badge, hidden by default) needs a valid high-confidence match whose cheapest offer is at or below the final price, while the card shows a saving (an ML discount or a coupon saving). One offer is enough. A medium match or an expired check never flags. The card reads "Fora do ML: R$ X na Kabum (vendedor); aqui R$ Y", with the seller only for Kabum marketplace offers and "(N lojas)" only when more than one store matched.
- **Mais barato em outro anúncio** (hidden by default) means another fresh listing of the same ML catalog product, with the same title (compared in lower case), costs at most 90% of this price. The card links to it. A listing whose price is "/un. comprando N" never counts as the cheaper one.
- **Salvos are never hidden.** The pill **Mostrar ocultos** (`inflados=1`) shows hidden items, marked; the Ofertas header says "K ocultos (desconto inflado ou anúncio igual mais barato)", with "K ocultos" as the link that turns it on. `inflados` is an alert key: alerts skip hidden items unless saved with the pill on. **Marcar como visto** in bulk marks only what the list shows.
- **Economia real** is the cheapest outside price minus the final price. A card shows "Economia real: R$ Z (P%) vs R$ X na loja" when it is positive, and "Sem economia real: R$ X na loja" otherwise. The sort **Maior economia real (R$)** puts unchecked items last. "preço 'de' nunca praticado" appears with at least 30 days of history when the item never sold above 70% of its "de".
- **Comparar agora** shows on a card without a check, or whose check found no equivalent ("sem equivalente na Kabum ou Amazon"); it is hidden once a match is found. It rematches the item at once against the catalog, with no request, and moves its key to the front of the Amazon queue. The card then shows the result (the price line, or "sem equivalente na Kabum ou Amazon"). When the key was queued it adds "busca na Amazon na fila", and the next Amazon session searches it and rematches it. When there is still no equivalent and Amazon searched the key in the last 7 days, so nothing is queued, it adds "Amazon buscada há X" instead. Focus moves to the compare row when the button gives way to a match, and back to the button otherwise.
- **Coverage:** Ofertas shows "Com preço de mercado: X% das ofertas com 30%+ OFF" under the counts: the share of fresh Novos with 30% or more off that have a valid high-confidence check, floored, with "menos de 1%" for a tiny share.
- **Conta**, under **Comparação de preços**, has one block per site:
  - the state: "Rodando: 1 página a cada 10 s", "Em espera: motivo", "Bloqueado até dd/mm hh:mm (motivo)", "Aguardando a próxima passagem (dd/mm hh:mm)", "Limite do dia atingido", "Aguardando o Mercado Livre terminar", "Fila vazia" or "Parado";
  - "Páginas hoje: N" (Amazon's against its 1,000) and "Ofertas no catálogo: N";
  - Kabum's "Departamento N de M (slug), página P" during a pass, and Amazon's "Buscas: S feitas, D na fila" and "Mais vendidos: lidos há X";
  - "Última página há X".

  Below them come the coverage line, the last check, the 24 h counts and the number of inflated items. The retailers' terms likely disallow automated access; the pace stays low and the use personal.
- **Só verificados** (`verificados=1`) shows only items confirmed as real deals: a valid high-confidence check with a positive real saving. It is an alert key that narrows, and hidden items stay hidden unless **Mostrar ocultos** is on too.
- **Holding requests:** Conta has a **Requisições** panel with two toggles: **Pausar requisições** holds everything that reaches ML, Kabum or Amazon, and **Pausar comparação de preços** holds only the two crawlers (each becomes **Retomar ...**, and the panel shows the current state). While the company VPN is connected everything is held by itself, and the panel says "Em espera: VPN da empresa conectada (nome). Tudo continua ao desconectar."; if the VPN cannot be checked it says "Em espera: não foi possível verificar a VPN". The header chip adds "Em espera: VPN", "Em espera: VPN não verificada" (while the VPN cannot be checked everything waits and retries), "Comparação pausada" or "Pausado". Any of the three holds stops both crawlers: each one waits, keeps its place, and its block reads "Em espera: motivo" instead of its pace. **Rodar agora**, a Busca run, login and verification answer with the hold's text while it lasts. **Comparar agora** still answers, because it sends no request; its Amazon search waits for the hold to lift.
- **Limits of the hold:** the VPN is checked with `forticlient vpn status` and the answer is cached (5 s when clear, 30 s when held or unverifiable). A request already in flight finishes (a crawler checks the hold before each page, so at most one page per site), and a VPN connected inside the cache window can let a few requests through before the hold starts. A cycle stopped by a hold ends `partial` with the reason "VPN conectada" or "pausado manualmente", is not counted as a worked run, and runs again once the hold lifts. If the VPN output has no recognisable `Status:` line (a FortiClient update, say), everything is held as "VPN não verificada" and the problem is logged once. Local matching sends no request, so alert candidates are still matched before each digest and the digests still go out during a hold. `ml:capture` ignores the hold, so do not run it while the VPN is connected; `scripts/market-capture.ts` refuses to run while it is connected.
- **Links:** every card has "Comparar: Buscapé - Google Shopping - Amazon - Magalu", plain search links that open in your browser.
- **Fixtures:** `npx tsx --env-file=.env scripts/market-capture.ts --site kabum|amazon --url "<url>" --out <file>` saves one Kabum or Amazon page so the parser tests can be refreshed. Kabum is fetched over plain HTTP and Amazon through the Amazon profile; it makes no ML requests. It refuses while the VPN is connected and keeps a request count in `/tmp/market-capture-count.json`, refusing past 10 requests per site. Stop at the first wall.

## Alerts and notifications

- **Alertar** on Ofertas saves the current view under a name. **Alerta ativo** shows when the view matches an alert that already exists.
- After each finished cycle or Busca run, each alert sends one `notify-send` digest of offers that are new or at least 1% and R$ 1 cheaper than its last hit, from the Novos and Salvos tabs (saving an item never silences it). A digest lists one offer per catalog product (the cheapest, by `product_id`, else the item id), and samples follow ML discount order because the sort is not part of an alert. Every matching item is still recorded as a hit, but a product is not announced again through a sibling item unless it is at least 1% and R$ 1 below the product's lowest earlier hit. A digest can include Salvos items, which **Abrir** (the Novos view, offers only) does not list.
- When a run's status changes to `session_expired`, `blocked` or `failed`, one notification says so. **Abrir** opens Conta.
- Notifications need a Linux desktop session reachable from the server process, plus `notify-send` and `xdg-open`. A failed notification is logged and not retried, and its hit is already recorded, so it is never repeated.

## Configuration

Read from `.env` and validated by `src/env.ts`:

| Key | Default | Meaning |
|-|-|-|
| `DATABASE_URL` | none (required) | PostgreSQL connection string for the `promocps` database |
| `PORT` | 8510 | Port on 127.0.0.1. 8500 is refused |
| `ML_PROFILE_DIR` | none (required) | Absolute path of the Chrome profile that holds the app's ML session |
| `AUTO_RUN` | `on` | `off` turns the scheduler off; **Rodar agora** still works |
| `RUN_EVERY_HOURS` | 3 | Hours between automatic cycles, at least 1 |
| `PAGE_DELAY_MS` | 1500 | Pause between page loads, in milliseconds |
| `ACTIVATE_PER_RUN` | 20 | Coupons activated per cycle; 0 turns activation off |
| `DISCOVERY_PAGES_PER_RUN` | 300 | Page budget per cycle for reading coupon listings; the Busca pages come out of it |

Fixed values live in `src/lib/constants.ts`, not in `.env`. The ones that matter most: `SEARCH_PAGES` (2 pages per search Busca), `HISTORY_DAYS` (30), `HISTORY_MIN_DAYS` (7), `MIN_DROP_RATIO` (0.01), `ACTIVATION_RETRY_HOURS` (24) and `STALE_AFTER_HOURS` (72).

## Capturing real ML pages

```bash
npm run ml:capture -- "<url do Mercado Livre>" [nome]
```

It loads the URL through the same browser path, saves the page state and HTML to `src/ingestion/ml/__fixtures__/captured/` (gitignored), and prints what the readers extract. Use it to refresh fixtures when ML changes its pages.

`--activate <campaign_id|strongest>` also clicks **Aplicar** on a real coupon. That changes the account, so use it only on purpose. Every capture loads ML pages, which counts as traffic on the account.

## Persistence

All data lives in PostgreSQL: coupons, items, price history, Buscas, runs, alerts and alert hits, price checks, and the market catalog (offers, Amazon searches and each crawler's state). The ML session lives only in `ML_PROFILE_DIR`; nothing from it is logged or stored in the database. The Amazon crawler's cookies live only in `amazon-profile`. Writes happen per page and are idempotent, so an interrupted run is simply run again.

## Known limitations

- **The cheaper-listing rule needs identical titles.** `product_id` also groups packs and different models, so a sibling with another title is no signal at all: it neither hides nor shows the line.
- **Price matching is by title, against Kabum and Amazon only.** Generic items have no equivalent there, a catalog product is checked once for all its sellers, and a brand sub-line that differs by one word can still be matched wrongly. One offer is enough to flag, so such a wrong match can hide a real deal; **Mostrar ocultos** shows it.
- **Amazon searches slowly.** At most 1,000 pages a day, minus the best sellers, and only while ML is idle, so a new item can wait days for its search. Until then it is matched against Kabum and the Amazon offers already in the catalog.
- **ML walls some accounts** on listing pages (seen on young accounts). The run stops as `blocked`. Press **Resolver verificação** on Conta and solve the captcha by hand; the app never clicks or types there.
- **Discovery reads page 1 of each coupon listing.** Items deeper in a listing appear only when a Busca finds them.
- **A "com Cupom" price says that some coupon is applied, not which one.** A coupon chip records where the item was seen, not which coupon ML applied.
- **A coupon hint on a card never makes an estimate**, because the coupon's minimum and limit are unknown. Such a card shows the hint as text.
- **Coupon stacking is not modelled.** Two coupons on one item are not added up.
- **Estimated prices may be wrong.** An estimate applies the linked coupon's percent or value; ML may not apply it to that item.
- **Activation limits are unknown.** The first cycle activated 19 coupons and failed 1 with no wall; how far beyond that ML allows is unknown, which is why the default is 20 per cycle.
- **The empty-listing marker is unknown,** so an empty listing counts as a failed read.
- **Prices of R$ 1.000 and up lose their centavos** in the displayed price. The 1% minimum for a real drop makes that irrelevant.
- **The session lifetime is unknown.** Expiry is detected and reported, not prevented.
- **No login screen.** Anyone who can reach 127.0.0.1 on the port can use the app. The routes that act on ML or change Buscas and alerts accept only requests whose `Origin` is local, so a page open in another browser cannot trigger them.
