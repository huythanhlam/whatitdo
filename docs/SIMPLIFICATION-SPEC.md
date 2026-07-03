# Simplification Spec — Streamlining What It Do ATX for Longevity

*Companion to [CODEBASE-REVIEW.md](./CODEBASE-REVIEW.md) (findings) and [PRODUCT-SPEC.md](./PRODUCT-SPEC.md) (coverage, dedup, multi-city). Schema DDL for new tables lives in PRODUCT-SPEC and is referenced here so the Phase 1 refactor lands the schema Phases 2–3 need.*

## Thesis

The app's complexity is not in its features — it's in **duplication**: two database dialects, four copies of Gemini plumbing, three scrapers covering the same two websites, and half-built features that each carry maintenance cost forever. The simplification goal:

> **One query layer. One Gemini client. One source contract. Zero silent failures. Every feature finished or deleted.**

Target: ~4,400 LOC → ~3,200 LOC with *more* capability, plus tests and CI so the smaller codebase stays healthy.

### Key decisions at a glance

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Dual DB layer | Single raw-SQL layer over a `Db.query()` driver seam; migrations run on both PGlite and Postgres; drop the PostgREST query-builder |
| 2 | Redundant scrapers | Delete `austin-chronicle.ts` + `do512.ts`; the Gemini crawler already covers those domains |
| 3 | Fabricated dates | Banned; validation gate in `persist.ts` rejects undateable events |
| 4 | Observability | `source_runs` ledger + auth'd `/api/admin/health`; no external infra |
| 5 | Gemini | One `geminiJson` + `mapPool` helper in `lib/gemini.ts` |
| 6 | Tests | Vitest: pure functions → fixture-based parser tests → PGlite route tests; GitHub Actions CI |
| 7 | Half-built features | Finish: weekly digest, double opt-in, FTS, server-rendered calendar. Kill: dark mode remnants, AdSlot |
| 8 | Security | Fail-closed bearer auth everywhere; SSRF guards; escaped email HTML; POST unsubscribe; `SITE_URL` |

---

## 1. Database: one query layer, one schema

**Decision:** Keep PGlite for zero-credential local dev (it's a genuine asset — see §4 on testing), but collapse the dual query layer into a single raw-SQL path behind a tiny driver interface. Drop the Supabase JS query-builder for all app queries.

**Rationale:** PGlite and Supabase Postgres speak the same SQL dialect. The only reason `lib/db/index.ts` is 400 lines of everything-written-twice is that Supabase was accessed through PostgREST instead of SQL. Connect to Supabase with a direct Postgres connection (`pg` Pool via the Supavisor pooler `DATABASE_URL`) and every query is written exactly once.

The entire seam:

```ts
// lib/db/driver.ts
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

// lib/db/index.ts picks the driver once:
//   DATABASE_URL set  → pg Pool (Supabase pooler)
//   otherwise         → PGlite singleton (zero-cred dev mode, unchanged UX)
export function getDb(): Db
```

Consequences:

- **Migrations run on both.** Delete the hand-mirrored schema in `lib/db/pglite.ts:27-80`; PGlite startup applies `supabase/migrations/*.sql` in order, tracked in a `_migrations` bookkeeping table. One schema, no drift — this fixes the already-diverged `events.id` UUID-vs-TEXT split and removes JS-side UUID generation (`gen_random_uuid()` works in both).
- **The three-query PostgREST join emulation dies** (`lib/db/index.ts:98-107`, `:168-175`) — in SQL it's one join, written once.
- **Rewrite the ~10 exported functions once, in SQL, keeping their signatures** (`listEvents`, `countEvents`, `getEvent`, `getEventsBetween`, `upsertEvent`, `setEventCategories`, `addSubscription`, `removeSubscription`, `listSubscriptions`, `addFeatured`) so no caller changes.
- `lib/supabase/` shrinks to the generated types file or disappears; audit whether `lib/supabase/client.ts` has any remaining client-side consumer (it shouldn't) and delete it. RLS policies stay in the migrations as defense-in-depth.
- Add the missing index on `event_categories(category_id)` while touching migrations.
- **Net:** ~540 lines (`db/index.ts` + `db/pglite.ts`) → ~250; one dialect; and real FTS/trigram/CTE queries become possible — which §5 (FTS) and PRODUCT-SPEC §2 (dedup) both require. This is the enabling refactor for everything else.

## 2. Sources: one contract, no fabricated data, no silent death

1. **One adapter interface; every source implements it** (rename `lib/scrapers/` → `lib/sources/`):

```ts
// lib/sources/types.ts
export interface SourceAdapter {
  name: string
  kind: 'api' | 'ical' | 'rss' | 'jsonld' | 'crawl' | 'seed'
  enabled(): boolean   // e.g. "has API key" — replaces today's silent []-return
  fetch(ctx: SourceContext): Promise<RawEvent[]>   // ctx: { city, since, logger }
}
```

2. **Delete `austin-chronicle.ts` and `do512.ts`.** Two hand-rolled HTML parsers with shotgun selectors that fabricate dates are strictly worse than the Gemini crawler that already covers the same URLs (`lib/scrapers/crawler.ts:14-18`).

3. **Ban fabricated dates repo-wide.** An event with an invented time is worse than no event. Enforce at the single choke point — a validation gate in `lib/persist.ts` that rejects: missing/unparseable `start_time`, empty title, start more than 18 months out. Rejections are counted, not swallowed.

4. **`source_runs` health ledger** — the fix for "a dead source looks like an empty source":

```sql
CREATE TABLE source_runs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,            -- becomes source_id FK in Phase 2
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',  -- running|ok|error|skipped
  events_found    INT DEFAULT 0,
  events_upserted INT DEFAULT 0,
  events_rejected INT DEFAULT 0,
  gemini_requests INT DEFAULT 0,            -- cost accounting (PRODUCT-SPEC §6)
  error           TEXT
);
```

The ingest orchestrator (`app/api/ingest/route.ts`) wraps each adapter in a run record instead of `Promise.allSettled` + `console.error`. Add an auth'd `GET /api/admin/health` returning the last N runs per source; a source with 3 consecutive error/zero-event runs after previously producing events is flagged `stale`. That's alerting without new infrastructure (later: the ingest run itself sends one admin email via Resend when something goes stale).

5. `seed.ts` becomes dev-only (skipped when `DATABASE_URL` is set).

## 3. One Gemini client

Collapse the four copy-pasted implementations (extractor ×2, tagger ×2) and the four hand-rolled concurrency loops into:

```ts
// lib/gemini.ts
export async function geminiJson<T>(opts: {
  prompt: string
  schema?: object      // responseSchema; fence-strip fallback retained
  model?: string       // default gemini-2.5-flash; tagging uses flash-lite
}): Promise<T | null>  // null on missing key / parse failure — logged once, never thrown

export async function mapPool<A, B>(
  items: A[], limit: number, fn: (a: A) => Promise<B>
): Promise<B[]>
```

Fence-stripping, JSON parsing, retry-once-on-429, rate limiting, and the daily request budget (PRODUCT-SPEC §6, free-tier mode) live here and nowhere else. While touching these files, delete the dead `tagEvent` path (`lib/tagger.ts:108-148`) and the void'd `startOfToday` (`lib/dateRanges.ts:67,92`).

## 4. Tests + CI

**Vitest**, three tiers in order of value:

1. **Pure functions already carved out** (the code was shaped for this; the tests were just never written): date-range math (`lib/dateRanges.ts`), `buildEvent`/`dedupeEvents` (`lib/extractor.ts`), `pageFromHtml` (`crawler.ts`), `parseFeed` (`rss.ts`), `mapYoutubeItems` (`youtube.ts`), ICS generation (`lib/calendar.ts`), and title/venue normalization once dedup lands. Hours of work, immediate payoff.
2. **Fixture-based source tests:** one recorded real HTML/JSON/iCal response per source in `lib/sources/__fixtures__/`, asserting the parsed `RawEvent[]` shape and — explicitly — *no fabricated dates*. This is the regression net that makes scraper edits safe.
3. **Route tests against PGlite.** The zero-cred mode finally earns its keep: full integration tests (subscribe → digest → unsubscribe; ingest → list → detail) with zero external services. This is the strongest argument for keeping PGlite rather than requiring Supabase.

**GitHub Actions** — one workflow on PR + main: `npm ci → eslint → tsc --noEmit → vitest → next build`. No deploy step (Vercel owns that). Bring-up tasks CI will immediately force: fix the nonexistent `lucide-react@^1.22.0` pin (`package.json:24`), and rewrite `README.md` from `QUICKSTART.md` content (then delete QUICKSTART — one operational doc, not two).

## 5. Kill/finish list

Every half-built feature either ships or leaves. One verdict each:

| Feature | Verdict | How / why |
| --- | --- | --- |
| Weekly digest | **Finish** | Parametrize the `'daily'` literal in `lib/email/digest.ts:47`; add cron `0 14 * * 1` → `/api/email/digest?frequency=weekly`. Signup already promises it. |
| Double opt-in (`subscriptions.confirmed`) | **Finish (minimal)** | Confirm link in the welcome email sets `confirmed = true`; digest queries filter on it. Column exists; ~1 day; deliverability + CAN-SPAM hygiene. |
| FTS GIN index | **Finish** | Wire `websearch_to_tsquery` into `listEvents` search — trivial after §1; replaces `ILIKE` and searches descriptions/venues too. |
| Calendar view | **Finish (refactor)** | Server-fetch the month window in the RSC and pass down, matching the app's own pattern; delete the client `useEffect` fetch of 1,000 events. |
| `EnrichedEvent` ×4 | **Finish** | Single definition in `lib/types.ts`. |
| `error.tsx` / `loading.tsx` / `not-found.tsx` | **Finish** | Add the three files; stop rendering DB outages as "no events". |
| Dark mode | **Kill** | Remove the half-wired CSS variables; ship light-only. Broken is worse than absent; revisit post-Phase 2. |
| AdSlot | **Kill** | Delete the placeholder component. Featured listings are the monetization path that's actually built. |

## 6. Security hardening (Phase 0 — ships before any refactor)

1. **Fail-closed bearer auth** on `POST /api/ingest`, `/api/import`, `/api/featured`, `/api/email/digest`: require `CRON_SECRET` to be set (503 "not configured" in production if unset; open only when `NODE_ENV === 'development'`). Remove the broken outer-condition guards (`ingest/route.ts:21-26`, `featured/route.ts:5-10`, `import/route.ts:19-23`) and **delete the GET alias on ingest** (`ingest/route.ts:65-67`).
2. **SSRF guards on `/api/import`:** resolve DNS and reject private/link-local/metadata ranges (including on redirects), cap response size (2 MB) and timeout (10 s). The route keeps its arbitrary-URL capability — it becomes the auth'd backend of the user-submission feature (PRODUCT-SPEC §4.5) — but never runs unauthenticated.
3. **Escape all scraped content in email HTML:** one `escapeHtml()` applied to title/venue/description/URLs in `lib/email/digest.ts` and the subscribe confirmation.
4. **Unsubscribe:** GET renders a confirmation page; the delete is a POST. Add RFC 8058 one-click headers (`List-Unsubscribe`, `List-Unsubscribe-Post`) to every digest.
5. **`SITE_URL` env var** replaces `VERCEL_URL` for all email/OG/sitemap links; add to `.env.example`.
6. **Error hygiene:** generic client-facing messages, details to server logs; validate `page` (`Number.isInteger(page) && page >= 1`) in `/api/events`.
7. **Resend:** verified sending domain; drop `onboarding@resend.dev`.

## 7. Target end-state file tree (after Phase 1)

```
lib/
  db/         driver.ts, index.ts (each query once, in SQL), migrate.ts
  sources/    types.ts, registry.ts,
              {ticketmaster,seatgeek,eventbrite,ical,rss,crawler,social,youtube}.ts,
              __fixtures__/
  gemini.ts   extractor.ts   tagger.ts   persist.ts   types.ts
  email/      digest.ts, templates.ts (escaped HTML helpers)
app/
  api/        ingest, import, events, events/[id], calendar,
              subscribe, unsubscribe (POST), email/digest, featured, admin/health
  error.tsx   loading.tsx   not-found.tsx
.github/workflows/ci.yml
supabase/migrations/   (single source of schema truth — applied to PGlite too)
```

Deleted outright: `lib/db/pglite.ts` schema copy, `lib/scrapers/austin-chronicle.ts`, `lib/scrapers/do512.ts`, `components/AdSlot.tsx`, dead tagger/date code, `QUICKSTART.md` (folded into README), `supabase/all_migrations.sql` (generated artifact).

---

*Sequencing, effort estimates, and how this dovetails with coverage/dedup/multi-city work: see the phased roadmap in [PRODUCT-SPEC.md §7](./PRODUCT-SPEC.md#7-phased-roadmap).*
