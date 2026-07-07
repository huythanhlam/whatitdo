# What It Do ATX

An Austin events aggregator built on Next.js 16 (App Router, React 19). It
ingests events daily from many sources (Eventbrite, City of Austin iCal,
Ticketmaster/SeatGeek, local newspaper RSS, social, YouTube, and a Gemini-powered
page crawler), tags and de-dupes them, and serves a filterable/searchable grid +
calendar with email digests and paid featured listings.

**It runs with zero credentials** — no accounts, no keys — thanks to an embedded
in-memory Postgres (PGlite) seeded with real Austin events.

## Run it right now (no accounts, no keys)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With no `DATABASE_URL`
configured the app uses embedded PGlite + a built-in seed, so search, category
filters, event detail pages, subscriptions, calendar, and featured listings all
work immediately. Tagging falls back to keyword matching (no Gemini key needed).

Pull in more live events on demand:

```bash
curl -X POST http://localhost:3000/api/ingest   # scans sources + tags events (dev auth is open)
```

### Import from an influencer post or aggregator page

`POST /api/import` crawls a page (or pasted post text) and extracts every
upcoming event it finds. **Requires `GEMINI_API_KEY`** (it reads free text).

```bash
# Crawl a public aggregator / link-in-bio page:
curl -X POST http://localhost:3000/api/import \
  -H 'content-type: application/json' -d '{"url":"https://365thingsaustin.com/"}'

# Or paste a caption from a login-walled post:
curl -X POST http://localhost:3000/api/import \
  -H 'content-type: application/json' \
  -d '{"text":"📅 Sat July 4, 8pm — Indie Night @ Mohawk Austin, $15. Tickets in bio!"}'
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm test` | Run the Vitest suite (pure fns, fixture parsers, PGlite integration) |
| `npm run lint` | ESLint |
| `npm run migrate` | Apply `supabase/migrations/*` to `DATABASE_URL` (prod DB) |

## Going to production

### 1. Database (required)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) (free tier is fine).
2. **Settings → Database → Connection pooling** → copy the **URI** (the Supavisor
   pooler string) → set it as `DATABASE_URL` in `.env.local`.
3. Apply the schema:

   ```bash
   npm run migrate
   ```

   Runs every file in `supabase/migrations/` against `DATABASE_URL` (idempotent,
   tracked in a `_migrations` ledger). When `DATABASE_URL` is unset the app just
   uses PGlite and needs no migration step.

### 2. Optional keys

Everything above works without these; add them to unlock more:

- `GEMINI_API_KEY` — smarter AI tagging **and** unlocks the newspaper/social/
  YouTube/crawler sources (they publish prose, so Gemini extracts concrete
  events). Free: [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
  Free-tier request limits are enforced centrally — tune with
  `GEMINI_DAILY_BUDGET` / `GEMINI_RPM`.
- `TICKETMASTER_API_KEY`, `SEATGEEK_CLIENT_ID`, `YOUTUBE_API_KEY` — additional
  event sources (each is skipped, and recorded as such in `/api/admin/health`,
  when its key is absent).
- `NEWSPAPER_FEEDS`, `CRAWL_URLS` — add RSS feeds / pages to crawl without code
  changes.
- `BROWSER_FETCH_URL` / `BROWSER_FETCH_TOKEN` — headless-render fallback for
  JS-heavy/blocked pages.
- `RESEND_API_KEY` + `EMAIL_FROM` — actually send the email digests.
- `CRON_SECRET` — **required in production**; guards the ingest/import/featured/
  digest/health routes (they refuse to run without it). Generate:
  `openssl rand -hex 32`. Vercel Cron sends it automatically once set.
- `SITE_URL` — canonical public origin for email/OG links.

See [`.env.example`](.env.example) for the full annotated list.

### 3. Deploy

```bash
npm i -g vercel && vercel deploy
```

Add the same env vars in the Vercel dashboard. The crons in
[`vercel.json`](vercel.json) then run the daily scan (6am), daily digest (8am),
and weekly digest (Mon 2pm) automatically.

**Migrations on deploy.** Postgres does not auto-migrate at runtime, so schema
changes must reach the shared DB before the code that needs them. CI applies them
for you: on every push to `main`, the `migrate` job in
[`ci.yml`](.github/workflows/ci.yml) runs `npm run migrate` — add a `DATABASE_URL`
repo secret (the Supabase pooler string) under **Settings → Secrets and variables
→ Actions** to enable it. Until that secret is set the step no-ops. Preview
deployments query the same DB, so a branch that adds a migration only previews
correctly once its migration is on the DB (run `npm run migrate` locally, or merge
to `main`).

## Observability

`GET /api/admin/health` (auth'd) returns the last runs per source and flags any
source that has gone `stale` (repeated errors/zero-events after previously
producing). Each ingest run records status, counts, and Gemini usage per source
in the `source_runs` ledger.

## Tests & CI

`npm test` runs three tiers: pure-function unit tests, fixture-based
source-parser tests (asserting no fabricated dates), and full PGlite-backed
integration tests (ingest → list → detail; subscribe → list → unsubscribe) with
zero external services. GitHub Actions runs `lint → tsc → test → build` on every
PR and on `main` (`.github/workflows/ci.yml`).

## Architecture notes

- **RSC-with-direct-DB fetching** — pages query the database in Server
  Components (`app/page.tsx`); no client fetch waterfall.
- **URL-as-state filters** — search, categories, date range, view, and calendar
  month all live in query params, so every view is shareable and server-rendered.
- **One query layer** — `lib/db` runs raw SQL over a `Db` driver seam: a `pg`
  Pool (Supabase pooler) in prod, embedded PGlite locally. The same
  `supabase/migrations/*` are the single schema truth for both.
- This is a modified Next.js 16 build; breaking-change guides ship in
  `node_modules/next/dist/docs/` — read them before changing framework code (see
  [`AGENTS.md`](AGENTS.md)).
