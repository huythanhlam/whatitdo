# Quickstart

The app is fully built **and runs with zero credentials.**

## Run it right now (no accounts, no keys)

```bash
npm run dev
```

Then seed it with real Austin events and open the site:

```bash
curl -X POST http://localhost:3000/api/ingest   # scans sources + tags events
open http://localhost:3000
```

With no Supabase configured, the app uses an embedded in-memory Postgres
(PGlite) and a built-in seed of real Austin venues, so search, category
filters, event detail pages, subscriptions, and featured listings all work
immediately. Event tagging uses keyword matching (no Gemini key needed).
Re-run the `curl` after a restart to re-seed.

### Import events from an influencer post or aggregator page

`POST /api/import` crawls a page (or pasted post text) and extracts every
upcoming event it finds. Useful for influencer / "things to do in Austin"
accounts that share events. **Requires `GEMINI_API_KEY`** (it reads free text).

```bash
# Crawl a public aggregator / link-in-bio page:
curl -X POST http://localhost:3000/api/import \
  -H 'content-type: application/json' \
  -d '{"url":"https://365thingsaustin.com/"}'

# Or paste a caption from a login-walled post (Instagram, TikTok, Facebook):
curl -X POST http://localhost:3000/api/import \
  -H 'content-type: application/json' \
  -d '{"text":"📅 Sat July 4, 8pm — Indie Night @ Mohawk Austin, $15. Tickets in bio!"}'
```

The pasted-text path is the bridge for platforms that block server-side
fetching: copy the post text yourself and import the events from it. Pages
listed in `CRAWL_URLS` are also crawled automatically on each scheduled ingest.

---

## Going to production (your accounts)

For a real deployment with a persistent database and live email, do the below.

## 1. Create the database (required)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project** (free tier is fine).
2. When it's ready, open **Settings → Database → Connection pooling** and copy the
   **URI** (the Supavisor pooler connection string) → `DATABASE_URL`.
3. Paste it into [`.env.local`](.env.local).

> Skip this whole file if you just want to try the app: with no `DATABASE_URL`
> set, it runs on an embedded PGlite database with seed data and zero credentials.

## 2. Create the tables (required)

Apply the migrations to your Supabase database:

```bash
npm run migrate
```

This runs every file in `supabase/migrations/` against `DATABASE_URL`, creating
the `events`, `categories`, `subscriptions`, and `featured_listings` tables, plus
the full-text search index and row-level-security policies. It is idempotent —
re-running only applies migrations that haven't been applied yet.

## 3. (Optional) Add the other keys

The app already works without these — events come from free sources (City of
Austin iCal + Chronicle/Do512 scrapers) and tagging falls back to keyword
matching. Add them when you want the upgrades:

- `GEMINI_API_KEY` — smarter AI tagging **and** unlocks the newspaper + social
  media sources (local papers like KUT, Austin Monitor, Daily Texan, Eater and
  feeds like Reddit r/AustinEvents / Bluesky publish prose, so Gemini is used to
  extract concrete upcoming events from them; without a key these sources are
  skipped to keep the database clean). Free: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- `NEWSPAPER_FEEDS` — _optional_, add more RSS feeds without a code change:
  `"https://site/feed|newspaper:my-source,https://other/rss|newspaper:other"`
- `YOUTUBE_API_KEY` — adds YouTube as a source (searches local event videos /
  livestream premieres; needs `GEMINI_API_KEY` to extract events from them).
  Free quota: [console.cloud.google.com](https://console.cloud.google.com) → YouTube Data API v3
- `CRAWL_URLS` — _optional_, comma-separated pages to crawl for events each
  ingest (influencer link-in-bio pages, aggregator roundups). Needs
  `GEMINI_API_KEY`. e.g. `"https://365thingsaustin.com/,https://linktr.ee/someaustinpage"`
- `BROWSER_FETCH_URL` — _optional_, a headless-browser render service used as a
  **fallback only when a page is blocked or JS-rendered** (a plain fetch is tried
  first). Point it at a self-hosted [crawl4ai](https://github.com/unclecode/crawl4ai)
  server, Browserless, ScrapingBee, or a Vercel Sandbox worker. Contract: it
  receives `POST { "url": "..." }` and returns rendered HTML or markdown (the
  response is parsed flexibly — `{html}`, `{markdown}`, crawl4ai's
  `{results:[…]}`, or a raw body all work). Set `BROWSER_FETCH_TOKEN` if the
  service needs a bearer token. Note: this defeats JS-render / Cloudflare-style
  blocks; hard **IP blocks** additionally need the service to run behind a proxy.
- `EVENTBRITE_TOKEN` — adds Eventbrite as a source. [eventbrite.com/platform/api](https://www.eventbrite.com/platform/api)
- `TICKETMASTER_API_KEY` — image-rich live events. Free: [developer.ticketmaster.com](https://developer.ticketmaster.com)
- `SEATGEEK_CLIENT_ID` — events with performer images. Free: [seatgeek.com/account/develop](https://seatgeek.com/account/develop)
- `RESEND_API_KEY` — actually send the email digests. [resend.com](https://resend.com)
- `CRON_SECRET` — any random string. Generate: `openssl rand -hex 32`

## 4. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — empty grid until you scan.

## 5. Scan for events (first run)

With `CRON_SECRET` set in `.env.local`, trigger the first ingest:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

You'll get `{"inserted": N, ...}`. Refresh the homepage — real Austin events,
tagged, searchable, and filterable by category.

## 6. Deploy (automatic daily scanning)

```bash
npm i -g vercel
vercel deploy
```

Add the same env vars in the Vercel dashboard. The crons in
[`vercel.json`](vercel.json) then run the daily scan (6am) and email digest
(8am) automatically — no further action needed.

---

**Want me to do steps 2 & 5 for you?** Paste your Supabase keys into `.env.local`,
say "go", and I'll verify the tables and run the first scan live.
