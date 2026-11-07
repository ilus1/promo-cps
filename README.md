# Promo CPS

A single-user price watcher for Brazilian stores, built around a [Mercado Livre](https://www.mercadolivre.com.br) (ML) account. You add the few products you want, by name or by link. The app finds the same product at Mercado Livre, Amazon, Kabum and Americanas, plus the occasional other merchant listed on Buscapé, checks its price at each store every 3 hours, and sends a **desktop notification** when the best price reaches your target, hits a new 30-day low or drops by the percent you chose. It also harvests every coupon on the ML account and activates the strong ones, because coupons lower the ML price of what you watch. It runs locally: a Next.js app bound to 127.0.0.1, a PostgreSQL database, and a headed Chrome on a virtual display for each browser run. No deployment platform is required.

Use a **secondary ML account**. The app reads and activates coupons at volume on whatever account its browser profile holds, so do not point it at your everyday account. Nothing is bought: the app never adds to a cart or checks out.

A cycle runs when you press **Rodar agora** on Conta, and then automatically every `RUN_EVERY_HOURS`. It reads ML one page at a time, with a pause between pages, in one browser session, and refreshes the ML price of each watched product. The other stores are checked outside the cycle, each at its own pace.

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

`/api/health` also carries `watch`, the state and block end of each store (`retailer`, `state`, `blockedUntil`), or `null` when it can't be read; neither a blocked store nor a `null` ever notifies. A cleared problem is forgotten and no "resolved" notification is sent. The state lives in `${XDG_STATE_HOME:-~/.local/state}/promo-cps/watchdog.json`. The watchdog is not tied to the graphical session, so after you log out it finds the server down, but `notify-send` has no desktop to show it on. That failure is logged and not recorded, so the problem stays unnotified. Lingering is already on for this user, so the timer also runs without a login. `PROMO_URL` in `promo-cps-watchdog.service` must follow `PORT`.

## Pages

All labels are in Portuguese.

- **Produtos** (`/`): the watched products, newest first. Each card shows the best final price now and its store ("Menor preço: Amazon", "Menor preço: Want Import (via Buscapé)", with ", com cupom" when the ML price needs the listing's coupon), how far it is from the 30-day low ("No menor preço dos últimos 30 dias", or "R$ X acima do menor preço em 30 dias (R$ Y)"), the target ("Preço alvo: R$ X (faltam R$ Y)" or "Preço alvo de R$ X atingido"), "Verificado há X", the number of listings and **Ver detalhes**. A product with no price yet says "Nenhum anúncio encontrado ainda" or "Sem preço disponível agora". Once a search ran in every store outside Mercado Livre (which searches in the next cycle) and found nothing, it says "Nenhuma loja encontrou este produto na última busca." with what to try (add it again with a fuller name, model and colour, or with the barcode, or use **Buscar agora** later) and "Buscado há X"; its Lojas section then reads "Nenhum anúncio acompanhado.". A product still named by its link shows only "Sem preço disponível agora" next to its heading's note. A product added by link reads "Produto da Kabum" (or of its store) and "Buscando o nome do produto...", with the link under it, until the first search reads its title (for an ML link, the next cycle). When the link gives no name (its page is gone, or the ML item no longer exists), it reads "Não foi possível ler o nome do produto pelo link. Adicione-o de novo pelo nome." instead, and the product is only searched by its barcode, if it has one. "Verificado há X" counts only checks that worked; when every check failed it reads "Última tentativa há X". **Adicionar produto** takes "Nome ou link do produto" (required), "Código de barras (EAN)" and "Preço alvo (R$)" (both optional). The barcode's check digit and the price are checked before sending, an error shows under its field, and focus moves to the first wrong field. With no products the page explains what to add.
- **Product page** (`/produtos/<id>`): the barcode and where it came from ("digitado", "do link" or "da Americanas"), the best price with the same notes as the card, and:
  - **Buscar agora**, which searches every store for the product again and makes its listings outside ML due at once (it answers with the hold's text during a hold, and with "Verificações automáticas desligadas (AUTO_RUN=off)" when the store loops are off), and **Parar de monitorar**, which asks first, then takes the product off the list, stops its alerts and returns to Produtos with "Produto retirado da lista." (the product's page then answers "Página não encontrada");
  - **Lojas**, one row per store (one per merchant for Buscapé), best first: the price, "De" (the list price), the final price (for ML, the price with the listing's coupon, "R$ X com cupom"), "Encontrado por" ("código de barras", "automático" or "link"), "Verificado há X" (or "Última tentativa há X" when the last check failed, with the error and "O preço mostrado é de uma verificação anterior."), "Sem estoque", **Ver na loja** and **Remover este anúncio** (asks first);
  - **Alertas**: "Preço alvo (R$)" (empty clears it) and "Queda mínima (%)", from 1 to 90, default 10.
- **Cupons** (`/cupons`): every harvested coupon with its status (Ativo, Inativo, Encerrado; the header reads "N cupons, M válidos" unless a status filter is set), escopo, "desconto na compra mínima", "economia máxima" (or "sem limite"), compra mínima, limite, validade, the activation error when activating failed, and "Ver no ML". Filters and sorts (menor compra mínima, maior limite, and others) are in the URL.
- **Conta** (`/conta`): the login state, **Entrar no Mercado Livre**, **Requisições** (the holds), the **Ciclo** panel with **Rodar agora**, **Execução automática** (next run or the reason for a pause), **Monitoramento** (see below), **Verificação do Mercado Livre** (**Resolver verificação**), and **Últimas execuções**.

## How a cycle works

1. **Preflight.** The app opens the coupon list. A redirect to login ends the run as `session_expired`. A verification page or captcha wall ends it as `blocked`. Neither is retried in a loop.
2. **Harvest.** Every page of the coupon list is read (30 coupons per page), and each coupon is stored with its terms from the list. A coupon missing from two consecutive complete harvests is marked ended. A partial harvest ends nothing, and a harvest with any skipped entry is not complete. One cycle never ends more than 30 coupons or 5% of the live ones, whichever is larger. A larger removal is refused and recorded as `endingRefused`; it ends only when the next complete harvest confirms it with a similar count.
3. **Activation.** Up to `ACTIVATE_PER_RUN` inactive coupons that are valid now and were not tried in the last 24 hours are activated, largest maximum saving first (coupons that save less than R$ 5 last), by clicking **Aplicar** on the coupon's page. Two clicks in a row with no response stop the run as `blocked`.
4. **Watched products on ML.** Each active product gets one ML search page per cycle, read with the same card readers. A product added by an ML link reads that listing's page instead; when that read fails in 3 cycles in a row in which another ML link page was read fine (a wall stops the run instead; a good search page or coupon harvest does not count, since only another item page proves the reader still works), the listing shows "O anúncio do link não existe mais no Mercado Livre. Remova-o para buscar outro." and is no longer read (**Buscar agora** clears that and tries it again). Removing it lets the next cycle search for another listing. A lone dead ML link, with no other ML link product to compare against, is never given up: it shows its load error, stays out of the best price, and costs one read per cycle. A product already matched on ML is searched the way it was found (by barcode for a barcode match, else by its name), and its listing is quoted from that page; when the listing is not on it, the listing shows "O anúncio não apareceu na busca do Mercado Livre". A product not matched yet is searched by its barcode when it has one; if that finds no match, the next cycle searches by its name (the app keeps this in memory, so a restart tries the barcode again). A listing you removed is never picked again, and the next-best card wins. The final price is the card price minus the coupon the card shows, and the alerts are checked right after. Three unreadable search pages in a row stop the step, and after three failed link reads in a row the remaining links wait until a search page reads fine, or the next cycle, while the searches go on. Products whose ML listing was checked longest ago go first.
5. **Record.** The run is saved with its status (`ok`, `partial`, `failed`, `session_expired` or `blocked`), pages and counts.
6. **Notifications.** Session and status notifications are sent after the run is saved.

The run stops at once on a login or captcha page, and on HTTP 403 or 429. A page that fails is retried once, then skipped, which makes the run `partial`. When several pages in a row fail to load (timeouts, network errors, missing page state), the run ends `failed` and holds automatic runs like `blocked`, so an outage is not retried in a loop.

**Reader health.** After each cycle, the counts are checked for signs that ML changed its pages, such as coupons read under 90% of ML's total, any skipped entry, unparsed entries over 5% of coupons seen, or more than 5% of the ML cards dropped. Once a cycle read at least 10 ML search pages, it also warns when more than 10% of them failed or when every one came back empty; a search with no results is normal otherwise (a product ML does not sell, or a barcode ML does not know). The warnings are stored in the run (`health`, a bitmask), shown as "O leitor do Mercado Livre pode ter mudado: ..." on Conta, and sent as a desktop notification when a new warning appears (an improvement does not notify) and as a reminder about once a day while any warning lasts.

**Pruning.** After each finished cycle, items not observed for 90 days, ended or expired coupons older than 60 days with no item links, and runs older than 180 days (never the latest of each kind) are deleted, items in batches of 5000 (at most 100,000 per cycle); the counts go to the server log.

**Jitter.** Each automatic cycle slot moves by an offset of up to 15 minutes either way, derived from the slot's own time (so "Próxima execução" shows the time the scheduler uses, also after a restart) and never earlier than the previous run's finish. There are no quiet hours.

**Pauses.** A refused login or an expired session pauses automatic runs until a later login or a run that worked. Until the first manual cycle finishes `ok` or `partial`, the scheduler stays paused.

## Watched products

A watched product has a name, the text it is searched by, an optional barcode (EAN/GTIN), an optional target price and a minimum drop (10% by default). It gets at most one listing per store, and the app tracks only those listings.

- **Stores:**
  - **Mercado Livre:** read in the cycle with the app's ML browser, as a search page (see step 4 above). The final price takes off the coupon the card shows.
  - **Amazon:** search (`/s?k=<barcode or name>`) and product page (`/dp/<asin>`) in system Chrome, on its own virtual display, with its own profile, `amazon-profile`, in the same folder as the ML profile (`$(dirname "$ML_PROFILE_DIR")/amazon-profile`). The ML profile and session are never used.
  - **Kabum:** search in Chrome, with the Amazon browser and profile (Kabum's search page only renders there), product page over plain HTTP. Kabum shows no barcode, so its listing is always found by name or by link.
  - **Americanas:** its public VTEX catalog API over plain HTTP, by barcode or by text, and by product id to refresh. It carries the barcode, marketplace sellers included.
  - **Buscapé:** search and product page over plain HTTP. The server-rendered product page carries only a few of the product's offers (6 of 49 in the probe), mostly from stores the app already reads directly, sometimes with a marketplace seller such as Want Import. A Buscapé product groups every colour of an item, so an offer counts only when its own title matches the product with high confidence and no conflicting colour. Merchants read directly (KaBuM!, Amazon, Mercado Livre, Americanas) are dropped, and each remaining merchant becomes its own listing, shown as "Want Import (via Buscapé)".
  - **Magalu and Casas Bahia are not covered for now.** Both wall plain HTTP and Chrome, and Buscapé's page does not reliably list them. Carrefour, Fast Shop and the other VTEX stores are out.
- **Adding:** a name, or a link from ML, Amazon, Kabum, Americanas or Buscapé, plus an optional barcode and target price. A link gives the first listing (found by `link`) and the product's title; an Americanas link also gives the barcode. When no barcode is known, the app searches the name at Americanas and adopts a barcode only when all its high-confidence matches carry the same one.
- **Matching, barcode first:**
  - a listing whose barcode equals the product's, or the top result of a search by the barcode when its title agrees with the product, is found by **código de barras**;
  - otherwise a title match needs high confidence from the local matcher (model, size, pack and tier words must agree, accessories are rejected) and no conflicting colour; it is found **automático**, with no confirmation step;
  - among several candidates the cheapest one in stock wins.
- **A wrong listing:** each row says how it was found, and **Remover este anúncio** drops it. A removed listing is never tracked or found again; the next search of that store skips it and takes the next-best match, if there is one.
- **When:**
  - every store is searched for a product when it is added, on **Buscar agora**, after a change of its name or barcode, and again every 7 days, so new listings appear. With `AUTO_RUN=off` the store loops do not run, so a new product is saved without a search outside ML and the form says so; a manual **Rodar agora** cycle still searches ML for every watched product;
  - every listing is refreshed every 3 h (ML in each cycle), with one request per listing, and one per Buscapé product for all its merchants;
  - a new price starts a new segment of the listing's price history, which gives the 30-day low.
- **Pace and backoff,** per site:
  - plain HTTP (Americanas, Buscapé, Kabum product pages): 1 request every 10 s, plus up to 3 s of jitter;
  - Chrome (Amazon, Kabum search): 1 page every 30 s, plus up to 10 s, and never while an ML job (a cycle, login or verification) is queued or running;
  - a wall (HTTP 403, 429 or 503, or Amazon's captcha), or 3 unreadable pages in a row, stops that site for 15 min, then 1 h, then 4 h, then 24 h, one step up for each further wall. A page with results resets it; a missing (404) or empty page counts as neither.
  - About 30 products, 5 sources and 8 refreshes a day make roughly 240 requests a day per site. The retailers' terms likely disallow automated access; the pace stays low and the use personal.
- **Conta > Monitoramento** shows the number of watched products and the last alert, then one block per store: its state ("Verificando agora", "Em espera: motivo", "Bloqueado até dd/mm hh:mm (motivo)", "Aguardando a próxima verificação", "Aguardando o Mercado Livre terminar", "Aguardando o próximo ciclo do Mercado Livre" or "Parado: verificações automáticas desligadas (AUTO_RUN=off)"), "Anúncios: N", "Requisições hoje: N" (not for ML, whose pages count in the cycle), "Última requisição há X", "Próxima verificação: em X" (for ML, the next cycle) and the last error. "Parado" means the store loops are not running. The request counts and blocks live in memory, so they start over after a restart.
- **Holding requests:** Conta's **Requisições** panel has two toggles. **Pausar requisições** holds everything that reaches ML or a store. **Pausar monitoramento** holds only the price checks of the watched products, ML's included, while the cycle's coupon harvest and activation go on. Each becomes **Retomar ...**, and the panel shows the current state. While the company VPN is connected everything is held by itself, and the panel says "Em espera: VPN da empresa conectada (nome). Tudo continua ao desconectar."; if the VPN cannot be checked it says "Em espera: não foi possível verificar a VPN". The header chip adds "Em espera: VPN", "Em espera: VPN não verificada" (while the VPN cannot be checked everything waits and retries), "Monitoramento pausado" or "Pausado". A held store waits and keeps its due listings, and its Monitoramento block reads "Em espera: motivo". **Rodar agora**, login and verification answer with the hold's text while it lasts.
- **Limits of the hold:** the VPN is checked with `forticlient vpn status` and the answer is cached (5 s when clear, 30 s when held or unverifiable). A request already in flight finishes (each site checks the hold before every request, so at most one request per site), and a VPN connected inside the cache window can let a few requests through before the hold starts. A cycle stopped by a hold ends `partial` with the reason "VPN conectada" or "pausado manualmente", is not counted as a worked run, and runs again once the hold lifts. If the VPN output has no recognisable `Status:` line (a FortiClient update, say), everything is held as "VPN não verificada" and the problem is logged once. `ml:capture` ignores the hold, so do not run it while the VPN is connected; `scripts/market-capture.ts` refuses to run while it is connected.
- **Fixtures:** `npx tsx --env-file=.env scripts/market-capture.ts --site kabum|amazon --url "<url>" --out <file>` saves one Kabum or Amazon page. Kabum is fetched over plain HTTP and Amazon through the Amazon profile; it makes no ML requests. It refuses while the VPN is connected and keeps a request count in `/tmp/market-capture-count.json`, refusing past 10 requests per site. Stop at the first wall.

## Alerts and notifications

- After each refresh, the app takes the product's best final price across its stores (in stock, with a successful last check) and sends one `notify-send` notification for each alert that fires:
  - **preço alvo:** the price is at or below the target;
  - **novo menor preço em 30 dias:** the price is below every price of the last 30 days, once the product has at least a day of history;
  - **queda:** the price is at least the product's "queda mínima" below the previous best price.
  - A store's first price is a discovery, not a drop: **queda** compares the previous best only with the cheapest store that already had a price before, so finding a product's stores one after another, each cheaper than the last, or adding a cheaper store later, never fires it. A store back in stock had a price before, so it counts, and so does a store that was never the cheapest. The drop notification names that store and its price. A newly found store can still fire **preço alvo**, and **novo menor preço** once the product has a day of history.
- The notification reads "Preço baixou: <produto>", then the price and its store ("R$ X na Amazon", "R$ X no Mercado Livre", "R$ X na Want Import (via Buscapé)") and the reason ("Atingiu o preço alvo de R$ Y", "Menor preço dos últimos 30 dias" or "Caiu N% (antes R$ Z)"). **Abrir** opens the product's page.
- Each alert is logged in `watch_alerts` first and notified only when it is newly logged. The same kind fires again for a product only below every price it already announced for that kind.
- When a run's status changes to `session_expired`, `blocked` or `failed`, one notification says so. **Abrir** opens Conta.
- Notifications need a Linux desktop session reachable from the server process, plus `notify-send` and `xdg-open`. A failed notification is logged and not retried.

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

Fixed values live in `src/lib/constants.ts`, not in `.env`. The ones that matter most: `WATCH_HTTP_INTERVAL_MS` (10 s) and `WATCH_CHROME_INTERVAL_MS` (30 s), with their jitter, `WATCH_REFRESH_HOURS` (3), `WATCH_RESOLVE_DAYS` (7), `WATCH_LOW_WINDOW_DAYS` (30) and `ACTIVATION_RETRY_HOURS` (24). The input limits (a 200-character name, a drop from 1% to 90%) are in `src/lib/watch/input-rules.ts`.

## Capturing real ML pages

```bash
npm run ml:capture -- "<url do Mercado Livre>" [nome]
```

It loads the URL through the same browser path, saves the page state and HTML to `src/ingestion/ml/__fixtures__/captured/` (gitignored), and prints what the readers extract. Use it to refresh fixtures when ML changes its pages.

`--activate <campaign_id|strongest>` also clicks **Aplicar** on a real coupon. That changes the account, so use it only on purpose. Every capture loads ML pages, which counts as traffic on the account.

## Persistence

All data lives in PostgreSQL: coupons, items and their price history, runs, the watched products, their listings and price segments, and the alerts sent. The tables of the old Ofertas, Buscas, Alertas and market catalog (`searches`, `alerts`, `alert_hits`, `price_checks`, `market_offers`, `market_searches`) stay until a later migration drops them. The ML session lives only in `ML_PROFILE_DIR`; nothing from it is logged or stored in the database. The Amazon and Kabum browser cookies live only in `amazon-profile`. Writes happen per page and are idempotent, so an interrupted run is simply run again.

## Known limitations

- **Automatic matches can be wrong.** A title match with no barcode can pick a near model, another colour or a bundle. Check the "Encontrado por" of each row and remove a wrong listing; it is never found again.
- **Kabum has no barcode,** so its listing is always automatic or by link.
- **ML search by barcode is unverified.** The ML step tries the barcode, checks the top card against the product's name, and falls back to the name.
- **Magalu and Casas Bahia are not covered.** Both wall the app, and Buscapé's server-rendered page shows only a few offers, mostly from stores already read directly, so a Buscapé listing is rare.
- **Amazon and the Kabum search wait for ML.** They use Chrome and never run while an ML job is queued or running.
- **The ML final price trusts the card's coupon hint.** A coupon the card doesn't show is not applied, and two coupons are not added up.
- **ML walls some accounts** on listing pages (seen on young accounts). The run stops as `blocked`. Press **Resolver verificação** on Conta and solve the captcha by hand; the app never clicks or types there.
- **Activation limits are unknown.** The first cycle activated 19 coupons and failed 1 with no wall; how far beyond that ML allows is unknown, which is why the default is 20 per cycle.
- **Prices of R$ 1.000 and up lose their centavos** in the displayed price.
- **The session lifetime is unknown.** Expiry is detected and reported, not prevented.
- **No login screen.** Anyone who can reach 127.0.0.1 on the port can use the app. The routes that act on ML or change the watched products accept only requests whose `Origin` is local, so a page open in another browser cannot trigger them.
