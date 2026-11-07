# promo-cps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or superpowers:executing-plans) to implement this plan task-by-task.

**Goal:** Build a local Next.js app that harvests every Mercado Livre coupon on Fernando's account, auto-activates inactive ones, reads coupon listings and his Buscas, ranks deals by ML's discount with a real-drop badge, and sends desktop alerts.

**Architecture:** One Next.js 16 App Router app bound to 127.0.0.1, one local Postgres 16 database. A serialized runner drives a headed system Google Chrome (Playwright `channel: 'chrome'`, no automation flags; ML refuses logins from the bundled Chromium) with a persistent profile on an Xvfb display the app starts per run; every ML page is read from its `window._n.ctx.r.appProps.pageProps` state. A scheduler started from `instrumentation.ts` runs the cycle (harvest, activation, Buscas, discovery, drops, alerts).

**Tech Stack:** Next.js 16.2 + React 19 + TypeScript, Tailwind 4, Drizzle ORM + postgres.js, Playwright 1.61 driving system Google Chrome (`channel: 'chrome'`, headed), Xvfb, zod, Vitest (pure logic only), tsx. Node 22.13.1 (`.nvmrc`).

**Design reference:** `docs/plans/2026-10-31-promo-cps-design.md` (read it before any task).

**Precedent:** `/home/fernando/projetos/olxmapper` (same stack). "Copy" below means copy the file from olxmapper, strip every code comment, and apply the listed changes.

---

## Progress checklist

Slice 1: skeleton, browser, capture
- [x] Task 0: Database role and `.env` (Fernando runs one command)
- [x] Task 1: Scaffold
- [x] Task 2: Env, constants, db client
- [x] Task 3: Schema and migration (0000 and 0001 applied)
- [x] Task 4: Pure helpers: amounts, basis, ML URLs, session location, local origin
- [x] Task 5: Xvfb, browser runner, serialized chain
- [x] Task 6: Login flow and Conta page (on 2026-11-02 the app profile was wiped and Fernando logged in the secondary account with the app's button; never copy a session in)
- [x] Task 7: `ml:capture` and fixtures
- [x] Task 6b: Verification window (captcha wall solved by hand)
- [x] Checkpoint 1 -- **MODIFIED:** confirmed by use. Fernando has used this slice live since 2026-11-02, and it was reviewed again in the improvement rounds (2026-11-03-improvement-rounds.md).

Slice 2: coupons
- [x] Task 8: Coupon parser and strength
- [x] Task 9: Coupon, run and item repositories
- [x] Task 10: Harvest and activation steps
- [x] Task 11: App shell and Cupons page
- [x] Checkpoint 2 -- **MODIFIED:** confirmed by use. Fernando has used this slice live since 2026-11-02, and it was reviewed again in the improvement rounds (2026-11-03-improvement-rounds.md).

Slice 3: deals
- [x] Task 12: Card reader
- [x] Task 13: Real-drop calculation
- [x] Task 14: Observations and discovery step (live check 2026-11-02 after the Task 6b hand solve: 5 listings, 192 items; landing and linking rules corrected from it)
- [x] Task 15: Cycle runner and Rodar agora (first live cycle 2026-11-02 19:31-19:51: partial, 444 page loads, no wall; harvest full 1,974/1,977, 69 new; 19 activated, 1 failed; 300 listings, 13,864 items, 12,354 coupon links over 292 coupons; 1 listing without results)
- [x] Task 16: Ofertas page (reviewed and approved 2026-11-02; `dealWhere` is the shared condition builder for Task 20)
- [x] Checkpoint 3 -- **MODIFIED:** confirmed by use. Fernando has used this slice live since 2026-11-02, and it was reviewed again in the improvement rounds (2026-11-03-improvement-rounds.md).

Slice 4: Buscas
- [x] Task 17: Buscas repository, step and API (reviewed and approved 2026-11-02; first live Busca run is Fernando's, from Task 18)
- [x] Task 18: Buscas page (reviewed and approved 2026-11-02; the first live Busca run is Fernando's)
- [x] Checkpoint 4 -- **MODIFIED:** confirmed by use. Fernando has used this slice live since 2026-11-02, and it was reviewed again in the improvement rounds (2026-11-03-improvement-rounds.md).

Slice 5: schedule and alerts
- [x] Task 19: Scheduler (reviewed 2026-11-02; paused until Fernando's first cycle finishes ok or partial) (pure parts done: due times, nextRunAt, schedulerPause)
- [x] Task 20: Alerts and notifications (built and reviewed 2026-11-02; Step 6 done 2026-11-03 under the systemd service: a test alert recorded 84 hits in the 10:19 UTC cycle and notify-send reported no failure; the test alert was then deleted)
- [x] Task 22: Cupons filters and sort (reviewed and approved 2026-11-02; default sort ranks coupons that save under R$ 5 last)
- [x] Task 23: Offers for a coupon set and Priorizar no proximo ciclo (reviewed and approved 2026-11-02; migration 0002 applied; also fixed a Task 19 pause gap and "Sessão ativa")
- [x] Task 24: Economia total com cupom on Ofertas (reviewed and approved 2026-11-03; migrations 0003 and 0004 applied)
- [x] Task 21: README and final verification (2026-11-03: README; tsc, lint, 1,635 tests and `npm run build` pass; the first cycle under the systemd service ended `ok`; whole-app reviews done in the improvement rounds)
- [x] Checkpoint 5 -- **MODIFIED:** confirmed by use. Fernando has used this slice live since 2026-11-02, and it was reviewed again in the improvement rounds (2026-11-03-improvement-rounds.md).

---

## Conventions used in every task

- Node: run `source ~/.nvm/nvm.sh && nvm use` once per shell (`.nvmrc` = 22.13.1).
- No code comments in any `.ts`/`.tsx`/`.mjs` file (the completion gate rejects them). Names carry the meaning.
- ASCII punctuation in code and docs (no em/en dashes, smart quotes or middle dots). pt-BR UI strings may use accented letters.
- A value that already has a name is imported, never re-typed. A literal used twice becomes one named constant.
- Money is integer centavos everywhere (`*Cents`).
- Next.js 16 differs from older versions: before writing a route, page or config, read the matching guide under `node_modules/next/dist/docs/` (route handler `params` is a Promise; `middleware` is now `proxy`).
- Tests: Vitest, pure logic only, `src/**/*.test.ts`. No database in tests.
- Git: never stage or commit. At each checkpoint, give Fernando the commands.
- Verification per task: `npx tsc --noEmit`, `npm run lint`, `npm test` must pass before the task is checked.
- Never set a page-wide `<meta name="referrer" content="no-referrer">`: same-origin POSTs would then send `Origin: null` and the local-origin guard would reject the app's own buttons. Use a per-`<img>` `referrerPolicy` if thumbnails ever need it.
- UI tasks: load the `ui-ux-pro-max` skill, mirror olxmapper's markup and Tailwind classes, then open the page in the running app with the Playwright MCP and take a snapshot.
- The dev server does not hot-reload `src/app/globals.css` (seen twice on 2026-11-02: the edited rule never reached the browser, even after a page reload). After a `globals.css` change, confirm the rule with `getComputedStyle` in the browser; if it is stale, restart `npm run dev` with `.next` removed, and only when no cycle or Busca is running (`/api/ml/status`).
- Agents never press a button that loads Mercado Livre ("Rodar agora" on Conta or on a Busca, "Entrar no Mercado Livre", "Resolver verificação") and never navigate the Playwright MCP browser to mercadolivre.com.br; Fernando presses them.

---

## Task 0: Database role and `.env`

**Files:** Create: `.env` (gitignored)

**Step 1:** Generate a password and write `.env`:

```bash
cd ~/projetos/promo-cps
PW=$(openssl rand -hex 24)
cat > .env <<EOF
DATABASE_URL=postgresql://promocps:${PW}@127.0.0.1:5432/promocps
PORT=8510
ML_PROFILE_DIR=${HOME}/.local/share/promo-cps/profile
AUTO_RUN=on
RUN_EVERY_HOURS=3
PAGE_DELAY_MS=1500
ACTIVATE_PER_RUN=20
DISCOVERY_PAGES_PER_RUN=300
EOF
```

**Step 2 (Fernando, needs sudo):** ask him to run, in the Claude prompt:

```
! cd ~/projetos/promo-cps && echo "CREATE ROLE promocps LOGIN PASSWORD :'pw'; CREATE DATABASE promocps OWNER promocps;" | sudo -u postgres psql -v pw="$(sed -n 's|^DATABASE_URL=postgresql://promocps:\([^@]*\)@.*|\1|p' .env)"
```

**Step 3:** Verify: `psql "$(sed -n 's/^DATABASE_URL=//p' .env)" -At -c 'select current_user'`. Expected: `promocps`.

Tasks 1 to 8 do not need the database; continue with them while waiting.

---

## Task 1: Scaffold

**Files:** Create: `package.json`, `.nvmrc`, `.gitignore`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `drizzle.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (placeholder), `.env.example`

**Step 1:** `package.json`:

```json
{
  "name": "promo-cps",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "sh -c 'set -a && . ./.env && next dev -H 127.0.0.1 -p \"$PORT\"'",
    "build": "next build",
    "start": "sh -c 'set -a && . ./.env && next start -H 127.0.0.1 -p \"$PORT\"'",
    "lint": "eslint .",
    "test": "vitest run",
    "ml:capture": "tsx --env-file=.env scripts/ml-capture.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "sh -c 'set -a && . ./.env && drizzle-kit migrate'"
  }
}
```

Then install the same versions olxmapper pins:

```bash
npm install next@16.2.9 react@19.2.4 react-dom@19.2.4 drizzle-orm@^0.45.2 postgres@^3.4.9 playwright@^1.61.1 zod@^4.4.3
npm install -D typescript@^5 @types/node@^20 @types/react@19.3.0 @types/react-dom@^19 drizzle-kit@^0.31.10 eslint@^9 eslint-config-next@16.2.9 tailwindcss@^4.3.1 @tailwindcss/postcss@^4.3.1 tsx@^4.22.4 vitest@^4.1.9 vite-tsconfig-paths@^6.1.1
```

(As built: `npx playwright install chromium` is not needed; the app launches system Google Chrome, see Task 5's browser note and the design's "Browser" bullet.)

**Step 2:** Copy from olxmapper unchanged (minus comments): `.nvmrc`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `drizzle.config.ts`, `src/app/globals.css`. Copy `vitest.config.ts` without the PGlite timeouts (keep `environment: 'node'` and the include globs).

**Step 3:** `.gitignore`: copy olxmapper's, drop the OLX and backups lines, add:

```
/src/ingestion/ml/__fixtures__/captured/
```

**Step 4:** `src/app/layout.tsx`: copy olxmapper's, set `lang="pt-BR"` and title `Promo CPS`. `src/app/page.tsx`: a placeholder `<main>Promo CPS</main>` (replaced in Task 16).

**Step 5:** `.env.example` with every key from Task 0 and placeholder values.

**Step 6:** Verify `npm run build` succeeds and `npm run dev` serves http://127.0.0.1:8510.

---

## Task 2: Env, constants, db client

**Files:** Create: `src/env.ts`, `src/env.test.ts`, `src/lib/constants.ts`, `src/db/client.ts`

**Step 1: failing test** `src/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const base = { DATABASE_URL: 'postgresql://x', ML_PROFILE_DIR: '/tmp/p' }

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv(base)).toMatchObject({
      PORT: 8510, AUTO_RUN: 'on', RUN_EVERY_HOURS: 3, PAGE_DELAY_MS: 1500,
      ACTIVATE_PER_RUN: 20, DISCOVERY_PAGES_PER_RUN: 300,
    })
  })
  it('allows activation off with 0', () => {
    expect(parseEnv({ ...base, ACTIVATE_PER_RUN: '0' }).ACTIVATE_PER_RUN).toBe(0)
  })
  it('rejects port 8500', () => {
    expect(() => parseEnv({ ...base, PORT: '8500' })).toThrow()
  })
  it('rejects a missing profile dir', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://x' })).toThrow()
  })
})
```

**Step 2:** `npm test` fails (no module).

**Step 3:** `src/env.ts`:

```ts
import { z } from 'zod'

const OLXMAPPER_PORT = 8500

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().refine((p) => p !== OLXMAPPER_PORT).default(8510),
  ML_PROFILE_DIR: z.string().min(1),
  AUTO_RUN: z.enum(['on', 'off']).default('on'),
  RUN_EVERY_HOURS: z.coerce.number().positive().default(3),
  PAGE_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
  ACTIVATE_PER_RUN: z.coerce.number().int().nonnegative().default(20),
  DISCOVERY_PAGES_PER_RUN: z.coerce.number().int().nonnegative().default(300),
})

export type Env = z.infer<typeof schema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source)
}

let cached: Env | null = null
export function env(): Env {
  if (!cached) cached = parseEnv(process.env)
  return cached
}
```

`src/lib/constants.ts`:

```ts
export const SEARCH_PAGES = 2
export const HISTORY_DAYS = 30
export const HISTORY_MIN_DAYS = 7
export const MIN_DROP_RATIO = 0.01
export const STALE_AFTER_HOURS = 72
export const PAGE_SIZE = 48
export const ACTIVATION_RETRY_HOURS = 24
export const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const ML_HOST = 'mercadolivre.com.br'
export const ML_COUPONS_URL = 'https://www.mercadolivre.com.br/cupons/filter?all=true'
export const ML_LOGIN_URL = 'https://www.mercadolivre.com.br/cupons'
```

`src/db/client.ts`: copy olxmapper's, but keep the postgres pool on `globalThis` (`globalThis.__promoSql ??= postgres(...)`) with `max: 4` and `idle_timeout: 20` seconds. Without it every dev hot reload opened a new pool that never closed; on 2026-11-02 about 90 leaked connections hit Postgres's limit (error 53300) and pages returned 500.

**Step 4:** `npm test` passes.

---

## Task 3: Schema and migration

**Files:** Create: `src/db/schema.ts`, `drizzle/*` (generated)

**Step 1:** `src/db/schema.ts` with the tables from the design's Data model section:

```ts
import {
  boolean, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uuid, index,
} from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const coupons = pgTable('coupons', {
  campaignId: text('campaign_id').primaryKey(),
  title: text('title').notNull(),
  kind: text('kind').notNull(),
  percentOff: numeric('percent_off', { mode: 'number' }),
  amountOffCents: integer('amount_off_cents'),
  minPaymentCents: integer('min_payment_cents'),
  capCents: integer('cap_cents'),
  scopeLabel: text('scope_label'),
  isStore: boolean('is_store').notNull(),
  status: text('status').notNull(),
  activationType: text('activation_type'),
  activateCode: text('activate_code'),
  listingUrl: text('listing_url'),
  startsAt: ts('starts_at'),
  expiresAt: ts('expires_at'),
  raw: jsonb('raw').notNull(),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  endedAt: ts('ended_at'),
  activationTriedAt: ts('activation_tried_at'),
  activationError: text('activation_error'),
  lastDiscoveredAt: ts('last_discovered_at'),
})

export const items = pgTable('items', {
  id: text('id').primaryKey(),
  productId: text('product_id'),
  title: text('title').notNull(),
  thumbnail: text('thumbnail'),
  url: text('url'),
  categoryId: text('category_id'),
  domainId: text('domain_id'),
  sellerLabel: text('seller_label'),
  priceCents: integer('price_cents').notNull(),
  basis: text('basis').notNull(),
  basisText: text('basis_text'),
  listPriceCents: integer('list_price_cents'),
  mlDiscountPct: integer('ml_discount_pct'),
  soldQuantity: integer('sold_quantity'),
  full: boolean('full'),
  freeShipping: boolean('free_shipping'),
  observedAt: ts('observed_at').notNull(),
  dropRatio: doublePrecision('drop_ratio'),
  status: text('status').notNull().default('NOT_SEEN'),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
}, (t) => [
  index('items_observed_idx').on(t.observedAt),
  index('items_discount_idx').on(t.mlDiscountPct),
])

export const priceSegments = pgTable('price_segments', {
  id: serial('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  priceCents: integer('price_cents').notNull(),
  basis: text('basis').notNull(),
  firstSeenAt: ts('first_seen_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
}, (t) => [index('segments_item_idx').on(t.itemId, t.lastSeenAt)])

export const itemSources = pgTable('item_sources', {
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.itemId, t.sourceType, t.sourceId] }),
  index('sources_source_idx').on(t.sourceType, t.sourceId),
])

export const searches = pgTable('searches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  kind: text('kind').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  runEveryHours: integer('run_every_hours').notNull().default(3),
  lastRunAt: ts('last_run_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  status: text('status'),
  pages: integer('pages').notNull().default(0),
  counts: jsonb('counts').notNull().default({}),
  error: text('error'),
}, (t) => [index('runs_kind_started_idx').on(t.kind, t.startedAt)])

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  query: text('query').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export const alertHits = pgTable('alert_hits', {
  alertId: uuid('alert_id').notNull().references(() => alerts.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  priceCents: integer('price_cents').notNull(),
  alertedAt: ts('alerted_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.alertId, t.itemId] })])

export type Coupon = typeof coupons.$inferSelect
export type Item = typeof items.$inferSelect
export type Search = typeof searches.$inferSelect
export type Run = typeof runs.$inferSelect
export type Alert = typeof alerts.$inferSelect
```

Status and kind values used across the code live as `as const` arrays next to their parsers (Tasks 4, 8, 9); the schema stores them as text.

Revised after the Tasks 1-3 review (as implemented): domain value lists live in `src/lib/domain.ts` (`ITEM_STATUSES`, `BASES`, `COUPON_KINDS`, `SOURCE_TYPES`, `BUSCA_KINDS`, `RUN_KINDS`, `RUN_STATUSES`) and the schema uses `text(name, { enum })` with them; `items.drop_ratio` is `doublePrecision` (a 0..1 ratio); `runs.counts` is typed `Record<string, number>`; the discount index matches the default sort (`ml_discount_pct DESC NULLS LAST, observed_at DESC NULLS LAST`) and `first_seen_at` is indexed.

**Step 2:** `npm run db:generate`, then (after Task 0) `npm run db:migrate`. Verify with `psql ... -c '\dt'`: 8 tables.

---

## Task 4: Pure helpers

**Files:** Create: `src/ingestion/ml/amounts.ts`, `src/ingestion/ml/basis.ts`, `src/lib/ml-url.ts`, `src/lib/ml-session.ts`, `src/lib/local-origin.ts`, one `*.test.ts` next to each.

**Step 1: failing tests**

`src/ingestion/ml/amounts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseAmountCents } from './amounts'

describe('parseAmountCents', () => {
  it.each([
    ['85', '0', 8500],
    ['4.999', '0', 499900],
    ['10.000', '0', 1000000],
    ['16', '99', 1699],
    ['16', '5', 1650],
    ['600', undefined, 60000],
  ])('%s,%s -> %s', (f, d, cents) => expect(parseAmountCents(f, d)).toBe(cents))
  it.each([[undefined, '0'], ['', '0'], ['1,5', '0'], ['abc', '0'], ['10', 'x']])(
    'rejects %s,%s', (f, d) => expect(parseAmountCents(f, d)).toBeNull(),
  )
})
```

`src/ingestion/ml/basis.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { basisFromComplement } from './basis'

describe('basisFromComplement', () => {
  it.each([
    [undefined, 'none'], ['', 'none'], ['  ', 'none'],
    ['com Cupom', 'coupon'], ['no Pix', 'pix'], ['no Pix com Cupom', 'pix_coupon'],
    ['em 10x', 'other'],
  ])('%s -> %s', (text, basis) => expect(basisFromComplement(text)).toBe(basis))
})
```

`src/lib/ml-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyMlUrl, isMlHost } from './ml-url'

describe('isMlHost', () => {
  it.each([
    ['mercadolivre.com.br', true], ['lista.mercadolivre.com.br', true],
    ['evilmercadolivre.com.br', false], ['mercadolivre.com.br.evil.com', false],
  ])('%s -> %s', (host, ok) => expect(isMlHost(host)).toBe(ok))
})

describe('classifyMlUrl', () => {
  it('search page', () => {
    expect(classifyMlUrl('https://lista.mercadolivre.com.br/ssd-nvme-1tb')).toEqual({
      kind: 'search', url: 'https://lista.mercadolivre.com.br/ssd-nvme-1tb',
    })
  })
  it('catalog product page', () => {
    expect(classifyMlUrl('https://www.mercadolivre.com.br/ssd-x/p/MLB54122980')).toMatchObject({ kind: 'product' })
  })
  it('item page', () => {
    expect(classifyMlUrl('https://produto.mercadolivre.com.br/MLB-1234567890-ssd-_JM')).toMatchObject({ kind: 'product' })
  })
  it.each([
    'http://lista.mercadolivre.com.br/x', 'https://evil.com/x', 'not a url',
    'https://www.mercadolivre.com.br/cupons',
  ])('rejects %s', (u) => expect(classifyMlUrl(u)).toHaveProperty('error'))
})
```

`src/lib/ml-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyLocation } from '@/lib/ml-session'

describe('classifyLocation', () => {
  it.each([
    ['https://www.mercadolivre.com.br/cupons/filter?all=true', 'ok'],
    ['https://www.mercadolivre.com.br/login/identification?x=1', 'session_expired'],
    ['https://www.mercadolivre.com.br/gz/account-verification?go=x', 'blocked'],
    ['https://www.mercadolivre.com.br/captcha/wall?go_url=x', 'blocked'],
  ])('%s -> %s', (url, out) => expect(classifyLocation(url)).toBe(out))
})
```

`src/lib/local-origin.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isLocalRequest } from './local-origin'

const req = (method: string, headers: Record<string, string>) =>
  new Request('http://127.0.0.1:8510/api/x', { method, headers })

describe('isLocalRequest', () => {
  it('allows GET from anywhere', () => {
    expect(isLocalRequest(req('GET', { origin: 'https://evil.com' }), 8510)).toBe(true)
  })
  it.each(['http://127.0.0.1:8510', 'http://localhost:8510'])('allows POST from %s', (origin) => {
    expect(isLocalRequest(req('POST', { origin }), 8510)).toBe(true)
  })
  it('rejects POST from another site', () => {
    expect(isLocalRequest(req('POST', { origin: 'https://evil.com' }), 8510)).toBe(false)
  })
  it('rejects POST from another local port', () => {
    expect(isLocalRequest(req('POST', { origin: 'http://localhost:3000' }), 8510)).toBe(false)
  })
  it('falls back to Host when Origin is absent', () => {
    expect(isLocalRequest(req('POST', { host: 'localhost:8510' }), 8510)).toBe(true)
    expect(isLocalRequest(req('POST', { host: 'evil.com' }), 8510)).toBe(false)
  })
})
```

**Step 2:** `npm test`: all fail (no modules).

**Step 3: implementations**

`src/ingestion/ml/amounts.ts`:

```ts
const DIGITS = /^\d+$/
const THOUSANDS_DOT = /\./g

export function parseAmountCents(fractional: string | undefined, decimal: string | undefined): number | null {
  if (!fractional) return null
  const whole = fractional.replace(THOUSANDS_DOT, '')
  const cents = (decimal ?? '0').padEnd(2, '0').slice(0, 2)
  if (!DIGITS.test(whole) || !DIGITS.test(cents)) return null
  return Number(whole) * 100 + Number(cents)
}
```

`src/ingestion/ml/basis.ts`:

```ts
import type { Basis } from '@/lib/domain'

const PIX = /\bpix\b/i
const COUPON = /\bcupom\b/i

export function basisFromComplement(text: string | undefined): Basis {
  const t = text?.trim()
  if (!t) return 'none'
  const pix = PIX.test(t)
  const coupon = COUPON.test(t)
  if (pix && coupon) return 'pix_coupon'
  if (pix) return 'pix'
  if (coupon) return 'coupon'
  return 'other'
}

export const COUPON_BASES: readonly Basis[] = ['coupon', 'pix_coupon']
```

`src/lib/ml-url.ts`:

```ts
import { ML_HOST } from './constants'
import type { BuscaKind } from './domain'

const SEARCH_HOST = `lista.${ML_HOST}`
const PRODUCT_HOST = `produto.${ML_HOST}`
const CATALOG_PATH = /\/p\/MLB\d+/
export const INVALID_ML_URL = 'Cole a URL de uma busca (lista.mercadolivre.com.br) ou de um produto do Mercado Livre.'

export function isMlHost(host: string): boolean {
  return host === ML_HOST || host.endsWith(`.${ML_HOST}`)
}

export function classifyMlUrl(input: string): { kind: BuscaKind; url: string } | { error: string } {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return { error: INVALID_ML_URL }
  }
  if (u.protocol !== 'https:' || !isMlHost(u.hostname)) return { error: INVALID_ML_URL }
  if (u.hostname === SEARCH_HOST) return { kind: 'search', url: u.toString() }
  if (u.hostname === PRODUCT_HOST || CATALOG_PATH.test(u.pathname)) return { kind: 'product', url: u.toString() }
  return { error: INVALID_ML_URL }
}
```

`src/lib/ml-session.ts`:

```ts
export const PAGE_OUTCOMES = ['ok', 'session_expired', 'blocked'] as const
export type PageOutcome = (typeof PAGE_OUTCOMES)[number]

const LOGIN_PATH = /^\/login\b/
const BLOCK_PATHS = [/^\/gz\/account-verification\b/, /^\/captcha\b/]

export function classifyLocation(url: string): PageOutcome {
  const path = new URL(url).pathname
  if (LOGIN_PATH.test(path)) return 'session_expired'
  if (BLOCK_PATHS.some((re) => re.test(path))) return 'blocked'
  return 'ok'
}
```

`src/lib/local-origin.ts`:

```ts
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const LOCAL_HOSTS = ['127.0.0.1', 'localhost']

export function isLocalRequest(req: Request, port: number): boolean {
  if (SAFE_METHODS.has(req.method)) return true
  const allowedHosts = LOCAL_HOSTS.map((h) => `${h}:${port}`)
  const origin = req.headers.get('origin')
  if (origin) return allowedHosts.some((h) => origin === `http://${h}`)
  const host = req.headers.get('host')
  return host !== null && allowedHosts.includes(host)
}
```

**Step 4:** `npm test` passes.

---

## Task 5: Xvfb, browser runner, serialized chain

**Files:** Create: `src/ingestion/xvfb.ts`, `src/ingestion/browser.ts`, `src/ingestion/run-chain.ts`, `src/ingestion/errors.ts`

**Step 1:** `src/ingestion/errors.ts`:

```ts
import type { RunStatus } from '@/lib/domain'
import type { PageOutcome } from '@/lib/ml-session'

export class RunStop extends Error {
  constructor(readonly status: Exclude<RunStatus, 'ok' | 'partial'>, message: string) {
    super(message)
  }
}

export function stopFor(outcome: Exclude<PageOutcome, 'ok'>, url: string): RunStop {
  return outcome === 'session_expired'
    ? new RunStop('session_expired', `Sessão do Mercado Livre expirada (${url})`)
    : new RunStop('blocked', `Mercado Livre bloqueou o acesso (${url})`)
}
```

**Step 2:** `src/ingestion/xvfb.ts`: start Xvfb with `-displayfd 3` and read the display number from fd 3:

```ts
import { spawn } from 'node:child_process'
import { RunStop } from './errors'

const XVFB_ARGS = ['-displayfd', '3', '-screen', '0', '1366x768x24', '-nolisten', 'tcp']
const START_TIMEOUT_MS = 10000

export interface VirtualDisplay { display: string; stop: () => void }

export function startXvfb(): Promise<VirtualDisplay> {
  return new Promise((resolve, reject) => {
    const child = spawn('Xvfb', XVFB_ARGS, { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
    const fail = (message: string) => {
      child.kill()
      reject(new RunStop('failed', message))
    }
    const timer = setTimeout(() => fail('Xvfb não iniciou a tempo'), START_TIMEOUT_MS)
    child.on('error', (e) => {
      clearTimeout(timer)
      fail(`Xvfb não pôde ser iniciado: ${e.message}`)
    })
    child.stdio[3]?.once('data', (chunk: Buffer) => {
      clearTimeout(timer)
      resolve({ display: `:${chunk.toString().trim()}`, stop: () => child.kill() })
    })
  })
}
```

**Step 3:** `src/ingestion/browser.ts`: one function that opens the profile headed, either on a fresh Xvfb (`hidden`) or on his real display (`visible`), and always cleans up:

```ts
import type { BrowserContext, Page } from 'playwright'
import { env } from '@/env'
import { RunStop } from './errors'
import { startXvfb } from './xvfb'

export const BROWSER_MODES = ['hidden', 'visible'] as const
export type BrowserMode = (typeof BROWSER_MODES)[number]

const PROFILE_IN_USE = /ProcessSingleton|already in use|existing browser session|SingletonLock/i
const FORCE_X11 = '--ozone-platform=x11'

export async function withMlBrowser<T>(mode: BrowserMode, fn: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
  const { chromium } = await import('playwright')
  const xvfb = mode === 'hidden' ? await startXvfb() : null
  const displayEnv = xvfb ? { DISPLAY: xvfb.display, WAYLAND_DISPLAY: '' } : {}
  let context: BrowserContext
  try {
    context = await chromium.launchPersistentContext(env().ML_PROFILE_DIR, {
      channel: 'chrome',
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
      headless: false,
      locale: 'pt-BR',
      viewport: { width: 1366, height: 768 },
      env: { ...process.env, ...displayEnv },
    })
  } catch (e) {
    xvfb?.stop()
    const message = e instanceof Error ? e.message : String(e)
    throw new RunStop('failed', PROFILE_IN_USE.test(message)
      ? 'O perfil do navegador já está em uso'
      : `Chromium não pôde ser iniciado: ${message}`)
  }
  try {
    const page = context.pages()[0] ?? await context.newPage()
    return await fn(page, context)
  } finally {
    await context.close().catch(() => undefined)
    xvfb?.stop()
  }
}
```

**Step 4:** `src/ingestion/run-chain.ts`: olxmapper's `serialized` from `src/ingestion/run.ts`, exported, with the global renamed `__promoRunChain`:

```ts
declare global {
  var __promoRunChain: Promise<unknown> | undefined
}

export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = (globalThis.__promoRunChain ?? Promise.resolve()).then(fn)
  globalThis.__promoRunChain = run.catch(() => undefined)
  return run
}
```

**Step 5:** `src/ingestion/ml/page-state.ts` (reader part used by every step; the card walker is added in Task 12):

```ts
import type { Page } from 'playwright'
import { env } from '@/env'
import { stopFor } from '../errors'
import { classifyLocation } from '@/lib/ml-session'

export type PageProps = Record<string, unknown>

const STATE_READY = 'Boolean(window._n && window._n.ctx && window._n.ctx.r && window._n.ctx.r.appProps)'
const NAV_TIMEOUT_MS = 45000

export async function loadPageProps(page: Page, url: string): Promise<{ finalUrl: string; pageProps: PageProps }> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
  const outcome = classifyLocation(page.url())
  if (outcome !== 'ok') throw stopFor(outcome, page.url())
  await page.waitForFunction(STATE_READY, undefined, { timeout: NAV_TIMEOUT_MS })
  const pageProps = await page.evaluate(() => {
    const w = window as unknown as { _n: { ctx: { r: { appProps: { pageProps: unknown } } } } }
    return JSON.parse(JSON.stringify(w._n.ctx.r.appProps.pageProps)) as Record<string, unknown>
  })
  await page.waitForTimeout(env().PAGE_DELAY_MS)
  return { finalUrl: page.url(), pageProps }
}
```

As built, `loadPageProps` also throws `RunStop('blocked')` at once, with no retry and no breaker, when the navigation response is HTTP 403 or 429 (`BLOCKED_STATUSES` in `page-state.ts`): ML answers those to traffic it is throttling, and a retry would only add to the score.

```ts

export async function loadWithRetry(page: Page, url: string) {
  try {
    return await loadPageProps(page, url)
  } catch (e) {
    if (e instanceof Error && e.name === 'RunStop') throw e
    await page.waitForTimeout(env().PAGE_DELAY_MS)
    return loadPageProps(page, url)
  }
}
```

Set `this.name = 'RunStop'` in the `RunStop` constructor so `loadWithRetry` can tell a stop from a transient error.

Changed 2026-11-02: the browser is system Google Chrome (`channel: 'chrome'`) with `ignoreDefaultArgs: ['--enable-automation']` and `--disable-blink-features=AutomationControlled` in both modes, because ML refused logins from Playwright's Chromium (see the design's What was verified). As implemented (verified 2026-11-01): hidden mode builds the child env from `process.env` with `WAYLAND_DISPLAY` deleted and `DISPLAY` set to the Xvfb display, and passes `args: [FORCE_X11]`. Without the flag Chromium 149 still picks Wayland (`XDG_SESSION_TYPE=wayland`, falling back to `wayland-0`) and the window would open on his screen. Visible mode passes `process.env` unchanged and no extra args. Playwright 1.61 reports a locked profile as "Opening in existing browser session...", hence the widened `PROFILE_IN_USE`.

**Step 6:** Smoke check from a throwaway script outside `src` (delete after): open `hidden`, load `ML_LOGIN_URL`, print the outcome. Before login, expect `session_expired`. Typecheck and lint pass.

---

## Task 6: Login flow and Conta page

**Files:** Create: `src/ingestion/login.ts`, `src/app/api/ml/login/route.ts`, `src/app/api/ml/status/route.ts`, `src/app/conta/page.tsx`, `src/components/LoginButton.tsx`, `src/lib/with-api.ts`, `src/lib/api.ts`

**Step 1:** `src/lib/with-api.ts`: copy olxmapper's and add the local-origin guard first:

```ts
if (!isLocalRequest(a[0] as Request, env().PORT)) {
  return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 })
}
```

(`a[0]` is the `Request` in every route handler signature.) Every non-GET route in this app is wrapped in `withApi`.

**Step 2:** `src/ingestion/login.ts`: holds login state on `globalThis` and runs the visible window through the serialized chain:

```ts
import { LOGIN_TIMEOUT_MS, ML_LOGIN_URL } from '@/lib/constants'
import { withMlBrowser } from './browser'
import { serialized } from './run-chain'
import { classifyLocation } from '@/lib/ml-session'

export const LOGIN_STATES = ['idle', 'waiting', 'logged_in', 'timed_out', 'failed'] as const
export type LoginState = (typeof LOGIN_STATES)[number]

declare global {
  var __promoLogin: { state: LoginState; error: string | null } | undefined
}

export function loginStatus() {
  return globalThis.__promoLogin ?? { state: 'idle' as LoginState, error: null }
}

export function startLogin(): void {
  if (loginStatus().state === 'waiting') return
  globalThis.__promoLogin = { state: 'waiting', error: null }
  void serialized(() => withMlBrowser('visible', async (page) => {
    await page.goto(ML_LOGIN_URL)
    const deadline = Date.now() + LOGIN_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (page.isClosed()) break
      if (classifyLocation(page.url()) === 'ok' && new URL(page.url()).pathname.startsWith('/cupons')) {
        globalThis.__promoLogin = { state: 'logged_in', error: null }
        return
      }
      await page.waitForTimeout(1000).catch(() => undefined)
    }
    globalThis.__promoLogin = { state: 'timed_out', error: null }
  })).catch((e) => {
    globalThis.__promoLogin = { state: 'failed', error: e instanceof Error ? e.message : String(e) }
  })
}
```

**Step 3:** Routes: `POST /api/ml/login` calls `startLogin()` and returns 202 with `loginStatus()`. `GET /api/ml/status` returns `loginStatus()` plus the latest `cycle` run (added in Task 9; until then only the login state).

**Step 4:** `/conta` page: shows the login state and a "Entrar no Mercado Livre" button (`LoginButton`, client component, posts `{ confirm: true }` then polls `/api/ml/status` every 2 s while `queued` or `waiting`). Text: "Uma janela do navegador vai abrir. Entre na sua conta do Mercado Livre e volte aqui." Mirror olxmapper button styles.

**Step 5:** Run `npm run dev`, open `/conta` with the Playwright MCP and snapshot it. No agent ever clicks "Entrar no Mercado Livre" or calls `/api/ml/login`: the Playwright MCP browser is visible on his desktop and shared by every agent, and a click there opens the login window. Fernando clicks it himself in his own browser at http://127.0.0.1:8510/conta, logs in, and the state turns `logged_in` and the window closes. Read the `[login]` path log afterwards to record where ML landed him (`/cupons` or `/`).

---

## Task 6b: Verification window (added 2026-11-02)

**Why:** on 2026-11-02 the secondary account's first listing page (`lista.mercadolivre.com.br/...?coupon_campaign_id=14633544`) went to `/captcha/wall/logged?go_url=...`, after a 66-page harvest and one activation click earlier that day; `/cupons` still loaded, and the same kind of listing had loaded at 13:28 on the personal account. A logged-in wall is a captcha a person can solve; solving it once in the app's own profile usually restores trust, and the scheduler will meet walls again. Fernando chose a hand-solve flow.

**Files:** Create: `src/ingestion/verify.ts`, `src/app/api/ml/verify/route.ts`, `src/components/VerifyButton.tsx`; Modify: `src/app/conta/page.tsx`, `src/lib/labels.ts`, `src/lib/domain.ts`, `src/app/api/ml/status/route.ts`.

`startVerify()` mirrors `startLogin` and resolves its target inside the job: an in-memory job (`VERIFY_STATES`: idle, queued, waiting, cleared, closed, timed_out, failed) inside `serialized`, `withMlBrowser('visible')`, one `goto` of the target (`waitUntil: 'commit'`, `VERIFY_GOTO_TIMEOUT_MS`; a goto error on an open page is logged and watching continues, so a slow captcha never closes the window) and never another navigation, clicks or typing. It polls `page.url()` and passively observes main-frame navigation statuses: off the wall on an ML page with no 403/429 = `cleared`, and the window closes after a short settle; the person closing the window while still walled = `closed`, but closing it after the wall cleared = `cleared`; `VERIFY_TIMEOUT_MS` = `timed_out`. The target is the next discovery target's `listingUrl` (`discoveryTargets(1, now)`), else `ML_COUPONS_URL`. `POST /api/ml/verify` takes `{ confirm: true }` and requires `sec-fetch-site: same-origin`, like login. Conta gets a "Verificação do Mercado Livre" card: one line on when to use it, the "Resolver verificação" button, and the state text. Agents never click it.

---

## Task 7: `ml:capture` and fixtures

> **Deferred (2026-11-01):** ML blocked the app's login (`no-feasible-authenticators`) after a night of probing. No ML traffic until Fernando says the cool-down is over. Done 2026-11-02: the fixtures are trimmed real captures (secondary account). Tasks that need no ML traffic continue meanwhile.

**Files:** Create: `scripts/ml-capture.ts`, `src/ingestion/ml/__fixtures__/` (trimmed copies committed later; raw captures in `captured/`, gitignored)

**Step 1:** `scripts/ml-capture.ts <url> [name]`: runs `withMlBrowser('hidden')`, `loadPageProps(url)`, writes `src/ingestion/ml/__fixtures__/captured/<name>.json`, and prints: final URL, top-level `pageProps` keys, polycard count (walk for objects with a `polycard` key), the first card's `metadata` and `components[].type`, and the first card image `src` from the DOM (`document.querySelector('.poly-card img')?.getAttribute('src')`) to confirm the thumbnail URL pattern.

Never run `ml:capture` while the app is running a cycle or the login window is open: a second Chromium on the same profile hands its URL to the running instance (an extra tab, visible if it is the login window) and then fails as "profile in use".

**Step 2:** Capture (Fernando already logged in through Task 6):

```bash
npm run ml:capture -- "https://www.mercadolivre.com.br/cupons/filter?all=true" coupons-page
npm run ml:capture -- "<an ACTIVE coupon listing_url from coupons-page>" coupon-listing
npm run ml:capture -- "<a /pagina/<store>/?coupon_campaign_id= link>" store-listing
npm run ml:capture -- "https://lista.mercadolivre.com.br/ssd-nvme-1tb" search
npm run ml:capture -- "<an organic card url from search>" product-page
```

**Step 3: activation capture.** Add `--activate <campaign_id>` to the script: on the coupons page, listen to `page.on('request')`/`page.on('response')` for `/cupons/api/activate`, click the matching "Aplicar" button (find the coupon card whose text contains its title; click only if exactly one), and save method, URL, request headers (drop `cookie`), response status and body to `captured/activation.json`. Run it once on the strongest inactive coupon. Decide in Task 10, from this capture, between replaying the request with `fetch` (if no CSRF header is required) and clicking the button.

**Step 4:** For each capture, write a trimmed fixture next to `captured/` (`coupons-page.json` with 3 coupons: one INACTIVE EU_QUERO, one ACTIVE store, one ACTIVE ML-wide; `listing.json` with 3 cards: one organic "com Cupom", one sponsored duplicate, one "no Pix"; `product-page.json` with the parts the product reader needs). Check every captured `decimal_amount` value: `parseAmountCents` treats a one-digit decimal such as "5" as 50 centavos and an empty string as unknown (null); if a capture contradicts either, fix `amounts.ts` and its test. Record in this plan, under Task 12, the confirmed paths for: thumbnail URL, sold quantity, shipping, seller, and how a product page exposes price and item id (and whether `/p/` pages rotate the item id, which decides the history key per the design).

**Checkpoint 1:** `npx tsc --noEmit && npm run lint && npm test` pass. Give Fernando:

```
git -C ~/projetos/promo-cps add -A && git -C ~/projetos/promo-cps commit -m "feat: skeleton, headed ML browser on Xvfb, login, capture"
```

---

## Task 8: Coupon parser and strength

**Files:** Create: `src/ingestion/ml/coupons.ts`, `src/ingestion/ml/coupons.test.ts`

**Step 1: failing tests** against `__fixtures__/coupons-page.json` plus inline cases:

```ts
import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/coupons-page.json'
import { compareStrength, equivalentPercent, parseCoupon, parseCouponPage, type ParsedCoupon } from './coupons'

const base: ParsedCoupon = {
  campaignId: '1', title: '10% OFF', kind: 'percent', percentOff: 10, amountOffCents: null,
  minPaymentCents: 8500, capCents: 5000, scopeLabel: 'Em produtos selecionados', isStore: false,
  status: 'INACTIVE', activationType: 'EU_QUERO', activateCode: 'c', listingUrl: null,
  startsAt: null, expiresAt: null,
}

describe('parseCouponPage', () => {
  it('reads coupons, page count and total', () => {
    const page = parseCouponPage(fixture)
    expect(page.coupons.length).toBe(3)
    expect(page.totalPages).toBeGreaterThan(0)
    expect(page.totalCoupons).toBeGreaterThan(0)
  })
})

describe('parseCoupon', () => {
  it('percent coupon with min and cap', () => {
    expect(parseCoupon({
      campaign_id: '13305789',
      title: { text: '10% OFF Maquininhas', accessibility: { title: { fractional_amount: '10', decimal_amount: '0' } } },
      initial_subtitle: { text: 'Em produtos selecionados' },
      amount: { accessibility: { min_amount: { fractional_amount: '85', decimal_amount: '0' }, cap_amount: { fractional_amount: '50', decimal_amount: '0' } } },
      status: { id: 'INACTIVE' }, activation_type: 'EU_QUERO', code: 'abc',
      action: { type: 'button', text: 'Aplicar' },
      future_coupon_info: { start_date: '2026-07-06T17:03Z', expiration_date: '2027-01-01T02:59Z' },
    })).toMatchObject({
      kind: 'percent', percentOff: 10, minPaymentCents: 8500, capCents: 5000, isStore: false,
      status: 'INACTIVE', listingUrl: null, expiresAt: new Date('2027-01-01T02:59Z'),
    })
  })
  it('fixed store coupon with listing link', () => {
    expect(parseCoupon({
      campaign_id: '14569078',
      title: { text: 'R$ 600 OFF em Informática', accessibility: { title: { fractional_amount: '600', decimal_amount: '0' } } },
      initial_subtitle: { text: 'Em produtos de Sonhosreborn' },
      status: { id: 'ACTIVE' }, activation_type: 'AUTOMATIC',
      action: { type: 'link', value: 'https://lista.mercadolivre.com.br/pagina/renascer/?coupon_campaign_id=14569078' },
    })).toMatchObject({ kind: 'fixed', amountOffCents: 60000, isStore: true, listingUrl: expect.stringContaining('/pagina/renascer/') })
  })
  it('unparsed title and foreign link', () => {
    expect(parseCoupon({
      campaign_id: '9', title: { text: 'Frete grátis' },
      action: { type: 'link', value: 'https://evil.com/x' },
    })).toMatchObject({ kind: 'unparsed', listingUrl: null })
  })
})

describe('strength', () => {
  it('fixed coupon equivalent percent, capped at 100', () => {
    expect(equivalentPercent({ ...base, kind: 'fixed', percentOff: null, amountOffCents: 60000, minPaymentCents: 499900 })).toBeCloseTo(12.0, 1)
    expect(equivalentPercent({ ...base, kind: 'fixed', percentOff: null, amountOffCents: 5000, minPaymentCents: 100 })).toBe(100)
  })
  it('unknown when unparsed or no minimum', () => {
    expect(equivalentPercent({ ...base, kind: 'unparsed' })).toBeNull()
    expect(equivalentPercent({ ...base, kind: 'fixed', amountOffCents: 100, minPaymentCents: 0 })).toBeNull()
  })
  it('ML coupons first, then by equivalent percent, unknown last', () => {
    const ml10 = { ...base, campaignId: 'a' }
    const ml30 = { ...base, campaignId: 'b', percentOff: 30 }
    const store50 = { ...base, campaignId: 'c', percentOff: 50, isStore: true }
    const mlUnknown = { ...base, campaignId: 'd', kind: 'unparsed' as const }
    const sorted = [store50, mlUnknown, ml10, ml30].sort(compareStrength).map((c) => c.campaignId)
    expect(sorted).toEqual(['b', 'a', 'd', 'c'])
  })
})
```

**Step 2:** `npm test` fails.

**Step 3:** `src/ingestion/ml/coupons.ts`:

```ts
import { isMlHost } from '@/lib/ml-url'
import type { CouponKind } from '@/lib/domain'
import { parseAmountCents } from './amounts'

export const COUPON_STATUS_ACTIVE = 'ACTIVE'
export const COUPON_STATUS_INACTIVE = 'INACTIVE'
export const ACTIVATION_EU_QUERO = 'EU_QUERO'
const STORE_SCOPE_PREFIX = 'Em produtos de '
const PERCENT_SIGN = '%'
const REAIS_SIGN = 'R$'
const MAX_EQUIVALENT_PERCENT = 100

type Amount = { fractional_amount?: string; decimal_amount?: string }
export interface RawCoupon {
  campaign_id: string
  title?: { text?: string; accessibility?: { title?: Amount } }
  initial_subtitle?: { text?: string }
  amount?: { accessibility?: { min_amount?: Amount; cap_amount?: Amount } }
  status?: { id?: string }
  activation_type?: string
  code?: string
  action?: { type?: string; text?: string; value?: string }
  future_coupon_info?: { start_date?: string; expiration_date?: string }
}

export interface ParsedCoupon {
  campaignId: string
  title: string
  kind: CouponKind
  percentOff: number | null
  amountOffCents: number | null
  minPaymentCents: number | null
  capCents: number | null
  scopeLabel: string | null
  isStore: boolean
  status: string
  activationType: string | null
  activateCode: string | null
  listingUrl: string | null
  startsAt: Date | null
  expiresAt: Date | null
}

function cents(a: Amount | undefined): number | null {
  return parseAmountCents(a?.fractional_amount, a?.decimal_amount)
}

function date(s: string | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function mlLink(action: RawCoupon['action']): string | null {
  if (action?.type !== 'link' || !action.value) return null
  try {
    const u = new URL(action.value)
    return u.protocol === 'https:' && isMlHost(u.hostname) ? u.toString() : null
  } catch {
    return null
  }
}

export function parseCoupon(raw: RawCoupon): ParsedCoupon {
  const title = raw.title?.text?.trim() ?? ''
  const headline = cents(raw.title?.accessibility?.title)
  const kind: CouponKind = headline === null ? 'unparsed'
    : title.includes(PERCENT_SIGN) ? 'percent'
      : title.includes(REAIS_SIGN) ? 'fixed' : 'unparsed'
  const scopeLabel = raw.initial_subtitle?.text?.trim() || null
  return {
    campaignId: raw.campaign_id,
    title,
    kind,
    percentOff: kind === 'percent' && headline !== null ? headline / 100 : null,
    amountOffCents: kind === 'fixed' ? headline : null,
    minPaymentCents: cents(raw.amount?.accessibility?.min_amount),
    capCents: cents(raw.amount?.accessibility?.cap_amount),
    scopeLabel,
    isStore: scopeLabel?.startsWith(STORE_SCOPE_PREFIX) ?? false,
    status: raw.status?.id ?? 'UNKNOWN',
    activationType: raw.activation_type ?? null,
    activateCode: raw.code || null,
    listingUrl: mlLink(raw.action),
    startsAt: date(raw.future_coupon_info?.start_date),
    expiresAt: date(raw.future_coupon_info?.expiration_date),
  }
}

export interface CouponPage { coupons: { parsed: ParsedCoupon; raw: RawCoupon }[]; totalPages: number; totalCoupons: number }

export function parseCouponPage(pageProps: Record<string, unknown>): CouponPage {
  const data = pageProps.filteredCouponsData as {
    rawCoupons?: RawCoupon[]; pagination?: { total?: number }; totalCouponsQuantity?: { number?: number }
  } | undefined
  const raws = data?.rawCoupons ?? []
  return {
    coupons: raws.filter((r) => r.campaign_id).map((raw) => ({ parsed: parseCoupon(raw), raw })),
    totalPages: data?.pagination?.total ?? 0,
    totalCoupons: data?.totalCouponsQuantity?.number ?? 0,
  }
}

export function equivalentPercent(c: Pick<ParsedCoupon, 'kind' | 'percentOff' | 'amountOffCents' | 'minPaymentCents'>): number | null {
  if (c.kind === 'percent') return c.percentOff
  if (c.kind !== 'fixed' || !c.amountOffCents || !c.minPaymentCents) return null
  return Math.min(MAX_EQUIVALENT_PERCENT, (c.amountOffCents / c.minPaymentCents) * 100)
}

export function compareStrength(a: ParsedCoupon, b: ParsedCoupon): number {
  if (a.isStore !== b.isStore) return a.isStore ? 1 : -1
  const ea = equivalentPercent(a)
  const eb = equivalentPercent(b)
  if (ea === null || eb === null) return ea === eb ? 0 : ea === null ? 1 : -1
  return eb - ea
}
```

`compareStrength` takes the fields it reads, so the db `Coupon` row (same field names) sorts the same way; widen its parameter type to `Pick<ParsedCoupon, 'isStore' | 'kind' | 'percentOff' | 'amountOffCents' | 'minPaymentCents'>`.

**Step 4:** `npm test` passes.

---

## Task 9: Coupon, run and item repositories

**Files:** Create: `src/db/coupons.ts`, `src/db/runs.ts`, `src/db/items.ts`

No tests (pure-logic-only rule); each function is exercised by Task 10/14/15 runs against the real database. Inside `db.transaction(async (tx) => ...)` use only `tx`: helpers that run inside a transaction take the executor as a parameter. Domain value lists come from `src/lib/domain.ts`. Signatures:

Login outcomes are persisted as `login` runs, so a restart does not forget a refused login: the `login` run's `status` holds the final login state. Add a `RUN_ROW_STATUSES = [...RUN_STATUSES, 'logged_in', 'unconfirmed', 'refused', 'timed_out']` list in `src/lib/domain.ts` for the `runs.status` column type (`text({ enum })` adds no database constraint, so no migration), and give `finishRun` a status parameter of that union.

`src/db/runs.ts`
- `startRun(kind: 'cycle' | 'search' | 'login'): Promise<Run>`
- `finishRun(id, { status: RunStatus, pages: number, counts: Record<string, number>, error?: string })`
- `lastRun(kind): Promise<Run | undefined>` and `previousStatus(kind, beforeId)`: the status of the run before this one, for "notify on status change".
- `recentRuns(limit = 20)` for Conta.

`src/db/coupons.ts`
- One `live` predicate, shared by `activationCandidates`, `discoveryTargets`, `listCoupons` and the Ofertas coupon chips: `ended_at IS NULL AND (expires_at IS NULL OR expires_at > now) AND (starts_at IS NULL OR starts_at <= now)`. "Encerrado" on screen means ended or expired.
- `upsertCoupons(rows: { parsed, raw }[], seenAt)`: removes duplicate `campaignId`s within the batch first (Postgres rejects one upsert touching the same row twice); insert or update every column from `ParsedCoupon`, `raw`, `lastSeenAt = seenAt`, `endedAt = null` (a coupon listed again is no longer ended). Never overwrite `listingUrl` with null when the new parse has none and the stored status is `ACTIVE` (a harvest page can momentarily omit the link).
- `endCouponsNotSeenSince(cutoff, now)`: `UPDATE coupons SET ended_at = now WHERE ended_at IS NULL AND last_seen_at < cutoff AND (expires_at IS NULL OR expires_at > now)` (already-expired coupons show as Encerrado through `expires_at` and are not counted as newly ended). Called only by `runCycle` under the Task 15 two-full-harvests rule, with the previous full cycle's `startedAt`.
- `activationCandidates(limit, now, onlyIds?)`: live AND `activate_code IS NOT NULL` AND (when `onlyIds` is given) `campaign_id IN onlyIds` AND `status = INACTIVE AND activation_type = EU_QUERO AND (activation_tried_at IS NULL OR activation_tried_at < now - ACTIVATION_RETRY_HOURS)`, then sorted in code with `compareStrength`, sliced to `limit`.
- `recordActivation(campaignId, { ok: boolean, error?: string }, at)`: sets `activation_tried_at`, `activation_error` (null on success), and `status = ACTIVE` on success.
- `discoveryTargets(limit, now)`: live (defined above), `listing_url IS NOT NULL`. Load the whole live set and sort it in code by `discovery_tried_at` ascending with nulls first (the rotation), then `compareStrength` as the tie-break, then slice to `limit`. A SQL `LIMIT` on the timestamp alone would cut the never-read coupons arbitrarily instead of by strength.
- `markDiscoveryAttempt(campaignIds, at, succeeded)` (one UPDATE) sets `discovery_tried_at` on every attempt, success or failure, so a listing that always fails moves to the back of the rotation instead of blocking its head, and sets `last_discovered_at` only on success (shown in the UI).
- `listCoupons({ status?, scope?: 'ml' | 'store', kind?, expiringWithinDays?, page })` and `countCoupons(same)`: server-side filters, `LIMIT PAGE_SIZE OFFSET`, plus a linked-items count from `item_sources` (source_type `coupon`, `last_seen_at` within `STALE_AFTER_HOURS`).

`src/db/items.ts`
- `recordObservations(cards: ObservedCard[], source: { type: 'coupon'; coupons: LinkedCoupon[] } | { type: 'search'; ids: string[] }, at)`: in one transaction per page:
  1. Upsert `items` snapshot columns (keep `status` and `firstSeenAt` on update). Descriptive fields (`url`, `thumbnail`, `productId`, `categoryId`, `domainId`, `sellerLabel`, `soldQuantity`, `full`, `freeShipping`) keep the stored value when the new card lacks them (listings often omit shipping, seller and sold quantity); price fields (`priceCents`, `basis`, `basisText`, `listPriceCents`, `mlDiscountPct`, `couponHint`, `observedAt`) always overwrite.
  2. Price segment: load the open segment (latest `first_seen_at`) per item; if same `priceCents` and `basis`, set its `last_seen_at = at`; else insert a new segment `{ first_seen_at: at, last_seen_at: at }`.
  3. Source links: for a `coupon` source a card links to each coupon it matches (`linksToCoupon`: basis in `COUPON_BASES` or a matching hint; hint only when the card is sponsored); for a `search` source every card. Upsert `item_sources` with `last_seen_at = at`.
  4. Drop recompute for the page's items (below).
  Returns the item ids written.
- Drop recompute (inside `recordObservations` since the 2026-11-02 Task 14 review; `recomputeDrops` was removed): loads the page's items' segments with `last_seen_at` inside the 30-day window (`dropRatio` already skips older ones, and the open segment is always inside it) with their `id`, and writes `drop_ratio` from `dropForSegments(rows, now)` (Task 13), which picks the open segment (latest `first_seen_at`, then highest `id`) and skips the `other` basis. `recordObservations` picks the open segment the same way (`ORDER BY first_seen_at DESC, id DESC`). `first_seen_at` and `last_seen_at` are always written from a JS `Date` (never a Postgres `now()` default), so the SQL order and the JS tie-break agree to the millisecond.
- `listDeals(opts)` / `countDealsByTab(opts)`: Task 16 (`countDeals` was removed as unused in the final review).
- `setItemStatus(id, status)`.

Verify: typecheck and lint pass.

---

## Task 10: Harvest and activation steps

**Files:** Create: `src/ingestion/steps/harvest.ts` (browser and DB wiring), `src/ingestion/steps/harvest-pages.ts` (the pure page loop `readCouponPages(io)`), `src/ingestion/steps/coupon-pages.ts` (page URL, `isFullHarvest`, `lastPageToRead`, activation visits), `src/ingestion/steps/breaker.ts` (load and click breakers), `src/ingestion/steps/activate.ts`, `src/ingestion/ml/activate-click.ts` (button listing, the pure chooser, the click, the outcome), `src/lib/records.ts` (`isRecord`); Modify: `src/ingestion/ml/coupons.ts`, `src/ingestion/ml/page-state.ts`, `src/lib/domain.ts` (`ActivationOutcome`), `src/db/coupons.ts`, `scripts/ml-capture.ts`

**Step 1:** `harvest(page)`: load `ML_COUPONS_URL` (`&page=N` for N > 1) through `loadWithRetry`, `parseCouponPage`, `upsertCoupons`, collect distinct `campaignId`s. A page that still fails after the retry marks the harvest partial and continues. Full (`isFullHarvest` in `coupon-pages.ts`) = no failed page, `totalCoupons > 0`, `totalPages` covers `totalCoupons` at page 1's raw entry count (parsed plus skipped), and coverage holds: `totalCoupons - (seen + skipped)` is below one page; a drift across a page boundary reads as not full, the safe direction. A page fails when its reported `pagination.page` is not the one requested, when it has no entries, or when its totals are not non-negative integers. The page loop is capped at `min(totalPages, ceil(totalCoupons / firstPageCount) + 1)` and stops at the first empty page; three unreadable pages in a row (unparseable, or reporting the wrong page number) end the harvest as not full (run partial, not a breaker hit). An empty page at or past the last page the total needs ends the loop without failing (drift can empty the natural last page; coverage still guards). The last error of any kind, load or parse, is kept as `lastError` for the run's error text. Log `seen`, `skipped` and `totalCoupons` in the run counts. Harvest never ends coupons: ending is the Task 15 two-full-harvests rule. Returns `{ allPagesLoaded, pages, seen, inserted, skipped, unparsed, totalCoupons, failedPages, lastError, couponPages }`, where `couponPages` maps each `campaignId` to the page it was last seen on (activation visits that page). A `RunStop` propagates. `parseCouponPage` already throws `COUPON_PAGE_WITHOUT_DATA` when the coupon data is absent; that page counts as failed (no second check). Three page loads in a row failing after retry (navigation error, timeout, page state missing) end the step with `RunStop('blocked', <last error>)` (a shared consecutive-failure breaker in `src/ingestion/steps/breaker.ts`, used by every step that reads pages). A page that loaded but parsed to no usable data is a failed page for the run counts, not a breaker hit: a reader that does not understand a layout must not look like a block.

**Step 2:** `activate(page, limit, now, couponPages?)`: with `limit === 0`, return at once. Otherwise take `activationCandidates(limit, now, <couponPages keys when non-empty>)`, group them by the page each was last seen on (`couponPages`, else page 1), load each page once without retry (a closed browser ends the run as `failed`, never as `blocked`), and click each candidate's "Aplicar" button (decided from the Task 7 capture below; distinct error texts for no match and several). Success = HTTP 200, `coupon.action.type` is `link`, and `coupon.campaignId` is the target's. Candidates come only from coupons seen in this harvest (`couponPages` keys, filtered in SQL before the limit); with an empty map, page 1 is the fallback. The button is chosen by a pure function over `{ ariaLabel, cardText }` for every Aplicar button: an exact `aria-label` match on the coupon's `sr_label`, with title and scope as confirmation; without an `sr_label`, title and scope alone; exactly one match either way. The listing marks every listed Aplicar element with a `data-apply-index` attribute in the same evaluate, and the click targets the chosen one by that attribute (never a position), re-checking its `aria-label` first; a mismatch is recorded as "o botão Aplicar mudou antes do clique" without a click. Cards are bounded by `button, a[href]` (every card carries an svg `role=button` terms icon). A listing that fails before any click counts the candidate as skipped. A login or wall URL before or after a click stops the run; it is never recorded as an activation failure. An activate response of 403 or 429 stops the run as `blocked`, 401 as `session_expired`. If a click leaves the loaded URL, the rest of that page is skipped. Store the outcome with `recordActivation`; one failure never stops the rest, but two clicks in a row with no activate response (or a click that threw) are ML's risk check refusing us: the run stops as `blocked`, skipping discovery. The first unparseable page ends the step. A card present on its page without an "Aplicar" action is recorded as a failure (normal 24 h lockout). Candidates never attempted (page failed, card absent, step ended early, page left) are counted as `skipped` and not recorded, so they get no 24 h lockout. Wait `PAGE_DELAY_MS` between activations. Returns `{ activated, failed, skipped, pages }`.

**Activation capture (2026-11-02, `captured/activation.json`):** one click on "Aplicar" for 14633544 ("R$ 200 OFF Móveis pra Casa") sent `POST /cupons/api/activate?coupon_activate_code=<code>&campaign_id=<id>&origin=filter&activation_method=EU_QUERO`. The request had body `{}`, `content-type: application/json`, and an `x-csrf-token` header. The token is the page's `<meta name="csrf-token">`; it is not in `pageProps` and not a cookie. The response was 200 with JSON `{ coupon: {...} }` in camelCase: `campaignId`, `action: { type: "link", value: <listing url> }`, and `code: ""`. Before the POST, the click ran reCAPTCHA Enterprise (`google.com/recaptcha/enterprise/reload` and `/clr`) and made two `POST /browser-assessment/s/r` calls. Their output did not go into the activate request. A CSRF-like header is required, so a `fetch` replay must read the meta token and send it as `x-csrf-token`. A replay would also skip that risk check, which has not been tested. Use click: success = the activate response is 200 and its `coupon.action.type` is `link`. A reload of `ML_COUPONS_URL` a few minutes later (`captured/coupons-page-after.json`) showed 14633544 in `filteredCouponsData.rawCoupons` as `status.id: "ACTIVE"`, `code: ""`, `action.type: "link"`. Its `action.value` was the same `_Container_FH-Cupom-Boost-16?coupon_campaign_id=14633544` link the activate response returned. It also appeared in `activeCouponsData.rawCoupons` ("Meus cupons", 1 coupon). The next harvest therefore reads the listing link as the plan assumes.

**Step 3:** Verify with a throwaway script that runs `serialized(() => withMlBrowser('hidden', harvest + activate(limit 1)))` against the real database: coupons table holds every coupon of the account (1,926 on 2026-11-02); one coupon flips to ACTIVE; its `listing_url` appears on the next harvest.

---

## Task 11: App shell and Cupons page

**Files:** Create: `src/components/AppHeader.tsx`, `src/components/StatusChip.tsx`, `src/app/cupons/page.tsx`, `src/components/CouponRow.tsx`, `src/lib/format.ts`; Modify: `src/app/layout.tsx`

**Step 1:** Copy `src/lib/format.ts` (`formatPrice` etc.); add `formatCents(cents)` built on it, and `formatAgo(date, now)` ("visto há 5 h", "há 2 d").

Also add `src/app/icon.svg` (a simple neutral tag glyph), so the browser stops requesting a missing `/favicon.ico`.

**Step 2:** `AppHeader`: copy olxmapper's and, like olxmapper, render it from each page, not the root layout (a layout does not re-render on client navigation, so its StatusChip would go stale), nav links Ofertas (`/`), Cupons, Buscas, Alertas, Conta; no logout. `StatusChip`: last cycle run status and time, login state; links to `/conta`; text labels, never color alone.

**Step 3:** `/cupons`: server component; query params `status` (`ativo`/`inativo`/`encerrado`), `escopo` (`ml`/`loja`), `tipo` (`percent`/`fixed`), `vence` (days), `pagina`. Uses `listCoupons`/`countCoupons`. Each row: title, escopo label ("Mercado Livre" or the store name from `scopeLabel`), status text (Ativo / Inativo / Encerrado), compra mínima, limite, validade, linked items count, last discovery (`formatAgo`), activation error if any, links "Ver no ML" (`listingUrl`, new tab) and "Ver ofertas" (`/?cupom=<campaignId>`). Pagination: Anterior / Próxima `btn btn-ghost` links (olxmapper has no paginated feed to copy); hidden when `pagina` is past the last page. Empty state: "Nenhum cupom ainda. Rode um ciclo em Conta." when the table is empty.

**Step 4:** Open `/cupons` with the Playwright MCP, snapshot, check filters and pagination.

**Checkpoint 2:** typecheck, lint, tests pass; `/cupons` lists the harvested coupons. Give Fernando:

```
git -C ~/projetos/promo-cps add -A && git -C ~/projetos/promo-cps commit -m "feat: coupon harvest, auto-activation, Cupons page"
```

---

## Task 12: Card reader

> **Decisions from the 2026-11-02 captures (see the design's What was verified):** `priceCents` comes from `current_price.value` only (the displayed price; never mix in `tracks.price.price`). `freeShipping` is true when a `shipping_v2` entry's text or one of its pill texts matches /grátis/i AND that same entry's `values[]` has no `key: "new_buyer"` (the perk label is a sibling of the pill; the only real free-shipping card seen is a bare `{text: "Frete grátis"}` entry with no pill); null when there is no `shipping_v2` component. Add an inline test for the bare-text entry, a perk entry, and FULL (the fixture has no true free-shipping or FULL card). A `promotions` component with `type: "coupon"` sets a structured `couponHint` `{ text, percentOff, amountOffCents, priceAfterCents }` on the observed card. Three shapes exist: "15% OFF com Cupom" (percent), "{amount} OFF com Cupom" with `values[].price.value` (fixed amount), and "{1} com Cupom" with `values[{key: "1", price.value}]` (price after the coupon); `text` is rendered with every `{key}` placeholder replaced. A hint does NOT always belong to the listing's coupon (on one coupon listing 8 of 12 hints were other coupons); add a nullable `items.coupon_hint` text column (the database is migrated, so this is a new migration `0001`, generated with `npm run db:generate`). Task 14 links a card to its listing's coupon when its basis includes a coupon OR its hint matches that coupon (same percent, same fixed amount, or a price after coupon equal to the price minus the coupon's cap-aware discount, within 100 centavos at R$ 1.000 and above, where prices lose their centavos, and 2 centavos below); see `linksToCoupon` in `src/ingestion/ml/observed-card.ts`. An unmatched hint is shown on the card only. Product-page reader paths are in the confirmed-paths paragraph below; the item key is the item id shown.

**Files:** Modify: `src/ingestion/ml/page-state.ts`; Create: `src/ingestion/ml/cards.ts`, `src/ingestion/ml/cards.test.ts`

Use the paths confirmed in Task 7. Observed on 2026-10-31: `polycard.metadata.{id, product_id, url, url_params, is_pad, category_id, domain_id, tracks.sold_quantity}`; `polycard.pictures.pictures[0].id`; `polycard.components[]` with `type` `title` (`title.text`), `price` (`price.current_price.value`, `price.price_labels[].values[].price.{value, previous}`, `price.discount_pct`, `price.discount_complement.values[].label.text`), `shipping_v2` (`shipping_v2[].values[]` pills with `pill.text`, icons with `icon.key` such as `vpp_full_icon`).

**Confirmed paths (captured 2026-11-02, logged in; raw files in `__fixtures__/captured/`):**
- Where cards live: coupon and store listings keep them at `initialState.results[].polycard`. Search pages stream them, so each card appears twice: under `getResultsPromise.value.optimizedResponse.results[]` and again under `getResultsPromise.value.sharedState.search.results[]`. A full walk finds every search card twice; dedupe by id.
- Thumbnail: `https://http2.mlstatic.com/D_Q_NP_2X_<pictures.pictures[0].id>-E.webp`, where the id looks like `610870-MLA95657253150_102025`. This is the DOM `src` of the first card in all three listings.
- URL: `metadata.url` has no scheme. `url_params` is URL-encoded and depends on the listing: `?pdp_filters=item_id%3A<id>` on search, `deal%3A<deal>` on a coupon container, `seller_id%3A<seller>` on a store page. Paths are either `/<slug>/p/MLB<n>` (catalog) or `/<slug>/up/MLBU<n>`. The `/up/` shape covers 25 of 48 search cards; those have `user_product_id` but no `product_id`. No `produto.` host was seen. Sponsored cards (`is_pad: "true"`) point to `click1.mercadolivre.com.br/mclics/clicks/external/MLB/count?a=<token>`.
- Sponsored duplicates: none of the 12 sponsored cards on the coupon listing duplicated an organic card on that page, by id, `product_id`, `user_product_id` or title. The search and store pages had no sponsored cards. `listing.json` therefore holds a real sponsored card that has no organic twin, so the merge test needs an inline duplicate.
- Price: `current_price.value` drops the centavos at R$ 1.000 and above. All 40 such cards are integers, while 106 of the 116 cards below R$ 1.000 show centavos. For example, `metadata.tracks.price.price` reads 1223.59, 1931.99 and 1151.99 where `current_price.value` reads 1223, 1931 and 1151. `tracks.price` exists on 59 of 60 coupon-listing cards but only on 3 or 4 of 48 elsewhere. When present, `tracks.price.promotions[].campaign_id` names the campaigns priced in, e.g. "14633544-14471080". Not used: see Decisions above (displayed price only).
- Basis texts seen: "com Cupom", "no Pix", "no Pix com Cupom", and none. A coupon that is not priced in (item below the coupon minimum) appears as a separate `promotions` component, `promotions[].{type: "coupon", text}`, with text "15% OFF com Cupom" or "{amount} OFF com Cupom" plus `values[].price.value`. On the store listing (R$ 120 minimum), 45 of 48 cards showed only this component.
- Sold quantity: `metadata.tracks.sold_quantity`, a bucketed number (25, 50, 100, 500, 1000, 5000, 10000, 100000) or `null` (13 of 48 search cards).
- Shipping: `shipping_v2[].values[]` holds pills `{type: "pill", key, pill.text}`. Keys are `free_shipping_single` (text "{shipping_truck_quiet_icon} Grátis"), `same_day_free_shipping`, `next_day_free_shipping` and `two_days_free_shipping` (text "Chegará grátis amanhã" and similar). FULL is `{type: "icon", key: "full_icon", icon: {key: "vpp_full_icon", alt_text: "Enviado pelo FULL"}}`. On this account, 108 of 109 free-shipping entries come with `{key: "new_buyer", label.text: "por ser sua primeira compra"}`, and the product page tracks `showing_promises: ["free_shipping_new_buyer"]`. The one exception is a bare `{text: "Frete grátis"}` entry (MLB4465210291). Free shipping is therefore the account's first-purchase perk, not an item fact. `shipping_v2` is absent on 47 of 60 coupon-listing cards.
- Seller: `components[type=seller].seller.{text, values[]}`. The text is a template such as "{label} por Madesa moveis {icon_cockade}" or "Mobi Phone {icon_cockade}". `{label}` resolves to `values[key=label].label.text`; icons drop out. Present on 60 of 60, 37 of 48 and 13 of 48 cards.
- Product page (`pageProps.page === "pdp"`, state in `pageProps.initialState`):
  - Ids: product id is `initialState.id`; item id is `initialState.history.id`.
  - Track: `components.track.melidata_event.event_data` repeats `item_id` and `catalog_product_id`. It also has `seller_name`, the non-Pix `price`, `sold_quantity` and `logistic_type` (`xd_drop_off` here; no FULL item was captured).
  - Title: `components.header.title`. The subtitle reads "Novo | +10 mil vendidos".
  - Price: `components.price.price.value` (878.75), with `original_value` (925). The basis is `components.price.price_breakdown.discount.label.text` ("no Pix").
  - Seller: `components.seller_summary.seller.name`. Picture: `components.gallery.pictures[0].id`, same thumbnail pattern.
- Item id on `/p/` pages: they expose an item id distinct from `product_id`. The page shows the offer picked by `pdp_filters`, with `selected_offer_type: "BEST_PRICE"`. Competing offers from other sellers sit in `components.buy_box_offers.items[].item_id`, and the page's schema.org data names yet another item for the same product (`sku` MLB7777341940 at 981.96). Rotation over time was not observed in one load. Still, a `/p/` URL without `pdp_filters` shows whichever offer wins, so its item id can change with the seller.
- `decimal_amount`: values were "0" (176) and "9" (4). "9" is one digit: `fractional "199", decimal "9"` is labeled "Compra mínima R$ 199,9", i.e. 19990 centavos, as `parseAmountCents` assumes. No empty string was seen.
- Personal data in raw `pageProps`: `currentUser`, `errorContext.userId`, `buyer_id`, zip codes in `melidata_track` and `shipping_promise`, `gtm_event.buyer*`, and `csrfToken`. Fixtures copy only allowlisted paths.

**Step 1: failing tests** against `__fixtures__/listing.json`:

```ts
import { describe, expect, it } from 'vitest'
import listing from './__fixtures__/listing.json'
import { findPolycards, mergeCards, parseCard } from './cards'

describe('cards', () => {
  const cards = findPolycards(listing).map(parseCard).filter((c) => c !== null)
  it('reads every card in the fixture', () => expect(cards.length).toBe(3))
  it('organic coupon card', () => {
    const c = cards.find((x) => x.basisText === 'com Cupom')!
    expect(c).toMatchObject({ isPad: false, basis: 'coupon' })
    expect(c.priceCents).toBeGreaterThan(0)
    expect(c.url).toMatch(/^https:\/\/www\.mercadolivre\.com\.br\/.+\?pdp_filters=/)
  })
  it('merges a sponsored duplicate into the organic card', () => {
    const merged = mergeCards(cards)
    expect(new Set(merged.map((c) => c.id)).size).toBe(merged.length)
    expect(merged.every((c) => !c.url || !c.url.includes('click1.'))).toBe(true)
  })
  it('missing fields stay null', () => {
    expect(parseCard({ metadata: { id: 'MLB1' }, components: [] })).toBeNull()
  })
})
```

**Step 2:** `src/ingestion/ml/cards.ts`: `findPolycards(root)` walks the object iteratively (explicit stack, no recursion) and returns every value under a `polycard` key; `parseCard(p)` returns `ObservedCard | null` (null when id, title or price is missing): `{ id, productId, title, thumbnail, url, isPad, priceCents (Math.round(value * 100)), basisText, basis (basisFromComplement), listPriceCents, mlDiscountPct, soldQuantity, full, freeShipping, categoryId, domainId }`. `url` is `https://` + `metadata.url` + `metadata.url_params` only when `is_pad !== 'true'`, else null. `full`/`freeShipping` are null when no `shipping_v2` component exists, else booleans (free = a pill text matching `/gr[aá]tis/i`; full = an icon key `vpp_full_icon`). `mergeCards` dedupes by id, preferring the organic card and filling nulls from the duplicate. Thumbnail from the pattern confirmed in Task 7.

**Step 3:** `npm test` passes.

---

## Task 13: Real-drop calculation

> **As implemented (2026-11-01), superseding the code below:** `src/lib/drop.ts` and `drop.test.ts` are the source of truth. Changes after review: the drop is `(minPrev - price) / minPrev`; drops under `MIN_DROP_RATIO` (0.01) return 0; history is the time since the earliest price seen in the 30-day window (the current price's first sighting counts), under `HISTORY_MIN_DAYS` it returns null; no earlier price in the window returns 0; `Segment` carries `basis`; `splitOpenSegment(rows)` picks the open segment (latest `firstSeenAt`, then highest `id`); `dropForSegments(rows, now)` splits, returns 0 when the current basis is `other`, ignores earlier `other` segments, then calls `dropRatio`.

**Files:** Create: `src/lib/drop.ts`, `src/lib/drop.test.ts`

**Step 1: failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { dropRatio, type Segment } from './drop'

const now = new Date('2026-11-30T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000)
const seg = (priceCents: number, from: number, to: number): Segment => ({
  priceCents, firstSeenAt: daysAgo(from), lastSeenAt: daysAgo(to),
})

describe('dropRatio', () => {
  it('null without 7 days of history', () => {
    expect(dropRatio(seg(100, 3, 0), [seg(120, 5, 3)], now)).toBeNull()
  })
  it('drop below every earlier price in the window', () => {
    expect(dropRatio(seg(90, 2, 0), [seg(100, 20, 10), seg(120, 10, 2)], now)).toBeCloseTo(0.1, 5)
  })
  it('stays a drop while the new low holds', () => {
    expect(dropRatio(seg(90, 6, 0), [seg(100, 20, 6)], now)).toBeCloseTo(0.1, 5)
  })
  it('zero when equal to the earlier low', () => {
    expect(dropRatio(seg(100, 1, 0), [seg(100, 20, 10), seg(120, 10, 1)], now)).toBe(0)
  })
  it('zero when above the earlier low', () => {
    expect(dropRatio(seg(130, 1, 0), [seg(100, 20, 1)], now)).toBe(0)
  })
  it('ignores segments that ended before the window', () => {
    expect(dropRatio(seg(100, 25, 0), [seg(50, 60, 40)], now)).toBe(0)
  })
  it('zero when the price never changed in 30 days', () => {
    expect(dropRatio(seg(100, 40, 0), [], now)).toBe(0)
  })
})
```

**Step 2:** `src/lib/drop.ts`:

```ts
import { DAY_MS, HISTORY_DAYS, HISTORY_MIN_DAYS } from './constants'

export interface Segment { priceCents: number; firstSeenAt: Date; lastSeenAt: Date }

export function dropRatio(current: Segment, earlier: Segment[], now: Date): number | null {
  const firstSeen = Math.min(current.firstSeenAt.getTime(), ...earlier.map((s) => s.firstSeenAt.getTime()))
  if (now.getTime() - firstSeen < HISTORY_MIN_DAYS * DAY_MS) return null
  const windowStart = now.getTime() - HISTORY_DAYS * DAY_MS
  const prices = earlier.filter((s) => s.lastSeenAt.getTime() >= windowStart).map((s) => s.priceCents)
  if (prices.length === 0) return 0
  const minPrev = Math.min(...prices)
  return current.priceCents < minPrev ? 1 - current.priceCents / minPrev : 0
}
```

**Step 3:** `npm test` passes. Wire the drop recompute (Task 9, now inside `recordObservations`) to it.

---

## Task 14: Observations and discovery step

**Files:** Create: `src/ingestion/steps/discover.ts` (browser and DB wiring), `src/ingestion/steps/discover-pages.ts` (the pure loop `discoverListings(io, targets, budgetPages)`); Modify: `src/ingestion/ml/cards.ts` (`cardsOfPage`), `src/lib/ml-url.ts` (`classifyListingLanding`, `COUPON_CAMPAIGN_PARAM`), `src/ingestion/steps/breaker.ts` (streak constants, `failureTally`), `src/ingestion/ml/page-state.ts` (`LoadedPage`), `src/lib/observations.ts`, `src/ingestion/ml/observed-card.ts`, `src/db/items.ts`, `src/db/coupons.ts`.

**Step 1:** `cardsOfPage(pageProps)` reads cards only from `initialState.results` (never the whole tree, so a recommendations carousel cannot link), merges duplicates, and returns `{ cards, found, dropped }`; missing results throw `LISTING_RESULTS_MISSING`. `findPolycards`' whole-tree walk stays for search pages (Task 17).

**Step 2:** `discover(page, budgetPages, now)`: `discoveryTargets(undefined, now)` (the whole live set in rotation order); group coupons by `listingUrl`; for each distinct URL until the page budget is spent: `loadWithRetry` through the shared `loadBreaker` (3 consecutive load failures = `RunStop('blocked')`), then `listingLandingKept(listingUrl, finalUrl)` accepts only the coupon's own listing:
- the final URL keeps the coupon's `coupon_campaign_id` value;
- a `_CustId_` listing (739 of 1,785 on 2026-11-02) landed on a `lista.` store path (`/pagina/<x>`, `/loja/<x>`) without the param: the seller's own store page, where its coupon applies;
- a `_Container_` listing landed on the same container path, compared case-insensitively, without the param (live: `_Container_FH-Cupom-Boost-16?coupon_campaign_id=14633544` redirected to `_Container_fh-cupom-boost-16`);
- a listing without the param kept its origin and path.
Anything else is `away`: nothing is recorded.
Then `cardsOfPage` (outside the breaker; a parser exception is a reader failure, never a breaker hit) and `recordObservations(cards, { type: 'coupon', coupons }, now)`. Each card links only to the coupons it matches (`linksToCoupon(card, coupon, card.isPad)`: basis in `COUPON_BASES` or a matching hint; sponsored cards by hint only). The 2026-11-02 live run showed why basis linking is needed: all 192 cards had no coupon hint, because cards of ACTIVE coupons show the coupon price directly; a hint-only rule linked nothing on the three `_CustId_` store pages. `recordObservations` recomputes `drop_ratio` for the page's items inside the same transaction as their segments, reading only segments inside the 30-day window. `markDiscoveryAttempt(ids, now, succeeded)` (one UPDATE) runs for every loaded page, also when `record` throws (then rethrown); a page that stopped the run stays unmarked. Reader failures (results missing, polycards present but none parsed, a parse exception) feed `MAX_UNPARSED_PAGES_IN_ROW` (3); listing-state failures (`away`, an empty listing) feed `MAX_LISTING_FAILURES_IN_ROW` (10); either limit ends the step as not a breaker hit (run partial), and a good page resets both. An empty listing counts as failed until a real empty-results capture gives a marker. Returns `{ pages, items, failed, droppedCards, itemIds, lastError }` (`itemIds` distinct).

**Step 3:** Verify with a throwaway script (budget 5): items, segments and coupon links appear. The first try on 2026-11-02 hit `/captcha/wall/logged` on page 1 (1 load, no retry). Fernando cleared it with Task 6b (the window went from the wall to the container listing and closed itself); the second try read 5 listings in 9 main-frame navigations (redirect hops included) with no wall: 192 items, 192 segments, 48 coupon links (all from the one `/loja/.../_Container_...-seller-...` listing that kept the param), 0 hints on any card, 0 links on the three `_CustId_` store pages under the then hint-only rule, and the FH-Cupom-Boost-16 container rejected for its case-only redirect. Both led to the landing and linking rules above.

---

## Task 15: Cycle runner and Rodar agora

**Files:** Create: `src/ingestion/cycle.ts` (`requestCycle`, `cycleActivity`, private `runCycle`), `src/ingestion/cycle-rules.ts` (`isMainFrameNavigation`, `endingCutoff`, `cycleStatus`, `partialReason`), `src/ingestion/login-display.ts`, `src/lib/cycle-counts.ts`, `src/lib/badge-tone.ts`, `src/lib/run-view.ts`, `src/db/request-runs.ts` (`accountRuns`, React `cache`, per request), `src/app/api/run/route.ts`, `src/components/RunNowButton.tsx`, `src/components/RunsList.tsx`, `src/components/useBrowserJob.ts`, with tests; Modify: `src/ingestion/login.ts`, `src/ingestion/errors.ts` (`redactQueries`), `src/db/runs.ts` (`lastStatusRun`), `src/db/coupons.ts`, `src/lib/domain.ts`, `src/lib/labels.ts`, `src/lib/format.ts`, `src/components/LoginButton.tsx`, `src/components/VerifyButton.tsx`, `src/components/StatusChip.tsx`, `src/app/conta/page.tsx`, `src/app/api/ml/status/route.ts`

**Step 1:** `runCycle()`:

```ts
async function runCycle(): Promise<Run> {
  const previous = await lastRun('cycle')
  const run = await startRun('cycle')
  const counts: Record<string, number> = {}
  let status: RunStatus = 'ok'
  let pages = 0
  let error: string | undefined
  try {
    await withMlBrowser('hidden', async (page) => {
      page.on('request', (r) => { if (isMainFrameNavigation(r, page)) pages += 1 })
      const h = await harvest(page)
      Object.assign(counts, { seen: h.seen, inserted: h.inserted, skipped: h.skipped, unparsed: h.unparsed, totalCoupons: h.totalCoupons, failedPages: h.failedPages, fullHarvest: h.allPagesLoaded ? 1 : 0 })
      const cutoff = endingCutoff(h.allPagesLoaded, previous)
      counts.ended = cutoff ? await endCouponsNotSeenSince(cutoff, new Date()) : 0
      const a = await activate(page, env().ACTIVATE_PER_RUN, new Date(), h.couponPages)
      Object.assign(counts, { activated: a.activated, activationFailed: a.failed, activationSkipped: a.skipped })
      const s = await runDueBuscas(page, new Date())
      Object.assign(counts, s.counts)
      const d = await discover(page, discoveryBudget(env().DISCOVERY_PAGES_PER_RUN, s.counts.buscaPages), new Date())
      Object.assign(counts, { discoveryPages: d.pages, discoveredItems: d.items, discoveryFailed: d.failed, droppedCards: d.droppedCards })
      status = cycleStatus(h.allPagesLoaded, s.failed + d.failed)
      if (status === 'partial') error = h.lastError ?? partialReason(h, d.lastError ?? s.lastError)
    })
  } catch (e) {
    status = isRunStop(e) ? e.status : 'failed'
    error = firstLine(e)
  }
  const finished = await finishRun(run.id, { status, pages, counts, error: error && redactQueries(error) })
  await afterRun(finished)
  return finished
}

export function requestCycle(): Promise<Run> {
  return inFlightCycle() ?? serialized(runCycle)
}
```

`isMainFrameNavigation(request, page)` returns `request.isNavigationRequest() && request.frame() === page.mainFrame()`, and false if `frame()` throws (Playwright throws for a navigation issued before its frame exists, e.g. a reCAPTCHA iframe; a throw inside a listener would escape the cycle's try). Each step's counts are assigned as soon as it returns, so a `RunStop` in a later step keeps the earlier steps' counts. `pages` counts main-frame navigation requests, retries and redirect hops included, so it measures ML traffic and survives a `RunStop` (it is read after the catch). Drops need no step here: `recordObservations` recomputes `drop_ratio` for each page's items in the same transaction as their segments (decided 2026-11-02 in the Task 14 review). `runDueBuscas` is a stub returning empty results until Task 17; `afterRun` is a stub until Task 20 (alerts and status-change notifications).

**Ending coupons (decided 2026-11-02 from the first real harvest):** ML's own total drifted by 1 to 2 during a 2.5-minute read (1,933, then 1,932, and 1,931 distinct seen) and one coupon shifted across a page boundary, so "seen equals total" is almost never true. `harvest` no longer ends coupons; it returns `allPagesLoaded`, the `isFullHarvest` result. The cycle records it in the run counts (`fullHarvest: 1` or `0`). When this cycle's harvest is full AND the previous cycle run's harvest was full, `runCycle` calls `endCouponsNotSeenSince(previous.startedAt, now)` (the cutoff comes from the pure `endingCutoff(thisHarvestFull, previous)`), ending only coupons missing from both full harvests. A coupon missed once by a page shift reappears next time and is never ended. Expired coupons already show as Encerrado through `expires_at`.

**Step 1b:** Persist login outcomes: `startLogin` (src/ingestion/login.ts) records a `login` run with `startRun('login')` when the job starts and `finishRun` with the final login state (`logged_in`, `refused`, `unconfirmed`, `timed_out`, `failed`) when it ends, so `schedulerPause` and Conta survive a restart. The StatusChip and the Conta card then show the in-memory login state while a login is in progress, and otherwise the last login run's outcome, with "sessão expirada" when `schedulerPause` reports one; today they read "Não iniciado" after every restart.

**Single entry (decided 2026-11-02 in the Task 15 review):** `runCycle` is private; `requestCycle()` is the only entry, used by the route and the scheduler, and returns the in-flight promise as a no-op while a cycle is queued or running, so a press during a scheduled cycle never doubles ML traffic. The login display goes through `schedulerPause`, so the UI and the scheduler always agree on "sessão expirada". `endCouponsNotSeenSince(cutoff, now)` ends only coupons not already expired, so `ended` counts coupons that newly disappeared.

**Step 2:** `POST /api/run` (in `withApi`, with `rejectUnlessBrowser` and `ConfirmRequest` like login and verify): starts `requestCycle()` without awaiting and returns 202 (errors in startRun, finishRun or afterRun happen outside runCycle's try). Conta gets a "Rodar agora" button and the last 20 runs (status text, start, duration, pages, counts, error). `GET /api/ml/status` adds `lastRun`.

**Step 3:** Run one full cycle from Conta with the default budgets. Expect status `ok` or `partial` with counts. Snapshot Conta. Done by Fernando on 2026-11-02 (19:31-19:51 local): `partial` (one listing whose page state had no results), 444 main-frame page loads, no wall or stop; the scheduler then planned the next run three hours after the cycle's start.

---

## Task 16: Ofertas page

**Files:** Create: `src/lib/deal-query.ts`, `src/lib/deal-query.test.ts`, `src/lib/query-params.ts`, `src/components/FilterBar.tsx`, `src/components/filters/FilterPopover.tsx`, `src/components/filters/fields.tsx`, `src/components/DealCard.tsx`, `src/components/StatusButtons.tsx`, `src/app/api/items/[id]/route.ts`; Modify: `src/db/items.ts`, `src/app/page.tsx`

**Step 1:** Copy `src/lib/query-params.ts` (keep `num`, `str`, `list`; drop the feed-search cookie helpers until Task 18 needs them).

**Step 2: failing tests** `src/lib/deal-query.test.ts` for `dealFiltersFromParams` and `normalizeAlertQuery`:

```ts
import { describe, expect, it } from 'vitest'
import { dealFiltersFromParams, normalizeAlertQuery } from './deal-query'

describe('dealFiltersFromParams', () => {
  it('reads filters and drops invalid ones', () => {
    expect(dealFiltersFromParams({
      busca: 'b1', cupom: '123', precoMax: '500', descontoMin: '20', queda: '1',
      vendidosMin: 'x', full: '1', frete: '1', sort: 'bogus',
    })).toEqual({
      searchId: 'b1', couponId: '123', priceMaxCents: 50000, discountMin: 20, onlyDrops: true,
      soldMin: undefined, full: true, freeShipping: true, includeStale: false, sort: 'desconto',
      category: undefined,
    })
  })
})

describe('normalizeAlertQuery', () => {
  it('sorts keys, drops sort, tab and page', () => {
    const p = new URLSearchParams('sort=preco&queda=1&busca=b1&status=SAVED&pagina=2&descontoMin=10')
    expect(normalizeAlertQuery(p)).toBe('busca=b1&descontoMin=10&queda=1')
  })
})
```

**Step 3:** `src/lib/deal-query.ts`: `DEAL_FILTER_KEYS = ['busca', 'cupom', 'precoMax', 'descontoMin', 'queda', 'vendidosMin', 'full', 'frete', 'categoria', 'antigos', 'sort']`, `DEAL_SORTS = ['desconto', 'queda', 'preco', 'recentes']` (default `desconto`), `dealFiltersFromParams`, `searchParamsToRecord` (copied), `normalizeAlertQuery(params)` (olxmapper's, over the alert keys = filter keys minus `sort`).

**Step 4:** `listDeals(opts)` and `countDeals(opts)` in `src/db/items.ts`: one SQL query with every filter in the WHERE clause:
- tab `status` (`NOT_SEEN`/`SAVED`/`SEEN`);
- `observed_at >= now - STALE_AFTER_HOURS` unless `includeStale`;
- `searchId` is used only after it matches a known Busca id (olxmapper's `resolveSearchId` pattern: `searches.id` is a uuid and a malformed value would make Postgres raise 22P02). An unknown or deleted Busca id yields ZERO rows, never "every offer": a deleted Busca must not turn its alerts into an alert on everything. `POST /api/alerts` also strips an unknown `busca` before saving.
- `listDeals` options are typed `DealFilters & { tab, page, observedSince?, offersOnly?, limit? }` from the start. As built (2026-11-02, `src/db/deals.ts`): `dealWhere(o, now): SQL` is the single condition builder (it returns `false` for a malformed or unknown Busca, so no caller can send a bad uuid to Postgres), shared by `listDeals`, `countDealsByTab` (through `filterWhere`) and Task 20's `INSERT ... SELECT`; Task 20 reuses `dealWhere`, not `listDeals`. The tab param is `aba` (`novos`/`salvos`/`vistos`); `precoMax=0`, `descontoMin=0` and `vendidosMin=0` all mean no filter. A minimum of 0 (`descontoMin=0`, `vendidosMin=0`) means no filter (a `>= 0` would hide NULL rows).
- `searchId` / `couponId`: `EXISTS (SELECT 1 FROM item_sources WHERE item_id = items.id AND source_type = ... AND source_id = ... AND last_seen_at >= now - STALE_AFTER_HOURS)`;
- `price_cents <= priceMaxCents`, `ml_discount_pct >= discountMin`, `drop_ratio > 0` when `onlyDrops`, `sold_quantity >= soldMin`, `full = true`, `free_shipping = true`, `category_id = category`;
- sort `desconto`: `ml_discount_pct DESC NULLS LAST, observed_at DESC NULLS LAST` (exactly the `items_discount_idx` order, so the index serves it); `queda`: `drop_ratio DESC NULLS LAST`; `preco`: `price_cents ASC`; `recentes`: `first_seen_at DESC`;
- `LIMIT PAGE_SIZE OFFSET (page - 1) * PAGE_SIZE`.
Each row also returns its coupon chips: coupons linked through `item_sources` (type `coupon`, link not aged) that are not ended and not past `expires_at`, with `title`, `expiresAt`, `minPaymentCents`.

**Step 5:** UI, copied and adapted from olxmapper. `FilterBar` deletes a key when a flag is off or a field is empty (never writes `queda=0` or `precoMax=`). The price on `DealCard` is `whitespace-nowrap`.
- `src/app/page.tsx` from olxmapper's feed page: tabs Novos / Salvos / Vistos (drop "Possíveis fakes"), `FilterBar`, grid of `DealCard`, pagination, empty states ("Nenhuma oferta ainda. Rode um ciclo em Conta.", "Nenhuma oferta com estes filtros.", and the session or blocked banner from the last run).
- `FilterBar` from olxmapper's pill bar: pills Busca, Cupom, Preço máximo, Desconto mínimo, Só abaixo do menor preço, Vendidos mínimo, FULL, Frete grátis, Categoria, Incluir não vistos recentemente; sort select.
- `DealCard` from `ListingCard`: thumbnail, title, price with basis text (`basisText` or "sem desconto de Pix/Cupom"), "47% OFF, de R$ 8.786", the badge "12% abaixo do menor preço em 30 dias" when `dropRatio > 0` (percent via `Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 })`, never floored), "sem histórico" when `dropRatio` is null, `formatAgo(observedAt)`, sold, FULL, Frete grátis, coupon chips "visto na lista do cupom: <title> (até <validade>)" plus "pedido mínimo R$ X" when `priceCents < minPaymentCents`, link "Ver no Mercado Livre" (new tab), `StatusButtons` (copied).
- `PATCH /api/items/[id]` (in `withApi`) sets status.

**Step 6:** Open `/` with the Playwright MCP: snapshot with real data, try every filter and sort, check the URL updates, and check text-not-color labels.

**Checkpoint 3:** typecheck, lint, tests pass. Give Fernando:

```
git -C ~/projetos/promo-cps add -A && git -C ~/projetos/promo-cps commit -m "feat: card reader, discovery, real-drop badge, Ofertas"
```

---

## Task 17: Buscas repository, step and API

**Files:** Create: `src/db/searches.ts`, `src/ingestion/steps/buscas.ts`, `src/ingestion/ml/product.ts`, `src/ingestion/ml/product.test.ts`, `src/app/api/searches/route.ts`, `src/app/api/searches/[id]/route.ts`, `src/app/api/searches/[id]/run/route.ts`, `src/lib/validation.ts`

**Step 1:** `src/db/searches.ts`: copy olxmapper's (list, get, create, update, delete, `listEnabledSearches`, `recordRun`), adapted to the `searches` columns here (`kind`, no `sourceSite`).

**Step 2:** `src/lib/validation.ts`: zod schemas for create/update: `name` 1-80 chars, `url` refined with `classifyMlUrl` (error message `INVALID_ML_URL`), `runEveryHours` in `[1, 3, 6, 12, 24]` (olxmapper's options, all below `STALE_AFTER_HOURS`), `enabled` boolean.

**Step 3:** Product reader (`product.ts` + test against `__fixtures__/product-page.json`): returns one `ObservedCard` from a product page, using the paths recorded in Task 7. Key the item as Task 7 decided. Also tighten product URL detection in `src/lib/ml-url.ts` to the captured shapes (an anchored catalog path such as `/^\/(?:[^/]+\/)?p\/MLB\d+$/`, item paths on the produto host, and any `/up/MLBU...` shape the capture shows), with tests.

**Step 4:** `runDueBuscas(page, now)`: enabled searches due by olxmapper's `searchDueAt`; `search` kind reads `SEARCH_PAGES` pages (`loadWithRetry` through the shared `loadBreaker`, then `readSearchPage(pageProps, searchUrl)`: `cardsOfResults` over the direct `results[].polycard` children of `getResultsPromise.value.(optimizedResponse|sharedState.search)` and of `initialState` (store pages and coupon containers); page 2 URL taken only from the page's own `pagination.next_page` when `show`, through `safeMlUrl` and pinned to the Busca's host, never built); `product` kind reads the product page (`readProductPage`: item id from `history.id`, category and domain from the tracking event, url pinned with `pdp_filters=item_id:<id>`). `recordObservations(cards, { type: 'search', id, url }, now)`; `recordRun` per search. Replace the Task 15 stub. Single-Busca runs (`POST /api/searches/[id]/run`) go through `serialized` with a `search` run row.

**Decided in the 2026-11-02 Task 17 review:** Busca pages come out of the discovery budget (`discover(page, max(0, DISCOVERY_PAGES_PER_RUN - buscaPages), now)`), so a cycle stays at about the harvest plus 300 pages however many Buscas exist. The search reader also reads `initialState.results` (store pages and coupon containers keep results there; it also covers ML turning streaming off) and takes only direct `results[].polycard` children (shared `cardsOfResults` with `cardsOfPage`). Links for a search source are written only if the Busca row still exists with the URL that was read (`FOR SHARE` inside the record transaction); `deleteSearch` deletes the row first; `recordRun` matches the URL read. A duplicate Busca URL is rejected (409). `recordedRun(kind, body)` is the shared run wrapper for cycles and Busca runs; `recordSearchRun(read)` is the entry Task 19's Busca-only ticks reuse. `updateSearch` locks the row `FOR UPDATE`, and a URL change clears its links and resets `lastRunAt`, `lastStatus` and `lastError` (due at once). `recordStop` records a stop's status and error without moving `lastRunAt` (Task 18 shows it). `stoppedSince` skips a single run queued before a `blocked` or `session_expired` run.

**Step 5:** Routes (all mutating ones in `withApi`): `GET/POST /api/searches`, `PATCH/DELETE /api/searches/[id]` (DELETE also removes the Busca's `item_sources` rows: `source_type = 'search' AND source_id = id`), `POST /api/searches/[id]/run` (202).

---

## Task 18: Buscas page

**Files:** Create: `src/app/buscas/page.tsx`, `src/app/buscas/SearchAdmin.tsx`

**Step 1:** Copy olxmapper's `src/app/searches/page.tsx` and `SearchAdmin.tsx`: form with Nome and URL ("Cole a URL de uma busca do Mercado Livre com seus filtros, ou de um produto"), per-Busca card with kind label (Busca / Produto), Ativa toggle, "A cada" select, "Rodar agora", last status and error, Excluir. Drop the site-detection and platform probing. Each card links to `/?busca=<id>`.

Also label the Busca run counts in `RunsList` (`runCountItems` returns nothing for `search` runs today; the keys are `buscaReads`, `buscaPages`, `buscaItems`, `buscaFailed`, `buscaDropped` in `CYCLE_COUNT`, and a `search` run row carries its own status, pages and error). The single-Busca "Rodar agora" posts `{ confirm: true }` to `POST /api/searches/[id]/run` and shows `buscaActivity(id)` (queued / running).

**Step 2:** Playwright MCP (local pages only): add a search Busca and a product Busca through the form, snapshot, check Ofertas filtered by one. Agents never press a Busca's "Rodar agora" (it loads ML); Fernando runs the first one.

**Checkpoint 4:** typecheck, lint, tests pass. Give Fernando:

```
git -C ~/projetos/promo-cps add -A && git -C ~/projetos/promo-cps commit -m "feat: Buscas (search and product URLs)"
```

---

## Task 19: Scheduler

**Files:** Create: `src/ingestion/auto-run.ts` (runtime: `startAutoRunScheduler`, `autoRunStatus`, `replanAutoRun`, `__promoAutoRun`), `src/instrumentation.ts`, `src/lib/auto-run-view.ts` with its test, `src/ingestion/run-chain.test.ts`; Modify: `src/db/runs.ts` (`lastHeldAccountRun`), `src/lib/domain.ts` (`FIRST_CYCLE_TEXT`, `PLAN_FAILED_TEXT`, `BLOCKED_STATUS`), `src/lib/constants.ts` (`SCHEDULER_*`), `src/ingestion/schedule.ts` and its test (pure: `tickAction`, `schedulerPlan`, `heldUntil`, `wakeDelay`, the hold rules), `src/ingestion/run-chain.ts` (`chainIdle`), `src/ingestion/search-run.ts` (`runDueBuscasTick`), `src/ingestion/cycle.ts`, `src/ingestion/login.ts`, the searches routes, `src/app/conta/page.tsx`.

**Decided in the 2026-11-02 Task 19 review:** the scheduler never queues behind other work: it wakes, and only when the serialized chain is idle (`chainIdle()`) does it read its inputs and start its run synchronously, so a pause set by a login, verify or manual run it would have waited behind is always seen. A planning failure retries `plan()` in 10 minutes and Conta shows it. Holds: for 30 minutes after a tick ends (successful, failed or throwing), anything already due when it ended waits (work it left overdue, a cycle that came due during it, a Busca added or re-pointed meanwhile); a cycle that comes due after the tick ended is never delayed. After a held cycle or search run (`blocked`, or `failed` by the load breaker, marked `counts.loadBreaker = 1`) newer than the latest worked run, everything waits until that run's end plus `RUN_EVERY_HOURS` (derived from the database, so a restart does not probe the wall a minute later). `tick()` re-applies the holds to its fresh inputs, the same rule `wake()` uses. Fernando can always press a Busca's own Rodar agora.

**Step 1: failing tests** for `cycleDueAt(lastCycleStartedAt, everyHours)` and olxmapper's `searchDueAt`/`nextAutoRunAt` (copy olxmapper's schedule tests for the latter).

**Pause rule** (decided by the pure, tested `schedulerPause` in `schedule.ts`; the next run time by the pure `nextRunAt`): the scheduler does not start any run while the latest `login` run is `refused`, or the latest non-login run (cycle or Busca) is `session_expired`, until a later login run is `logged_in` or a later cycle ends `ok` or `partial` (proof that the session works, e.g. after a manual Rodar agora). Every logged-out preflight would otherwise be another login attempt against ML. Conta shows the pause and its reason.

**Step 2:** Copy olxmapper's `schedule.ts` with these changes: the plan reads the last `cycle` run's `startedAt` and the enabled searches; `nextRunAt` = the earliest of `cycleDueAt` and every `searchDueAt`; a tick runs `requestCycle()` when the cycle is due, else, only when at least one Busca is due (select them BEFORE launching Chrome, so an empty tick launches nothing and writes no run row), runs `serialized(() => recordSearchRun(runDueBuscas))` + `afterRun` (drops are recomputed inside `recordObservations`). Call `schedulerPause(latestLogin, lastWorkedCycleRun(), lastExpiredAccountRun())` (`src/db/runs.ts`: the latest `ok`/`partial` CYCLE, since only a cycle's harvest needs the login and a Busca can read search pages logged out, and the latest `session_expired` run of any kind; decided in the final review), the same inputs `loginDisplay` gets through `accountRuns`; `lastWorkedAccountRun()` (cycle or Busca) feeds only the blocked-run hold, so the UI and the scheduler always agree. A `session_expired` pause lifts only on a later `logged_in` login or a later worked run; a later failed or blocked run never lifts it, and an earlier worked run is not hidden by a later failure. Kill switch `env().AUTO_RUN === 'off'`. Global handle `__promoAutoRun`. Replan after every run and every Busca change: call `replanAutoRun()` from `POST /api/searches`, `PATCH`/`DELETE /api/searches/[id]` and after `requestBuscaRun` and `requestCycle` settle (Task 17 left these call sites for this task).

**First cycle is manual (decided 2026-11-02):** `AUTO_RUN` defaults to `on` and `cycleDueAt(null)` is now, so a scheduler that trusted that would launch a full cycle the moment the server starts, before Fernando has ever pressed Rodar agora. The scheduler therefore starts nothing (no cycle, no Busca tick) until at least one cycle run has finished `ok` or `partial`; until then Conta shows the reason ("Rode o primeiro ciclo com Rodar agora para ligar a execução automática"). This lives in the pure `schedulerPlan` (not `schedulerPause`, whose result `loginDisplay` compares with the session text), with tests; the first-cycle text wins over other pauses.

**Step 3:** `src/instrumentation.ts`: olxmapper's, starting only the scheduler, behind the `NEXT_RUNTIME === 'nodejs'` guard (the scheduler pulls in `node:child_process` through Xvfb).

**Step 4:** On the running dev server (never `npm run build` while it runs: the build writes the same `.next`; the production build check is Task 21's, with the dev server stopped), the log shows `[auto-run] scheduler started` and the next due time or the pause reason. Conta shows the next run time from `autoRunStatus()` as an absolute time or with `relativeTime` (never `formatAgo`, which reads a future time as "agora").

---

## Task 20: Alerts and notifications

**Files:** Create: `src/db/alerts.ts`, `src/lib/desktop-notify.ts`, `src/lib/desktop-notify.test.ts`, `src/ingestion/after-run.ts`, `src/app/api/alerts/route.ts`, `src/app/api/alerts/[id]/route.ts`, `src/components/AlertButton.tsx`, `src/app/alertas/page.tsx`

`afterRun` replaces the private stub in `src/ingestion/cycle.ts` and is also called from `src/ingestion/search-run.ts` after a single-Busca run and after the scheduler's Busca-only tick (`runDueBuscasTick`) (Task 17 left both call sites for this task). Alert hits are built with `dealWhere` from `src/db/deals.ts` (Task 16), the single shared condition builder.

**Decided in the 2026-11-02 Task 20 review:** the "no hit at a price <= current" rule lives in `ON CONFLICT (alert_id, item_id) DO UPDATE ... WHERE alert_hits.price_cents > excluded.price_cents RETURNING` (Postgres returns only rows inserted or updated, so a skipped conflict is never announced; a strictly lower price re-announces), and the per-alert loop runs in one transaction. A view that already has an alert is rejected (409 `duplicate_query`); a view with an unknown or deleted Busca is rejected (422 `busca_not_found`), never saved without it. `afterRun` runs after `finishRun` on a private promise queue, so the serialized chain is never held by notifications, and it collects digests for EVERY finished cycle or search run whatever its status (the hits prevent repeats, so offers seen in a failed, blocked or expired run are still announced). Re-alerts stay limited to the Novos tab (`NOT_SEEN`), as in olxmapper. The run counts do not include "alerts sent" (digests are sent after the run row is finished).

**Step 1: failing tests** `desktop-notify.test.ts` (copy olxmapper's, adapted): title `"3 novas ofertas: notebooks"` / `"1 nova oferta: notebooks"`, body lines `"R$ 4.588 (47% OFF): Notebook Acer..."`, "e mais N" line, markup escaping, args `['--app-name=Promo CPS', '--action=default=Abrir', '--wait', '--', title, body]` (the `--` keeps a body starting with `-` from being read as an option). Session notification: title `"Promo CPS: sessão do Mercado Livre expirada"` / `"...: acesso bloqueado pelo Mercado Livre"` / `"...: o ciclo falhou"`, body = run error, Abrir opens `<baseUrl>/conta`.

**Step 2:** `src/lib/desktop-notify.ts`: copy olxmapper's (`spawn('notify-send', ...)`, xdg-open on `default`), generalized to `{ title, body, url }`.

**Step 3:** `src/db/alerts.ts`:
- `listAlerts()`, `createAlert({ name, query })`, `deleteAlert(id)`.
- `collectDigests(observedSince: Date)`: for each alert in creation order, read its filters with `dealFiltersFromParams(searchParamsToRecord(new URLSearchParams(alert.query)))`. Matching offers (`ml_discount_pct > 0 OR drop_ratio > 0`, tab NOT_SEEN, observed since the run start) are hit-filtered and recorded in ONE SQL statement (`INSERT INTO alert_hits ... SELECT ... WHERE no hit at a price <= current ... ON CONFLICT (alert_id, item_id) DO UPDATE ... RETURNING`), with no row limit, so no match is ever announced twice or miscounted. Items already announced by an earlier alert this run are left out of this digest but their hit is still recorded. Digests with count 0 are skipped. The URL is built at send time from `http://127.0.0.1:${env().PORT}` plus `/?` plus the stored query (`alerts.base_url` is removed). The alert name is capped (e.g. 60 chars) because it goes into the title.

**Step 4:** `src/ingestion/after-run.ts` `afterRun(run)`: if the run status is `session_expired`, `blocked` or `failed` and the previous run OF THE SAME KIND had a different status, send the session notification, worded by kind via `sessionNotification(run)` (a failed Busca-only run says "a busca falhou"). For every finished cycle or search run, whatever its status, send one notification per digest from `collectDigests(run.startedAt)`. Every notification failure is logged, never thrown. The base URL is `http://127.0.0.1:${env().PORT}`.

**Step 5:** API (mutating routes in `withApi`): `GET/POST /api/alerts` (POST body `{ name, query }`, `query` re-normalized server-side), `DELETE /api/alerts/[id]`. `AlertButton` on Ofertas (from olxmapper's): "Alertar" opens a name input and saves the current view; shows "Alerta ativo: <nome>" when the normalized view equals an existing alert. `/alertas` lists alerts (name, filters as chips, created, "Abrir" link, Excluir).

**Step 6:** Verify: save an alert, run a cycle, receive one desktop notification, click Abrir: the view opens. A second cycle at the same prices sends nothing. Snapshot `/alertas`.

---

## Task 22: Cupons filters and sort (added 2026-11-02)

Design: `docs/plans/2026-11-02-cupons-filters-design.md` ("The number" and "Cupons filters and sort").

**Files:** Create: `src/lib/coupon-value.ts` with its test (pure: `discountAtMinimum`, `fullPercentUpTo`, `isUncapped`); Modify: `src/db/coupons.ts` (the SQL expression, the new filter conditions, the sort orders), `src/lib/coupon-query.ts` and its test (new params, `couponHref`), `src/lib/labels.ts`, `src/lib/constants.ts` (`UNCAPPED_FROM_CENTS = 10_000_000`, `COUPON_TEXT_MAX = 80`), `src/components/CouponRow.tsx`, `src/app/cupons/page.tsx`.

**Step 1:** Pure `discountAtMinimum(kind, percentOff, amountOffCents, minPaymentCents, capCents)` returns a 0..1 ratio or null, per the design; tests for every edge (null or 0 minimum, minimum below the value, cap below percent x minimum, unparsed, uncapped).

**Step 2:** The same formula as one SQL expression in `src/db/coupons.ts`, used by the `descontoMin` filter and the `desconto` sort. A test renders the SQL; a table test feeds the same rows to the pure function and checks the order the SQL sort would give.

**Step 3:** Params `minimoMax`, `limiteMin`, `descontoMin`, `comOfertas`, `q`, `ordem` in `coupon-query.ts` (parse, canonical `couponHref`, tests). `q` uses ILIKE on title and scope label with `%`, `_` and `\` escaped. `comOfertas` reuses the linked-offers subquery.

**Step 4:** UI: the new filters and the sort select on `/cupons` (olxmapper's pill and popover pattern from the Ofertas `FilterBar`); `CouponRow` shows "Desconto na compra minima: NN%", "rende ate R$ X" for percent coupons, and "sem limite". Snapshot at 1280 and 320 px.

---

## Task 23: Offers for a coupon set and Priorizar no proximo ciclo (added 2026-11-02)

Design: `docs/plans/2026-11-02-cupons-filters-design.md` ("Offers for a coupon set", "Priorizar no proximo ciclo").

**Files:** Create: `drizzle/0002_*.sql` (`coupons.discovery_priority_at timestamptz null`), `src/app/api/coupons/priority/route.ts` with its test; Modify: `src/db/schema.ts`, `src/db/coupons.ts` (export the coupon condition builder for reuse; `prioritizeCoupons(filters, now)`; the rotation fields), `src/lib/coupon-order.ts` and its test (pending-priority first), `src/db/deals.ts` (`cupons` in `filterWhere`), `src/lib/deal-query.ts` and its test (`cupons` param, alert key, nested normalization), `src/lib/filter-labels.ts`, `src/components/FilterBar.tsx`, `src/app/cupons/page.tsx`, `src/components/CouponRow.tsx` ("Prioridade" badge).

**Step 1:** Ofertas `cupons` filter: one `EXISTS` over fresh coupon links joined to LIVE coupons matching the nested coupon filters (same builder as Cupons). Tests: canonical href, alert normalization, empty and unparsable values.

**Step 2:** Migration 0002 with `npm run db:generate` and `npm run db:migrate`, applied only while no cycle or Busca runs. `prioritizeCoupons` sets `discovery_priority_at` on matching live coupons with a listing and returns the count. The rotation puts pending-priority coupons first, per the design; pure tests.

**Step 2b (added after the first cycle):** `loginDisplay` shows the session as working ("Sessão ativa", detail "o último ciclo leu o Mercado Livre com a sessão salva") when no login is in progress, no login run is recorded or the last one is older, and the latest worked run is newer than any expired one; today a session that predates login recording reads "Não iniciado" even right after a successful cycle. Pure, tested; the header chip and Conta both use it.

**Decided in the 2026-11-02 Task 23 review:** both actions show only when a coupon filter is active (and not for `status=encerrado`); the route rejects a query with no coupon filters (422), so nothing ever prioritizes every coupon. `schedulerPause` lets a later `session_expired` pause after a refused login that a worked run had already lifted (a Task 19 gap). A finished in-memory login never hides "Sessão ativa" when a worked run came after it.

**Step 3:** UI: "Ver ofertas destes cupons" link and "Priorizar no proximo ciclo" button on `/cupons`, with the confirmation text (count, next cycle time from `autoRunStatus()` or the first-cycle text). The Ofertas chip for `cupons`. Snapshots; never press anything that loads ML.

---

## Task 24: Economia total com cupom on Ofertas (added 2026-11-02)

Design: `docs/plans/2026-11-02-cupons-filters-design.md`, "Total saving with coupons applied, on Ofertas".

**Files:** Create: `drizzle/0003_*.sql` (three hint columns), `src/lib/deal-saving.ts` with its test (pure `finalPriceCents`, `referencePriceCents`, `totalSaving`, `parseHintText`), a one-off backfill script run once and deleted; Modify: `src/db/schema.ts`, `src/db/items.ts` (write the hint numbers), `src/db/deals.ts` (the final-price and saving SQL, sorts, filters), `src/lib/deal-query.ts` and its test (`economiaMin`, `economiaReaisMin`, sorts `economia`, `economiaReais`, alert keys), `src/lib/filter-labels.ts`, `src/lib/labels.ts`, `src/components/FilterBar.tsx`, `src/components/DealCard.tsx`, `src/lib/deal-view.ts`.

**As built (2026-11-02, after review):** a card hint never makes an estimate, so migration 0003 added three hint-number columns and 0004 dropped them again (no backfill remains, no `parseHintText`). `finalPrice(item, coupons)` in `src/lib/deal-saving.ts` returns `{ cents, estimated }`; the SQL lives in `src/db/saving.ts` (the best linked coupon is computed once per row through a `select ... offset 0` subquery, pinned by tests). The saving percent shows one decimal (`formatPercentOneDecimal`), and `economiaMin` uses `savingThresholdRatio`, one exact integer division, so the filter matches the card at every boundary. Alerts treat any item with a saving as an offer. The pure-vs-SQL order was checked against the live pages: 13,812 rows in both sorts, 0 order breaks; 31 filter counts matched.

**Step 1:** Pure functions per the design, with tests for every case and edge (no list price, list below final, a coupon below its minimum, a fixed coupon above the price, a percent above its limit, a hint without numbers, several linked coupons).

**Step 2:** Migration 0003 and the write path in `upsertItems`; backfill the existing rows from `coupon_hint` text with `parseHintText`, only while no cycle or Busca runs.

**Step 3:** The same final price as one SQL expression in `src/db/deals.ts` (a correlated best-coupon subquery over fresh links to live coupons), used by the new sorts and filters; a render test plus a pure-vs-SQL order check on sample rows.

**Step 4:** UI: the card line and "estimado" marker, the two sorts, the two filters (FilterBar pills), the chips. Snapshots; never press anything that loads ML or changes item status.

---

## Task 21: README and final verification

**Files:** Create: `README.md`; Modify: `.env.example`

**Step 1:** README mirroring olxmapper's: what it does, requirements (Node 22.13.1, Postgres 16, Xvfb, system Google Chrome), setup (Task 0 commands, `npm install`, `npm run db:migrate`, `npm run build && npm start`), first login from Conta, config table (from the design), how a cycle works, alerts, known limitations (from the design), `ml:capture`.

**Step 2:** Final checks, all must pass, with output quoted in the report: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`. One real cycle from Conta ends `ok` or `partial` with counts. Playwright MCP snapshot of every page: `/`, `/cupons`, `/buscas`, `/alertas`, `/conta`.

**Step 3:** Ask the `superpowers:code-reviewer` agent to review the whole implementation against this plan and the design; fix what it confirms.

**Checkpoint 5:** Give Fernando:

```
git -C ~/projetos/promo-cps add -A && git -C ~/projetos/promo-cps commit -m "feat: scheduler, alerts, README"
```

---

## Done criteria

- A cycle harvests every coupon (complete harvest counted against ML's total), activates up to `ACTIVATE_PER_RUN`, reads due Buscas and up to `DISCOVERY_PAGES_PER_RUN` coupon listings, and records its status and counts.
- Ofertas lists deals by ML discount with basis text, real-drop badges, filters and pagination, all server-side.
- Cupons lists every coupon with status, terms from the list entry and links.
- A saved alert produces one desktop digest per run with new or cheaper offers; an expired session produces one notification and a banner.
- All checks in Task 21 pass.
