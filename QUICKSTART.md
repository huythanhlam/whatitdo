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

---

## Going to production (your accounts)

For a real deployment with a persistent database and live email, do the below.

## 1. Create the database (required)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project** (free tier is fine).
2. When it's ready, open **Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`
3. Paste all three into [`.env.local`](.env.local).

## 2. Create the tables (required)

In the Supabase dashboard → **SQL Editor** → **New query**, paste the entire
contents of [`supabase/all_migrations.sql`](supabase/all_migrations.sql) and click **Run**.

This creates the `events`, `categories`, `subscriptions`, and `featured_listings`
tables, plus the full-text search index and row-level-security policies.

## 3. (Optional) Add the other keys

The app already works without these — events come from free sources (City of
Austin iCal + Chronicle/Do512 scrapers) and tagging falls back to keyword
matching. Add them when you want the upgrades:

- `GEMINI_API_KEY` — smarter AI tagging. Free: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- `EVENTBRITE_TOKEN` — adds Eventbrite as a source. [eventbrite.com/platform/api](https://www.eventbrite.com/platform/api)
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
