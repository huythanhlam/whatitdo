# Product Spec — The Most Complete Events App in Texas

*Companion to [CODEBASE-REVIEW.md](./CODEBASE-REVIEW.md) (findings) and [SIMPLIFICATION-SPEC.md](./SIMPLIFICATION-SPEC.md) (the streamlining that makes this spec buildable). This document covers: comprehensive Austin coverage, cross-source deduplication, multi-city scaling, differentiation, economics, and the phased roadmap.*

## Thesis: win the long tail

Ticketmaster and Eventbrite already cover big events. Do512 and the Chronicle cover the middle. The winnable game is **completeness of the long tail** — the church fish fry, the Saturday run club, the neighborhood association meeting, the taco pop-up, the library story hour — which no competitor covers because it has never paid to hand-curate.

An LLM-extraction pipeline changes that economics: coverage becomes a **configuration problem instead of an engineering problem**. Every new source is a database row, not a parser. That is the moat, and this codebase already prototypes it (`lib/scrapers/crawler.ts` + `/api/import`). This spec systematizes it.

**Positioning sentence:** *every event in your city, large and small, in one place — searchable, deduplicated, and delivered to your inbox.*

---

## 1. Comprehensive Austin coverage

### 1.1 Source tier taxonomy

| Tier | What | Examples | Mechanism | Reliability |
| --- | --- | --- | --- | --- |
| **T1** Big-ticketed | Arena/theater/festival inventory | Ticketmaster, SeatGeek, Eventbrite | Official APIs / JSON-LD | High, structured |
| **T2** Institutional | Government & civic calendars | austintexas.gov, Austin Public Library, Parks & Rec, ACC, UT Austin | iCal + RSS | High, structured |
| **T3** Venue-direct | The ~50 venues that define Austin nightlife & culture | Mohawk, Continental Club, Paramount, Antone's, Cap City Comedy, breweries, galleries | Crawler: JSON-LD first, Gemini extraction fallback | Medium |
| **T4** Community long tail | Everything nobody else lists | churches, run clubs, farmers markets, Meetup pages, neighborhood associations, Reddit/Bluesky posts | Gemini crawler + user submissions | Low per source, **decisive in aggregate — the moat** |
| **T5** Media roundups | Curated "what to do" coverage | Austin Chronicle, Do512, KUT, Austin Monitor, 365 Things Austin | Gemini crawl of listing pages | Medium; doubles as a **discovery feed for new T3/T4 sources** |

Rule of thumb: T1–T2 are table stakes (structured, no LLM cost). T3 makes the app *feel* complete to a local. T4 makes it *actually* complete — and is the tier no competitor will chase source-by-source.

### 1.2 Config-driven sources: the `sources` table

**Decision:** ingestion is driven by a database table, not hardcoded lists. Adding coverage = an `INSERT`, not a pull request. Code holds *mechanisms* (the `SourceAdapter` registry from SIMPLIFICATION §2); the database holds *instances*.

```sql
CREATE TABLE sources (
  id           SERIAL PRIMARY KEY,
  city_id      INT NOT NULL REFERENCES cities(id),
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,      -- 'api' | 'ical' | 'rss' | 'jsonld' | 'crawl'
  url          TEXT,               -- null for env-configured API kinds
  parser       TEXT NOT NULL,      -- adapter name in the code registry
  cadence      TEXT NOT NULL DEFAULT 'daily',   -- 'daily' | 'weekly'
  enabled      BOOLEAN NOT NULL DEFAULT true,
  last_success TIMESTAMPTZ,
  content_hash TEXT,               -- skip Gemini when page unchanged (§6)
  notes        TEXT
);
```

The ingest orchestrator reads enabled sources for each city and dispatches by `parser` to the adapter registry. `source_runs.source` (SIMPLIFICATION §2) becomes a `source_id` FK. The seed migration inserts today's 11 sources plus the first ~50 Austin venue calendar URLs.

T5 as source discovery: when a media roundup or an approved user submission references a venue/organizer page not yet in `sources`, the pipeline logs it as a *suggested source* for one-click ops approval — coverage compounds.

## 2. Cross-source deduplication & canonicalization

The biggest data-quality fix (CODEBASE-REVIEW D1): today the same concert appears once per source. Design: **dedup at persist time, blocking + scoring, provenance preserved.**

### 2.1 Schema: canonical events + provenance

Events become canonical records; per-source identity moves to a join table:

```sql
CREATE TABLE event_sources (
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  source_id   INT REFERENCES sources(id),
  external_id TEXT,
  url         TEXT,                 -- source-specific page / ticket link
  raw         JSONB,                -- payload as extracted (audit + re-merge)
  ingested_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_id, source_id, external_id)
);

-- events loses UNIQUE(source, source_id); gains normalized match keys:
--   title_norm TEXT, venue_norm TEXT   (set at persist time)
CREATE INDEX events_dedup_block ON events (city_id, (start_time::date), venue_norm);
CREATE INDEX events_title_trgm  ON events USING GIN (title_norm gin_trgm_ops);
```

### 2.2 Matching algorithm (a `persist.ts` pipeline stage)

1. **Block:** candidates = same city, `start_time` within ±2 h (same date for all-day events), and `venue_norm` equal *or* either venue null.
2. **Score:** `similarity(title_norm, candidate.title_norm)` via `pg_trgm`. Match if ≥ 0.55 with venue agreement, or ≥ 0.85 without. Normalization: lowercase; strip punctuation, "presents…", "live at X" suffixes; strip the venue name out of the title.
3. **Merge:** field-wise richest wins, tie-broken by source trust `api > ical > jsonld > crawl`: longest description, any image over none, `min(price_min)` / `max(price_max)`, `ticket_url` prefers the primary seller (Ticketmaster/venue) over aggregators.
4. **Provenance always:** every incoming record writes an `event_sources` row whether it matched or created — so the UI can render *"Tickets on Ticketmaster · also listed on Do512"*, which is itself a trust-building differentiator.

**Decision — trigram now, embeddings later:** `pg_trgm` is free, deterministic, and testable with fixtures. pgvector title-embeddings are a Phase 4 upgrade only if measured trigram precision fails (track false-merge/false-split counts in `source_runs`).

## 3. Multi-city: Austin → Houston → Dallas → San Antonio

### 3.1 Schema

```sql
CREATE TABLE cities (
  id       SERIAL PRIMARY KEY,
  slug     TEXT UNIQUE NOT NULL,   -- 'austin', 'houston', 'dallas', 'san-antonio'
  name     TEXT NOT NULL,
  state    TEXT NOT NULL DEFAULT 'TX',
  timezone TEXT NOT NULL,          -- all America/Chicago at TX launch; column anyway
  lat NUMERIC, lng NUMERIC,
  enabled  BOOLEAN NOT NULL DEFAULT false
);
-- city_id INT NOT NULL FK on: events, sources, subscriptions, featured_listings
```

**Migration path from today (zero downtime):**
1. One migration: create `cities`, seed Austin, add nullable `city_id` to the four tables, backfill to Austin, set `NOT NULL`.
2. Replace hardcoded `'Austin'` strings in source queries with the city row's parameters (geo for T1 APIs, URL sets for the rest).
3. Routing: an `app/[city]/` segment with `generateStaticParams` from enabled cities; `/` 301s to `/austin`. **All existing URL-as-state filter work carries over untouched** — it's query-param based, which is why it was worth preserving.
4. City-scoped everything: `/[city]/sitemap.xml`, digests filter `subscriptions.city_id`, ingest cron iterates enabled cities (split into per-city crons only when runtime approaches the 300 s cap).

### 3.2 New-city launch playbook (the point of all of the above)

> Insert city row → insert T1 API sources (city geo params) → insert T2 iCal/RSS URLs → seed ~30 venue crawl sources → run ingest → QA one week of data → flip `enabled`.

Target: **a new city live in under one day of ops work and zero code changes.** Houston is the proof of the playbook; Dallas and San Antonio are then pure repetition. The playbook doc lives next to this spec once Houston ships.

## 4. Differentiation features, ranked by effort → impact

| # | Feature | Effort | Impact |
| --- | --- | --- | --- |
| 1 | SEO foundation | S | XL |
| 2 | Programmatic SEO pages | S | L |
| 3 | Real full-text search | S | M |
| 4 | ICS export / add-to-calendar | S | M |
| 5 | User submissions | M | L |
| 6 | Price / free filters | S | M |
| 7 | Map view | M | M |
| 8 | Personalized digests | M | M |
| 9 | Semantic search (pgvector) | L | M |

1. **SEO foundation.** `generateMetadata` on every page; **per-event JSON-LD `Event` markup** — the app scrapes schema.org JSON-LD from Eventbrite but emits none of its own; closing that loop puts every listing in Google's event surfaces. Plus `sitemap.ts`, `robots.ts`, OG images, and caching: drop `force-dynamic`, use ISR (`revalidate: 900`) — content changes once a day. This is the single highest-leverage growth item in either spec.
2. **Programmatic SEO pages.** `/[city]/free-things-to-do-this-weekend`, `/[city]/live-music-tonight`, `/[city]/family`, `/[city]/this-weekend` — canned filter combinations over the existing `listEvents`, statically generated. These queries are where organic traffic actually lands, and no code beyond a config array of (slug, filters, copy) is needed.
3. **Real FTS.** `websearch_to_tsquery` against the already-created GIN index (SIMPLIFICATION §5) — searches title, description, and venue instead of `ILIKE` on title.
4. **ICS export.** Per-event `.ics` route + Google Calendar link; `lib/calendar.ts` already generates ICS for digests. "Add to calendar" is the retention feature for a utility product.
5. **User submissions.** Public form → URL or pasted text → the auth'd `/api/import` pipeline (already ~90% built) → events land with `pending` status → lightweight admin approve. Doubles as T4 source discovery (§1.2). This is how the long tail that even the crawler misses gets in — and how organizers become stakeholders.
6. **Price/free filters.** `is_free`, `price_min/max` already exist in the schema; expose as a filter chip + query param. "Free this weekend" is a signature query for this product.
7. **Map view.** Requires geocoding `venue_address` at persist time (cache by `venue_norm`). Defer to Phase 4.
8. **Personalized digests.** After double opt-in ships (SIMPLIFICATION §5): category + free-only + neighborhood preferences on the subscription. The digest is the habit loop; personalization is what makes it survive inbox triage.
9. **Semantic search.** pgvector embeddings for "date night ideas" queries — only if/after FTS proves insufficient.

## 5. What NOT to build (anti-roadmap)

Longevity is protected as much by refusal as by architecture:

- **No native mobile apps.** Responsive web + ICS export covers the job; two more codebases would sink a small team.
- **No user accounts in v1.** The email token *is* the identity. Accounts add auth surface, password reset, and GDPR weight for zero coverage benefit. Revisit only when personalization demands it.
- **No social features** (comments, RSVPs, follows). Moderation cost plus cold-start dynamics; this product is a utility, not a network.
- **No self-serve ads platform.** Manual featured listings via the (now-secured) `/api/featured` are enough until revenue justifies more.
- **No real-time anything.** Daily batch matches how event data actually changes.

## 6. Economics: why this scales and what it costs

**The moat, stated as unit economics.** A hand-written parser costs ~2 engineer-hours to build and breaks with every site redesign — competitor coverage cost scales with *source count*. A Gemini crawl source costs one DB row plus ~$0.01/page/day — our coverage cost scales with *token count*, and tokens keep getting cheaper. T4 sources are individually worthless (5 events/month) and collectively decisive (thousands of events nobody else lists).

**Naive cost arithmetic** (Gemini 2.5 Flash ≈ $0.30/M input, $2.50/M output tokens): a crawled page ≈ 20K input + 2K output ≈ $0.011. ~150 crawl sources/city/day ≈ $1.65/day ≈ **$50/mo/city**. Four Texas cities ≈ $200/mo Gemini + Supabase Pro $25 + Vercel Pro $20 + Resend ≈ **under $300/mo all-in** — a handful of featured listings covers it.

**Cost reduction, in order of impact** (spec'd into the single Gemini client, SIMPLIFICATION §3):

1. **Skip work that produces nothing new (~70–90% savings).** Content-hash every crawled page/feed (`sources.content_hash`) and skip Gemini when unchanged — most venue pages change weekly, not daily. Likewise **tag events once**: today every daily ingest re-tags the same upserted rows; tag on first sight, persist, never re-tag unchanged events.
2. **Shrink the input.** Strip HTML to main-content text with cheerio before sending (a 20K-token page becomes 3–5K); cap text length; pre-filter RSS/social items with a cheap keyword/date-pattern heuristic so obvious non-events never reach the model.
3. **Cheaper calls for easy work.** Keyword-tagger first, Gemini only for the ambiguous remainder; `gemini-2.5-flash-lite` for tagging (classification is easy), `flash` for extraction; **Batch API (50% discount)** — ingest is a cron, latency is irrelevant; constrain output with `responseSchema` + low `maxOutputTokens`.
4. **Governance.** `cadence` column (weekly sources), per-run token budget cap in the orchestrator, per-source `gemini_requests` accounting in `source_runs` so a cost anomaly is visible the day it happens.

Net effect: steady-state extraction drops to roughly **$10–15/mo/city**.

### 6.1 Free-tier-only mode

The app must be able to run **entirely on the free AI Studio tier**, which is limited by *request counts* (order of 10 requests/min and a few hundred requests/day for 2.5 Flash; flash-lite allows more), not dollars. Design accordingly — few, fat, prioritized requests:

- **Central budget in the Gemini client:** rate limiter (RPM) + persisted daily request counter; `GEMINI_DAILY_BUDGET` env defaults to a free-tier-safe value; usage recorded in `source_runs.gemini_requests`.
- **Pack more per request:** extraction batches 10 → 25 items, tagging 25 → 50 — free-tier cost is per request, not per item.
- **Priority queue:** new/changed content first; content-hash skipping means most sources need *zero* requests on a typical day; T1/T2 structured sources never touch Gemini at all.
- **Graceful exhaustion:** when the budget runs out, remaining crawl sources are marked `skipped (budget)` in `source_runs` and go first in the next run — never silently dropped.
- **Tagging on flash-lite** (higher free quota) with the zero-cost keyword tagger as first pass and fallback.

Realistic capacity: **Austin fits comfortably in the free tier** once content-hash skipping lands (~30–60 requests/day steady state); 3–4 cities fit marginally; beyond that, one env var flips to the paid tier at the $10–15/mo/city figure above.

## 7. Phased roadmap

| Phase | Scope | Duration |
| --- | --- | --- |
| **0 — Security & correctness** | SIMPLIFICATION §6 (fail-closed auth, SSRF guards, email escaping, POST unsubscribe, `SITE_URL`, error hygiene, Resend domain); fix `lucide-react` pin; delete fabricated-date fallbacks; wire the weekly digest cron. No refactors — ship immediately. | days |
| **1 — Simplification** | Single SQL layer + migrations-on-PGlite (§SIMPL 1); SourceAdapter + delete chronicle/do512 + `source_runs` (§SIMPL 2); `lib/gemini.ts` with budget/rate limiting (§SIMPL 3); Vitest + fixtures + GitHub Actions (§SIMPL 4); kill/finish list (§SIMPL 5); **SEO foundation + ISR rides along** (§4.1 — small enough, and the growth clock should start early). | 1–2 wks |
| **2 — Coverage & dedup** | `sources` + `event_sources` tables; trigram dedup pipeline (§2); seed ~50 Austin venue sources; content-hash crawl skipping; user-submission form; real FTS; programmatic SEO pages; admin health page. | 2–4 wks |
| **3 — Multi-city** | `cities` migration + `[city]` routing + scoped sitemaps/digests/crons (§3); **Houston launch as the playbook proof**; Dallas + San Antonio via playbook only. | 2–4 wks |
| **4 — Differentiation** | Map view + geocoding, personalized digests, pgvector semantic search (if warranted), digest growth loops. | ongoing |

**Ordering rationale:** security first because the routes are open today; simplification before coverage because dedup and the `sources` table need the single-SQL layer; multi-city before deep differentiation because the schema migration gets more expensive every month it waits; SEO early because organic growth compounds and everything else in §4 is additive.

---

## Definition of "better than any similar application"

Measurable claims this spec is built to win, per city:

1. **Coverage:** more distinct upcoming events than Do512/Eventbrite/local media for the same week — driven by T3+T4 (§1) and measured from `source_runs` + canonical event counts.
2. **Cleanliness:** no duplicate listings (dedup §2) and no fake data (fabricated dates banned) — the two failure modes aggregator users notice first.
3. **Findability:** every event has JSON-LD, a canonical URL, and appears in city sitemaps (§4.1–4.2); every filter view is a shareable URL (already true — preserved).
4. **Trust:** provenance shown per event ("also listed on…"), working unsubscribe, digests that arrive exactly as promised (daily *and* weekly).
5. **Expandability:** a new Texas city in < 1 day of ops work with zero code (§3.2) at ~$10–15/month marginal cost (§6).
