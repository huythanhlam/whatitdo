# Codebase Review — What It Do ATX

*Reviewed: July 2026 · ~4,400 lines of TypeScript across `app/`, `components/`, `lib/` · 27 commits · zero tests · no CI*

This is the findings document. The recommendations it feeds are split into two companion specs:

- **[SIMPLIFICATION-SPEC.md](./SIMPLIFICATION-SPEC.md)** — how to streamline the codebase for longevity (deliverable of finding groups 2–5 below).
- **[PRODUCT-SPEC.md](./PRODUCT-SPEC.md)** — how to make this the most comprehensive events app for Austin and scale it across Texas.

---

## 1. What the app is today

A single Next.js 16 (App Router, React 19, React Compiler) application that:

1. **Ingests** events daily (Vercel cron, `vercel.json`) from 11 sources in `app/api/ingest/route.ts:28-40`: Eventbrite (JSON-LD scrape), Austin Chronicle + Do512 (HTML scrape), City of Austin iCal, Ticketmaster/SeatGeek/YouTube (API-key gated), newspaper RSS + Reddit/Bluesky + generic crawler (Gemini-extracted), and a hardcoded seed.
2. **Extracts and tags** free-text sources with Gemini 2.5 Flash (`lib/extractor.ts`, `lib/tagger.ts`), falling back to keyword tagging without a key.
3. **Stores** events in Supabase Postgres, or an embedded in-memory PGlite when no credentials are configured (`lib/db/index.ts`, `lib/db/pglite.ts`).
4. **Serves** a filterable/searchable event grid + calendar (`app/page.tsx`), event detail pages, email digest subscriptions (Resend), and time-bounded paid "featured" listings.

### Strengths worth preserving

These are genuinely good and the specs are designed *around* them, not over them:

| Strength | Where |
| --- | --- |
| RSC-with-direct-DB fetching — homepage queries the DB in a Server Component, no client fetch waterfall | `app/page.tsx:33`, `<Suspense>` at `app/page.tsx:126` |
| URL-as-state filters — search, categories, date range, view all live in query params; every filtered view is shareable and server-renderable | `components/SearchBar.tsx:15-24`, `SidebarFilters.tsx:13-24`, `DateFilter.tsx:19-47` |
| Time-bounded featured-listing model (paid placement with `starts_at`/`ends_at`) | `lib/db/index.ts:23-36`, migration `003` |
| Zero-credential dev mode — the app runs with no accounts via embedded PGlite + seed data | `lib/db/pglite.ts:7-21`, `QUICKSTART.md` |
| Careful timezone handling for "today/this weekend" ranges | `lib/dateRanges.ts` |
| Disciplined conventional-commit history; thorough `.env.example` | `git log`, `.env.example` |

---

## 2. Security findings (ranked)

### S1 — Mutation endpoints are effectively unauthenticated when `CRON_SECRET` is unset · **critical**

All three write endpoints share the same broken guard shape: the outer condition decides *whether to check auth*, but the inner check is `if (process.env.CRON_SECRET && ...)` — so when `CRON_SECRET` is unset the inner check never fires and the request passes, **including on a production Supabase deployment**:

- `app/api/ingest/route.ts:21-26` — anyone can trigger a full scrape + Gemini spend. Worse, `GET` is aliased to `POST` (`app/api/ingest/route.ts:65-67`), so a crawler hitting the URL triggers ingestion.
- `app/api/featured/route.ts:5-10` — anyone can create featured (paid) listings. This is a monetization-integrity hole.
- `app/api/import/route.ts:19-23` — `authorized()` literally `return true` when the secret is unset.

Only `/api/email/digest` fails closed (`app/api/email/digest/route.ts:8`).

### S2 — SSRF in `/api/import` · **high**

`runImport` fetches any caller-supplied URL with only a protocol check (`app/api/import/route.ts:28-32`) — no private-IP/link-local/metadata-endpoint blocking, no redirect policy, no response size cap. Combined with S1, an unauthenticated attacker can make the server fetch internal addresses.

### S3 — Unescaped scraped content interpolated into email HTML · **high**

`lib/email/digest.ts:18-24` builds email HTML by string-interpolating `title`, `venue_name`, `image_url`, `ticket_url` — all of which originate from scraped third-party pages — with no escaping. A malicious event title is an HTML injection into every subscriber's inbox. The confirmation email in `app/api/subscribe/route.ts:35` has the same pattern.

### S4 — Destructive GET unsubscribe · **medium**

`app/api/unsubscribe/route.ts:8` deletes the subscription on a bare GET. Email clients and corporate link scanners prefetch links, silently unsubscribing users. It also always renders "Unsubscribed ✓" even for bogus tokens.

### S5 — Error and input hygiene · **medium**

- API routes leak internal error messages to clients: `(e as Error).message` at `app/api/events/route.ts:25`, `calendar/route.ts:24`, `featured/route.ts:23`.
- `/api/events` does no bounds check on `page` (`app/api/events/route.ts:9-11`): `?page=abc` → `NaN` offset; negative pages → negative offsets.
- RSC loaders swallow DB errors and render an empty grid (`app/page.tsx:54-56`) — an outage is indistinguishable from "no events tonight," and there is no `error.tsx` anywhere.

### S6 — Email infrastructure misconfiguration · **low**

- Sender is Resend's sandbox `onboarding@resend.dev` (`lib/email/digest.ts:69`, `subscribe/route.ts:29`) — undeliverable to real subscribers in production.
- Unsubscribe links are built from `VERCEL_URL` (`app/api/subscribe/route.ts:23`), which is the per-deployment URL, not the production domain.

---

## 3. Data-quality findings

### D1 — No cross-source deduplication · **the single biggest product defect**

The only dedup is `UNIQUE(source, source_id)` (migration `001`, upsert at `lib/db/index.ts:241`). The same concert listed on Ticketmaster, SeatGeek, Eventbrite, and a newspaper roundup produces **four separate rows** — users see the same event repeated with different ticket links. There is no fuzzy matching on title/date/venue, no canonical record, no provenance model. See PRODUCT-SPEC §2 for the fix design.

### D2 — Fabricated event dates · **high**

When the Chronicle/Do512 scrapers can't parse a date, they **invent one**: `start_time = now + 24h` (`lib/scrapers/austin-chronicle.ts:33-35`, `lib/scrapers/do512.ts:33-34`). Fake-dated events are worse than missing events — they actively mislead users. Both scrapers also use shotgun CSS selectors (`[class*="title"], h2, h3`) that silently yield garbage or nothing after any site redesign.

### D3 — Silent source failure · **high**

Every source swallows errors to `[]` with only a `console.error` (`app/api/ingest/route.ts:50`, and per-scraper). There are no retries, no backoff, no run ledger, no alerting. A source that has been dead for a month is indistinguishable from one with no events. Gemini-gated sources (newspapers, social, YouTube, crawler) silently contribute nothing when `GEMINI_API_KEY` is absent.

### D4 — Dead full-text search index

Migration `001:51-53` creates a GIN FTS index, but search is `title ILIKE '%q%'` (`lib/db/index.ts:63,122`) — which cannot use that index, ignores descriptions and venues, and degrades to a sequential scan at scale. The index is pure write-amplification cost.

### D5 — No locality dimension

The schema has no `city`/`market` column; "Austin" is hardcoded into source query strings. Texas expansion requires a migration and query rewrites everywhere (designed in PRODUCT-SPEC §3).

---

## 4. Duplication & dead code (the longevity tax)

### C1 — Every database query is written twice

`lib/db/index.ts` (400 lines, the largest file) branches every function on `isLocal()` into a raw-SQL PGlite path and a Supabase PostgREST query-builder path — ~10 functions × 2 dialects. The paths have already drifted: `events.id` is `UUID` in Postgres (migration `001:24`) but `TEXT` in PGlite (`lib/db/pglite.ts:36`), papered over by JS-side UUID generation (`lib/db/index.ts:12-14`). The Supabase category filter is a manual three-query join emulation (`lib/db/index.ts:98-107`) because PostgREST can't express the join — duplicated again in `countEvents` (`:168-175`). `lib/db/pglite.ts:27-80` is a hand-maintained second copy of the entire migration schema; every new migration must be mirrored by hand or the two modes diverge.

### C2 — Gemini plumbing copy-pasted four times

The fence-stripping + JSON-parse + try/catch + manual concurrency-pool pattern appears in `lib/extractor.ts:159-185`, `extractor.ts:255-304`, `lib/tagger.ts:68-106`, and `tagger.ts:127-147`; the concurrency loop alone is copy-pasted in four more places including `lib/persist.ts:38-49`.

### C3 — Three code paths for two websites

`austin-chronicle.ts` and `do512.ts` hand-scrape the exact domains the generic Gemini crawler already covers (`lib/scrapers/crawler.ts:14-18`) — and they're the two scrapers that fabricate dates (D2).

### C4 — Type and logic duplication in the UI

`EnrichedEvent` is redefined verbatim in four files (`app/page.tsx:12`, `EventGrid.tsx:5`, `EventList.tsx:6`, `CalendarView.tsx:17`). The Supabase category-normalization block is copy-pasted three times in `lib/db/index.ts` (`:131-136`, `:213-216`, `:387-392`). Date formatting is re-implemented in the card, detail page, calendar, and digest.

### C5 — Dead code

- `tagEvent` single-event path (`lib/tagger.ts:108-148`) — never called.
- `startOfToday` computed then `void`-discarded (`lib/dateRanges.ts:67,92`).
- The FTS index (D4).
- `AdSlot` (`components/AdSlot.tsx`) — a permanent placeholder, no ad network.
- Six functions carry "exported so it can be unit-tested" comments (`lib/extractor.ts:49,235`, `crawler.ts:154`, `rss.ts:51`, `youtube.ts:42`) — the tests were never written.

---

## 5. Half-built features (finish or delete — verdicts in SIMPLIFICATION-SPEC §5)

| Feature | State |
| --- | --- |
| Weekly digest | Offered at signup (`components/SubscribeForm.tsx:61`) but never sent — code only queries `'daily'` (`lib/email/digest.ts:47`), no weekly cron. Silent broken promise to subscribers. |
| Double opt-in | `subscriptions.confirmed` column exists (`lib/supabase/types.ts:37`) but no confirmation flow; subscriptions are live immediately. |
| Dark mode | CSS variables defined (`app/globals.css:15-20`) but components hardcode `bg-white`/`text-slate-*` — dark mode renders broken, not absent. |
| Calendar view | Client-side `useEffect` fetch of up to 1,000 events after mount (`components/CalendarView.tsx:44-61`, `app/api/calendar/route.ts:22`) — the one place that violates the app's own good RSC pattern. |
| Route-level UX files | No `error.tsx`, `loading.tsx`, or `not-found.tsx` anywhere in `app/`. |

---

## 6. SEO & performance — the growth ceiling

For a discovery product whose users arrive from "things to do in austin this weekend" searches, SEO is the product surface. It is currently absent:

- Site metadata is still create-next-app boilerplate: `title: "Create Next App"` (`app/layout.tsx:15-18`). Every page inherits it.
- **No `generateMetadata` anywhere** — event detail pages have no per-event title/description/OG tags.
- **No JSON-LD.** The app *scrapes* schema.org `Event` markup from Eventbrite (`lib/scrapers/eventbrite.ts`) but emits none of its own — forfeiting Google Events rich results for every listing.
- No `sitemap.ts`, no `robots.ts`, no OG images.
- `force-dynamic` on the homepage and detail pages (`app/page.tsx:14`, `app/events/[id]/page.tsx:8`) plus zero caching headers on any API route: every request re-queries a database whose content changes once a day.
- `<img>` used everywhere instead of `next/image` (`components/EventCard.tsx:41`) even though `next.config.ts:8-20` configures the image optimizer's `remotePatterns` — configured but unused.

---

## 7. Hygiene

- **Zero tests, no CI** — no test files, no runner in `package.json`, no `.github/` directory.
- **`lucide-react` pinned to `^1.22.0`** (`package.json:24`) — that major version doesn't exist (lucide-react is a 0.x line); a fresh `npm install` will likely fail. This alone argues for CI: it would have been caught on day one.
- **`README.md` is stock create-next-app boilerplate**; the real operational doc is `QUICKSTART.md`. One of them should not exist.
- `AGENTS.md` mandates reading `node_modules/next/dist/docs/` (this Next.js 16 build ships breaking-change guides in-package) — fine, but it means the repo can't be safely modified without an install.

---

## 8. Top risks, ranked

| # | Risk | Severity | Fix spec |
| --- | --- | --- | --- |
| 1 | Open mutation endpoints (`/api/ingest` GET-triggerable, `/api/featured`, `/api/import`) when `CRON_SECRET` unset | Critical | SIMPLIFICATION §6.1 |
| 2 | SSRF via `/api/import` | High | SIMPLIFICATION §6.2 |
| 3 | Duplicate events across sources (no cross-source dedup) | High (product) | PRODUCT-SPEC §2 |
| 4 | Fabricated event dates from Chronicle/Do512 scrapers | High (product) | SIMPLIFICATION §2 |
| 5 | Dual-DB layer drift (schema already diverged) | High (longevity) | SIMPLIFICATION §1 |
| 6 | HTML injection into subscriber emails | High | SIMPLIFICATION §6.3 |
| 7 | Silent source death (no observability) | Medium | SIMPLIFICATION §2 |
| 8 | SEO absent — no organic acquisition channel | Medium (growth) | PRODUCT-SPEC §4.1 |
| 9 | Zero tests + broken dependency pin + no CI | Medium | SIMPLIFICATION §4 |
| 10 | Weekly digest silently never sent | Medium (trust) | SIMPLIFICATION §5 |

---

*Next: read [SIMPLIFICATION-SPEC.md](./SIMPLIFICATION-SPEC.md) for the streamlining plan, then [PRODUCT-SPEC.md](./PRODUCT-SPEC.md) for coverage, dedup, multi-city, and the roadmap.*
