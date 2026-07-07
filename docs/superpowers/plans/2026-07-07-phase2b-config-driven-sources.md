# Phase 2B — Config-Driven Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move source *instances* (which URLs/feeds to ingest) out of hardcoded code lists and into a `sources` database table, so adding coverage becomes an `INSERT` instead of a pull request; keep source *mechanisms* (the parsers) in code, dispatched by a `parser` column; link `source_runs` and `event_sources` to `sources` via a `source_id` FK; and skip Gemini extraction on unchanged crawl pages via a per-source `content_hash`.

**Architecture:** A migration adds the `sources` table (PRODUCT-SPEC §1.2) and seeds today's ~30 source instances as rows — one row per feed/venue/API. The code registry flips from a list of self-contained `SourceAdapter`s (each holding its own URL list) to a map of `parser` name → `SourceParser` *mechanism* that takes a configured `SourceRow` and reads its `url`. The ingest orchestrator reads enabled `sources` rows for a city and dispatches each by `parser`, stamping the row's `source_id` onto the run and provenance. A second migration adds the `source_id` FK to `source_runs`/`event_sources` and backfills it by matching the legacy `source` text to `sources.name`. Content-hash skipping stores the hash of each crawled page's text in `sources.content_hash`; an unchanged page skips the Gemini extraction call and records the run as `skipped`.

**Tech Stack:** PostgreSQL / PGlite 0.5.3, TypeScript, Vitest, Node `crypto`.

---

## Phase 2 decomposition (context)

Per PRODUCT-SPEC §7 and the Phase 2A plan, Phase 2 splits into four sub-plans:

- **2A — Dedup foundation** (done, merged): canonical events + `event_sources` + trigram matching + minimal `cities`.
- **2B — Config-driven sources** (this plan): `sources` table, registry dispatch by `parser`, seed today's sources + ~50 Austin venues, `source_id` FK migration, content-hash crawl skipping.
- **2C — User submissions**: public form → auth'd `/api/import` → `pending` status → admin approve.
- **2D — Programmatic SEO pages**: config array of (slug, filters, copy) over `listEvents`, statically generated.

Already done and therefore NOT in this plan: real FTS, `/api/admin/health`, cross-source dedup, the `cities` scaffold (from 2A). Full `[city]` routing stays in Phase 3; this plan keeps everything scoped to Austin (`city_id = 1`).

---

## Design decisions locked in

1. **A source row's `name` IS the `RawEvent.source` string it emits.** Today `newspapers.ts` emits `newspaper:kut`, the crawler emits `crawl:do512-com`, etc. Each becomes a `sources` row whose `name` equals that exact string. This makes the FK backfill a clean join (`event_sources.source = sources.name`) and lets provenance resolve `source_id` from the emitted string without threading it through every function signature.

2. **Parsers are mechanisms; the DB holds instances.** `PARSERS: Record<string, SourceParser>` maps a `parser` key to a `fetch(source, ctx)` mechanism. Per-URL parsers (`rss`, `ical`, `crawl`) read `source.url`; env-configured API parsers (`ticketmaster`, `seatgeek`, `eventbrite`, `youtube`, `bluesky`) ignore it.

3. **`available()` (code) is AND-ed with `enabled` (DB).** The old `SourceAdapter.enabled()` API-key check moves to `SourceParser.available()`. A row runs only when `row.enabled && parser.available()`. `enabled=true` + `!available()` (missing key) records the run as `skipped` — never a silent empty source.

4. **Keep the legacy `source` TEXT columns; ADD `source_id`.** Dropping the text columns on `source_runs`/`event_sources` is riskier and buys nothing — the `RawEvent` still carries the text, and it stays human-readable in the DB. `source_id` becomes the authoritative FK, backfilled by name match; unmatched legacy rows (e.g. an old ad-hoc crawl host) keep `source_id = NULL`.

5. **Seed sources via SQL `INSERT` in the migration**, exactly like the `cities` Austin row in 007. This seeds both drivers automatically (the migration runner applies to PGlite at init and Postgres via `npm run migrate`), so no separate seeding code path.

6. **The `seed` baseline source is NOT a `sources` row.** Baseline events are inserted by `lib/db/pglite.ts` init directly (zero-cred dev/prod-fallback). The orchestrator iterates only DB-configured `sources` rows. `seed`/`import` provenance rows keep `source_id = NULL`.

7. **Content-hash skipping is best-effort and only meaningful with `DATABASE_URL`.** On ephemeral PGlite (prod fallback), per-instance writes to `sources.content_hash` are lost, so skipping simply never triggers there — acceptable, since that mode relies on the baseline seed, not the cron.

---

## File Structure

- `supabase/migrations/008_sources.sql` — **create.** The `sources` table + seed today's ~30 source instances (structured APIs, iCal, newspaper RSS, reddit RSS, bluesky, crawl pages) as rows. Applied to both drivers by the existing runner.
- `supabase/migrations/009_source_id_fk.sql` — **create.** Add `source_id INT REFERENCES sources(id)` to `source_runs` and `event_sources`; backfill by `source = sources.name`; index it.
- `supabase/migrations/010_austin_venues.sql` — **create.** Seed ~50 Austin T3 venue crawl/iCal sources (the coverage payload).
- `lib/sources/types.ts` — **modify.** Add the `SourceRow` type and the new `SourceParser` interface (`available()` + `fetch(source, ctx)`); keep `RawEvent`, `SourceContext`, `SourceKind`.
- `lib/sources/registry.ts` — **rewrite.** Replace `SOURCES: SourceAdapter[]` with `PARSERS: Record<string, SourceParser>`. Each parser wraps an existing fetch function, reading `source.url`/`source.name`.
- `lib/sources/rss.ts` — **modify.** Add `fetchOneFeed(url, source, opts)` convenience already covered by `fetchFeed`; no change needed beyond re-export (verify).
- `lib/sources/ical.ts` — **modify.** Extract `fetchIcalUrl(url, source)` (single-feed) from the hardcoded-list `fetchIcalEvents`.
- `lib/sources/social.ts` — **modify.** Split `fetchBlueskyEvents()` (parser `bluesky`) out of `fetchSocialEvents`; reddit feeds become `rss` source rows.
- `lib/sources/crawler.ts` — **modify.** Add `fetchCrawlSource(source, ctx)` that crawls `source.url`, computes the content hash, and short-circuits when unchanged.
- `lib/sources/content-hash.ts` — **create.** Pure `hashPageText(text): string` (sha256, hex).
- `lib/sources/content-hash.test.ts` — **create.** Unit test for the hash.
- `lib/db/index.ts` — **modify.** Add `getEnabledSources(cityId)`, `getSourceContentHash(id)`, `setSourceContentHash(id, hash)`, `touchSourceSuccess(id)`; give `startSourceRun` an optional `sourceId`; give `recordProvenance` a `source_id` via subquery on `sources.name`.
- `lib/db/db.integration.test.ts` — **modify.** Integration tests for the new source queries + FK stamping.
- `app/api/ingest/route.ts` — **modify.** Read enabled DB sources, dispatch each by `parser`, stamp `source_id`.
- `lib/sources/registry.test.ts` — **create.** Assert every seeded `parser` value has a registered `SourceParser`, and every seeded `kind` is valid.

---

## Conventions used below

- **Austin `city_id` is `1`** (from migration 007; it is the column DEFAULT).
- Run one Vitest file: `npx vitest run <path>`. Run all: `npm test`. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`.
- The migration runner (`lib/db/migrate.ts`) applies `supabase/migrations/*.sql` in filename order to both drivers; a new numbered file is picked up automatically. PGlite integration tests get a fresh in-memory DB each run, so they exercise all migrations end to end.
- New DB-touching functions get an integration test against PGlite; pure functions get a unit test. TDD: write the failing test first.

---

## Task 1: `sources` table migration + seed today's sources

**Files:**
- Create: `supabase/migrations/008_sources.sql`
- Test: `lib/db/db.integration.test.ts` (add a sources-shape test)

- [ ] **Step 1: Write the failing test**

Add to `lib/db/db.integration.test.ts` (it already spins up PGlite via `getPgliteDb`; follow the existing pattern in that file for imports and the `beforeAll`/`db` handle):

```ts
import { describe, it, expect } from 'vitest'
import { getPgliteDb } from './pglite'

describe('sources table (migration 008)', () => {
  it('seeds Austin sources with valid kinds and parsers', async () => {
    const db = await getPgliteDb()
    const rows = await db.query<{ name: string; kind: string; parser: string; city_id: number; enabled: boolean }>(
      `SELECT name, kind, parser, city_id, enabled FROM sources ORDER BY name`
    )
    // At least the structured + feed sources are seeded.
    expect(rows.length).toBeGreaterThanOrEqual(15)
    // Every seeded source belongs to Austin and has a non-empty parser.
    for (const r of rows) {
      expect(r.city_id).toBe(1)
      expect(r.parser.length).toBeGreaterThan(0)
      expect(['api', 'ical', 'rss', 'jsonld', 'crawl']).toContain(r.kind)
    }
    // The known structured sources exist by name.
    const names = new Set(rows.map(r => r.name))
    expect(names.has('eventbrite')).toBe(true)
    expect(names.has('ticketmaster')).toBe(true)
    expect(names.has('newspaper:kut')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/db/db.integration.test.ts -t "seeds Austin sources"`
Expected: FAIL — `relation "sources" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/008_sources.sql`:

```sql
-- Phase 2B: config-driven sources. Ingestion instances (which feeds/venues/APIs
-- to crawl) move from hardcoded code lists into this table; code holds only the
-- parser MECHANISMS, dispatched by the `parser` column. Adding coverage becomes
-- an INSERT, not a pull request (PRODUCT-SPEC §1.2).
CREATE TABLE sources (
  id           SERIAL PRIMARY KEY,
  city_id      INT NOT NULL REFERENCES cities(id) DEFAULT 1,
  name         TEXT NOT NULL UNIQUE,   -- also the RawEvent.source string this row emits
  kind         TEXT NOT NULL,          -- api | ical | rss | jsonld | crawl
  url          TEXT,                   -- null for env-configured api/jsonld kinds
  parser       TEXT NOT NULL,          -- key into the code PARSERS registry
  cadence      TEXT NOT NULL DEFAULT 'daily',   -- daily | weekly
  enabled      BOOLEAN NOT NULL DEFAULT true,
  last_success TIMESTAMPTZ,
  content_hash TEXT,                   -- skip Gemini when a crawled page is unchanged
  notes        TEXT
);
CREATE INDEX sources_city_enabled ON sources (city_id, enabled);

-- Seed today's sources — one row per instance. `name` matches the exact string
-- each parser already emits as RawEvent.source, so provenance/runs link back by
-- name (see migration 009) with zero code churn.

-- Structured APIs / JSON-LD (no url; configured by env keys + city geo).
INSERT INTO sources (name, kind, url, parser) VALUES
  ('eventbrite',   'jsonld', NULL, 'eventbrite'),
  ('ticketmaster', 'api',    NULL, 'ticketmaster'),
  ('seatgeek',     'api',    NULL, 'seatgeek'),
  ('youtube',      'api',    NULL, 'youtube'),
  ('social:bluesky','crawl', NULL, 'bluesky');

-- Government iCal.
INSERT INTO sources (name, kind, url, parser) VALUES
  ('austin-gov', 'ical', 'https://www.austintexas.gov/calendar/ical', 'ical');

-- Newspaper / news RSS (each was an entry in newspapers.ts NEWSPAPER_FEEDS).
INSERT INTO sources (name, kind, url, parser) VALUES
  ('newspaper:kut',              'rss', 'https://www.kut.org/tags/events.rss', 'rss'),
  ('newspaper:austin-monitor',   'rss', 'https://www.austinmonitor.com/feed/', 'rss'),
  ('newspaper:daily-texan',      'rss', 'https://thedailytexan.com/feed/', 'rss'),
  ('newspaper:towers',           'rss', 'https://austin.towers.net/feed/', 'rss'),
  ('newspaper:kvue',             'rss', 'https://www.kvue.com/feeds/syndication/rss/news/local', 'rss'),
  ('newspaper:eater-austin',     'rss', 'https://austin.eater.com/rss/index.xml', 'rss'),
  ('newspaper:kxan',             'rss', 'https://www.kxan.com/feed/', 'rss'),
  ('newspaper:community-impact', 'rss', 'https://communityimpact.com/rss/', 'rss'),
  ('newspaper:fox7-austin',      'rss', 'https://www.fox7austin.com/rss/category/local-news', 'rss');

-- Reddit per-subreddit Atom feeds (each was in social.ts REDDIT_FEEDS). The .rss
-- endpoints are plain Atom, so the generic rss parser handles them.
INSERT INTO sources (name, kind, url, parser) VALUES
  ('social:reddit-austinevents', 'rss', 'https://www.reddit.com/r/AustinEvents/.rss', 'rss'),
  ('social:reddit-austin',       'rss', 'https://www.reddit.com/r/Austin/.rss', 'rss');

-- Media-roundup crawl pages (each was in crawler.ts DEFAULT_CRAWL_URLS). Names
-- match the crawler's hostSlug(url) so historical provenance backfills cleanly.
INSERT INTO sources (name, kind, url, parser, cadence) VALUES
  ('crawl:do512-com',          'crawl', 'https://do512.com/', 'crawl', 'daily'),
  ('crawl:365thingsaustin-com','crawl', 'https://365thingsaustin.com/', 'crawl', 'daily'),
  ('crawl:austinchronicle-com','crawl', 'https://www.austinchronicle.com/events/', 'crawl', 'daily');

-- RLS parity with existing tables: public read, service-role write.
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read sources" ON sources FOR SELECT USING (true);
CREATE POLICY "Service role write sources" ON sources
  FOR ALL USING (auth.role() = 'service_role');
```

> **Naming note:** the crawler derives `crawl:${hostSlug(url)}` where `hostSlug` lowercases the host, strips `www.`, and replaces non-alphanumerics with `-`. Verify the seeded names above match `hostSlug` output for each URL in Task 5 (the crawl parser will emit `source.name` directly, so exactness only matters for the historical backfill — but keep them correct).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/db/db.integration.test.ts -t "seeds Austin sources"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/008_sources.sql lib/db/db.integration.test.ts
git commit -m "feat(db): sources table + seed today's source instances (PRODUCT-SPEC §1.2)"
```

---

## Task 2: `SourceRow` type + source queries

**Files:**
- Modify: `lib/sources/types.ts` (add `SourceRow`)
- Modify: `lib/db/index.ts` (add `getEnabledSources`, content-hash + success helpers)
- Test: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Add the `SourceRow` type**

Append to `lib/sources/types.ts`:

```ts
// A configured source instance (one row of the `sources` table). The code holds
// parser MECHANISMS; the database holds these INSTANCES. `name` is the exact
// RawEvent.source string the row's parser emits, so provenance links back by name.
export type SourceRow = {
  id: number
  city_id: number
  name: string
  kind: SourceKind
  url: string | null
  parser: string
  cadence: 'daily' | 'weekly'
  enabled: boolean
  last_success: string | null
  content_hash: string | null
  notes: string | null
}
```

- [ ] **Step 2: Write the failing test**

Add to `lib/db/db.integration.test.ts`:

```ts
import { getEnabledSources, getSourceContentHash, setSourceContentHash, touchSourceSuccess } from './index'

describe('source queries (Phase 2B)', () => {
  it('getEnabledSources returns Austin enabled rows only', async () => {
    const rows = await getEnabledSources(1)
    expect(rows.length).toBeGreaterThanOrEqual(15)
    expect(rows.every(r => r.enabled && r.city_id === 1)).toBe(true)
    const eb = rows.find(r => r.name === 'eventbrite')
    expect(eb?.parser).toBe('eventbrite')
  })

  it('content hash round-trips and touchSourceSuccess sets last_success', async () => {
    const rows = await getEnabledSources(1)
    const crawl = rows.find(r => r.parser === 'crawl')!
    expect(await getSourceContentHash(crawl.id)).toBeNull()
    await setSourceContentHash(crawl.id, 'deadbeef')
    expect(await getSourceContentHash(crawl.id)).toBe('deadbeef')
    await touchSourceSuccess(crawl.id)
    const after = await getEnabledSources(1)
    expect(after.find(r => r.id === crawl.id)!.last_success).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/db/db.integration.test.ts -t "source queries"`
Expected: FAIL — `getEnabledSources is not a function`.

- [ ] **Step 4: Implement the queries**

Add to `lib/db/index.ts` (near the source-runs section). Add `SourceRow` to the `@/lib/sources/types` import at the top:

```ts
// ---------------------------------------------------------------------------
// Sources — config-driven ingestion instances (Phase 2B)
// ---------------------------------------------------------------------------

// Enabled source rows for a city, oldest-successful first so stale/never-run
// sources are prioritized by the orchestrator.
export async function getEnabledSources(cityId: number): Promise<SourceRow[]> {
  const db = await getDb()
  return db.query<SourceRow>(
    `SELECT id, city_id, name, kind, url, parser, cadence, enabled,
            last_success, content_hash, notes
     FROM sources
     WHERE city_id = $1 AND enabled = true
     ORDER BY last_success ASC NULLS FIRST, id ASC`,
    [cityId]
  )
}

export async function getSourceContentHash(id: number): Promise<string | null> {
  const db = await getDb()
  const rows = await db.query<{ content_hash: string | null }>(
    `SELECT content_hash FROM sources WHERE id = $1`,
    [id]
  )
  return rows[0]?.content_hash ?? null
}

export async function setSourceContentHash(id: number, hash: string): Promise<void> {
  const db = await getDb()
  await db.query(`UPDATE sources SET content_hash = $2 WHERE id = $1`, [id, hash])
}

// Record a successful fetch (any events or a valid unchanged skip). Powers the
// oldest-first ordering above and, later, source-staleness alerting.
export async function touchSourceSuccess(id: number): Promise<void> {
  const db = await getDb()
  await db.query(`UPDATE sources SET last_success = NOW() WHERE id = $1`, [id])
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/db/db.integration.test.ts -t "source queries"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sources/types.ts lib/db/index.ts lib/db/db.integration.test.ts
git commit -m "feat(db): SourceRow type + getEnabledSources/content-hash/touch queries"
```

---

## Task 3: Single-feed helpers for per-URL parsers

**Files:**
- Modify: `lib/sources/ical.ts` (extract `fetchIcalUrl`)
- Modify: `lib/sources/social.ts` (extract `fetchBlueskyEvents`)
- Test: existing `lib/sources/parsers.test.ts` stays green (regression); no new behavior test here — these are refactors verified by Task 6's registry test + typecheck.

- [ ] **Step 1: Extract `fetchIcalUrl` in `lib/sources/ical.ts`**

Refactor so a single URL can be fetched with a caller-supplied source name. Replace the bottom `fetchIcalEvents` with:

```ts
// Fetch and parse ONE iCal feed, tagging every event with the given source name.
// Never throws — returns [] on any network/parse failure so one dead feed can't
// sink the run.
export async function fetchIcalUrl(url: string, source: string): Promise<RawEvent[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WhatItDo Events Bot/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const text = await res.text()
    return parseIcalText(text).map(e => ({ ...e, source }))
  } catch (e) {
    console.error(`Failed to fetch iCal feed ${url}:`, e)
    return []
  }
}

// Back-compat aggregate over the built-in list (still used by nothing after the
// registry flip; retained for the seed/dev path and any direct callers).
export async function fetchIcalEvents(): Promise<RawEvent[]> {
  const out: RawEvent[] = []
  for (const feed of ICAL_FEEDS) out.push(...(await fetchIcalUrl(feed.url, feed.source_prefix)))
  return out
}
```

- [ ] **Step 2: Extract `fetchBlueskyEvents` in `lib/sources/social.ts`**

Split the two feed families. Replace `fetchSocialEvents` with:

```ts
// Bluesky search → events (parser 'bluesky'). Reddit feeds are now plain `rss`
// source rows dispatched by the generic rss parser, so they leave this file.
export async function fetchBlueskyEvents(): Promise<RawEvent[]> {
  const items = await fetchBlueskyItems()
  if (items.length === 0) return []
  return extractEvents(items)
}

// Retained aggregate for the dev/back-compat path (reddit + bluesky together).
export async function fetchSocialEvents(): Promise<RawEvent[]> {
  const [redditItems, blueskyItems] = await Promise.all([
    fetchFeeds(REDDIT_FEEDS, { limit: 25 }),
    fetchBlueskyItems(),
  ])
  const items = [...redditItems, ...blueskyItems]
  if (items.length === 0) return []
  return extractEvents(items)
}
```

- [ ] **Step 3: Verify existing tests + typecheck stay green**

Run: `npx vitest run lib/sources/parsers.test.ts && npx tsc --noEmit`
Expected: PASS (pure refactor; no signatures removed).

- [ ] **Step 4: Commit**

```bash
git add lib/sources/ical.ts lib/sources/social.ts
git commit -m "refactor(sources): single-feed fetchIcalUrl + fetchBlueskyEvents helpers"
```

---

## Task 4: Content-hash helper + hash-aware crawl parser

**Files:**
- Create: `lib/sources/content-hash.ts`
- Create: `lib/sources/content-hash.test.ts`
- Modify: `lib/sources/crawler.ts` (add `fetchCrawlSource`)

- [ ] **Step 1: Write the failing test**

Create `lib/sources/content-hash.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hashPageText } from './content-hash'

describe('hashPageText', () => {
  it('is stable and deterministic for the same input', () => {
    expect(hashPageText('hello world')).toBe(hashPageText('hello world'))
  })
  it('ignores leading/trailing whitespace and collapses runs', () => {
    expect(hashPageText('  a   b\n\nc ')).toBe(hashPageText('a b\nc'))
  })
  it('differs when meaningful content changes', () => {
    expect(hashPageText('event A tonight')).not.toBe(hashPageText('event B tonight'))
  })
  it('returns a 64-char hex sha256 digest', () => {
    expect(hashPageText('x')).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/sources/content-hash.test.ts`
Expected: FAIL — cannot find module `./content-hash`.

- [ ] **Step 3: Implement the hash**

Create `lib/sources/content-hash.ts`:

```ts
import { createHash } from 'node:crypto'

// Stable content fingerprint of a crawled page's readable text. Whitespace is
// normalized first so cosmetic reflow (re-minified HTML, changed indentation)
// doesn't defeat the skip; only meaningful text changes flip the hash. Used to
// skip the Gemini extraction call when a page is unchanged since last crawl
// (PRODUCT-SPEC §6.1 — the ~70–90% cost saving).
export function hashPageText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/sources/content-hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `fetchCrawlSource` to `lib/sources/crawler.ts`**

Add these imports at the top:

```ts
import type { RawEvent, SourceRow, SourceContext } from './types'
import { hashPageText } from './content-hash'
import { getSourceContentHash, setSourceContentHash } from '@/lib/db'
```

(Adjust the existing `import type { RawEvent } from './types'` line to the combined import above.) Then add:

```ts
// Crawl ONE configured source (parser 'crawl'). Fetches source.url, and — the
// Phase 2B cost lever — computes a content hash of the readable text and skips
// the expensive Gemini extraction when the page is byte-for-byte unchanged since
// the last successful crawl. Returns { events, skipped } so the orchestrator can
// record a budget-free 'skipped' run instead of a zero-event 'ok' one.
export async function fetchCrawlSource(
  source: SourceRow,
  _ctx: SourceContext
): Promise<{ events: RawEvent[]; skipped: boolean }> {
  if (!source.url) return { events: [], skipped: false }

  const page = await fetchPage(source.url)
  if (!page || page.text.length <= 80) return { events: [], skipped: false }

  const hash = hashPageText(page.text)
  const previous = await getSourceContentHash(source.id)
  if (previous && previous === hash) {
    // Unchanged since last crawl — no new events possible, so don't spend Gemini.
    return { events: [], skipped: true }
  }

  // Emit under the configured source name so provenance links to this row.
  const named: CrawlPage = { ...page, source: source.name }
  const events = await extractEventsFromPages([named])
  // Only persist the new hash after a successful extraction, so a transient
  // Gemini failure doesn't wrongly mark the page "seen" and skip it next run.
  await setSourceContentHash(source.id, hash)
  return { events, skipped: false }
}
```

Also update the existing `import type { CrawlPage } from '@/lib/extractor'` usage — `CrawlPage` is imported from `@/lib/extractor` at the top already; keep that.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run lib/sources/content-hash.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/sources/content-hash.ts lib/sources/content-hash.test.ts lib/sources/crawler.ts
git commit -m "feat(sources): content-hash crawl skipping (PRODUCT-SPEC §6.1)"
```

---

## Task 5: Parser registry (mechanisms keyed by `parser`)

**Files:**
- Modify: `lib/sources/types.ts` (add `SourceParser`)
- Rewrite: `lib/sources/registry.ts`
- Create: `lib/sources/registry.test.ts`

- [ ] **Step 1: Add the `SourceParser` interface**

Append to `lib/sources/types.ts`:

```ts
// A parser MECHANISM. Instances live in the DB (`SourceRow`); the code registry
// maps `SourceRow.parser` → one of these. `available()` replaces the old
// per-source enabled() API-key check: enabled(DB) AND available(code) must both
// hold or the run is recorded as `skipped`. `crawl` returns a skip flag so the
// orchestrator can distinguish "unchanged, didn't spend Gemini" from "found
// nothing".
export interface SourceParser {
  available(): boolean
  fetch(source: SourceRow, ctx: SourceContext): Promise<{ events: RawEvent[]; skipped: boolean }>
}
```

- [ ] **Step 2: Write the failing registry test**

Create `lib/sources/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PARSERS } from './registry'
import { getPgliteDb } from '@/lib/db/pglite'

describe('parser registry', () => {
  it('registers a parser for every seeded source parser value', async () => {
    const db = await getPgliteDb()
    const rows = await db.query<{ parser: string }>(`SELECT DISTINCT parser FROM sources`)
    for (const { parser } of rows) {
      expect(PARSERS[parser], `missing parser: ${parser}`).toBeDefined()
      expect(typeof PARSERS[parser].fetch).toBe('function')
      expect(typeof PARSERS[parser].available).toBe('function')
    }
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/sources/registry.test.ts`
Expected: FAIL — `PARSERS` is not exported (registry still exports `SOURCES`).

- [ ] **Step 4: Rewrite the registry**

Replace the entire contents of `lib/sources/registry.ts`:

```ts
import type { SourceParser, RawEvent } from './types'
import { fetchEventbriteEvents } from './eventbrite'
import { fetchIcalUrl } from './ical'
import { fetchTicketmasterEvents } from './ticketmaster'
import { fetchSeatGeekEvents } from './seatgeek'
import { fetchBlueskyEvents } from './social'
import { fetchYoutubeEvents } from './youtube'
import { fetchCrawlSource } from './crawler'
import { fetchFeed } from './rss'
import { extractEvents } from '@/lib/extractor'

const has = (v: string | undefined): boolean => !!v && v.length > 0
const hasGeminiKey = () => has(process.env.GEMINI_API_KEY)

// Wrap a plain RawEvent[] producer as a non-skipping parser (only `crawl`
// content-hashes, so everyone else always reports skipped:false).
const simple = (
  available: () => boolean,
  fetch: (url: string | null, name: string) => Promise<RawEvent[]>
): SourceParser => ({
  available,
  fetch: async (source) => ({ events: await fetch(source.url, source.name), skipped: false }),
})

// The parser registry: `SourceRow.parser` → mechanism. Instances (which
// feeds/venues/APIs) live in the `sources` table; this holds only the code that
// knows HOW to fetch each kind. Adding coverage of an existing kind is a DB
// INSERT; a genuinely new mechanism is one entry here.
export const PARSERS: Record<string, SourceParser> = {
  // Structured — no Gemini, always available.
  eventbrite: simple(() => true, () => fetchEventbriteEvents()),
  ical:       simple(() => true, (url, name) => fetchIcalUrl(url!, name)),

  // API-key gated.
  ticketmaster: simple(() => has(process.env.TICKETMASTER_API_KEY), () => fetchTicketmasterEvents()),
  seatgeek:     simple(() => has(process.env.SEATGEEK_CLIENT_ID),   () => fetchSeatGeekEvents()),

  // Gemini-extracted free text.
  rss:     simple(hasGeminiKey, (url, name) => fetchFeed(url!, name, { limit: 20 }).then(extractEvents)),
  bluesky: simple(hasGeminiKey, () => fetchBlueskyEvents()),

  // Crawl: content-hash aware, returns its own skip flag.
  crawl: { available: hasGeminiKey, fetch: (source, ctx) => fetchCrawlSource(source, ctx) },

  // YouTube needs both its API key and Gemini.
  youtube: simple(() => has(process.env.YOUTUBE_API_KEY) && hasGeminiKey(), () => fetchYoutubeEvents()),
}
```

> Note: `fetchFeed(url, source, opts)` returns `FeedItem[]`; `extractEvents(items)` turns them into `RawEvent[]` — so `rss` is `fetchFeed(...).then(extractEvents)`. This replaces `fetchNewspaperEvents`/reddit aggregates, which fanned out over hardcoded lists; now each feed is its own DB row.

- [ ] **Step 5: Run the registry test to verify it passes**

Run: `npx vitest run lib/sources/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck (will fail until Task 6 fixes the orchestrator)**

Run: `npx tsc --noEmit`
Expected: FAIL — `app/api/ingest/route.ts` still imports `SOURCES`/`SourceAdapter`. That's fixed in Task 6. Do not commit a broken typecheck: proceed straight to Task 6, then commit both together.

---

## Task 6: Orchestrator reads DB sources and dispatches by parser

**Files:**
- Modify: `app/api/ingest/route.ts`
- Modify: `lib/db/index.ts` (add optional `sourceId` to `startSourceRun`)
- Test: `lib/db/db.integration.test.ts` (startSourceRun with sourceId)

- [ ] **Step 1: Add `sourceId` to `startSourceRun`**

In `lib/db/index.ts`, replace `startSourceRun`:

```ts
// Open a run (status 'running'); returns its id so the orchestrator can close it
// with the final counts. `sourceId` links the run to its `sources` row (Phase
// 2B); null for legacy/ad-hoc callers.
export async function startSourceRun(source: string, sourceId?: number | null): Promise<number> {
  const db = await getDb()
  const rows = await db.query<{ id: number }>(
    `INSERT INTO source_runs (source, source_id, status) VALUES ($1, $2, 'running') RETURNING id`,
    [source, sourceId ?? null]
  )
  return rows[0].id
}
```

> This references `source_runs.source_id`, added in migration 009 (Task 7). Because PGlite applies all migrations at init, 009 must exist before this query runs in tests. **Do Task 7's migration first if running tests between steps**, or run Task 6 + 7 together. (Ordering note: 009 is numbered after 008 and picked up automatically; nothing else depends on step order within this task.)

- [ ] **Step 2: Write the failing test**

Add to `lib/db/db.integration.test.ts`:

```ts
import { startSourceRun, finishSourceRun, recentSourceRuns } from './index'

describe('source_runs source_id (Phase 2B)', () => {
  it('stamps source_id on the run row', async () => {
    const db = await getPgliteDb()
    const src = (await db.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'eventbrite'`))[0]
    const runId = await startSourceRun('eventbrite', src.id)
    await finishSourceRun(runId, { status: 'ok', events_found: 1, events_upserted: 1 })
    const row = (await db.query<{ source_id: number }>(
      `SELECT source_id FROM source_runs WHERE id = $1`, [runId]
    ))[0]
    expect(row.source_id).toBe(src.id)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/db/db.integration.test.ts -t "source_runs source_id"`
Expected: FAIL — `column "source_id" of relation "source_runs" does not exist` (until 009 lands) or arity mismatch. This drives Task 7.

- [ ] **Step 4: Rewrite the orchestrator**

Replace `app/api/ingest/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { PARSERS } from '@/lib/sources/registry'
import type { SourceRow, SourceContext } from '@/lib/sources/types'
import { persistEvents } from '@/lib/persist'
import { isLocal, getEnabledSources, startSourceRun, finishSourceRun, touchSourceSuccess } from '@/lib/db'
import { withGeminiMeter } from '@/lib/gemini'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

// Austin until Phase 3 wires multi-city through the orchestrator.
const CITY_ID = 1

function contextFor(source: SourceRow): SourceContext {
  return {
    city: 'austin',
    since: new Date(),
    logger: {
      log: (...a) => console.log(`[${source.name}]`, ...a),
      warn: (...a) => console.warn(`[${source.name}]`, ...a),
      error: (...a) => console.error(`[${source.name}]`, ...a),
    },
  }
}

// Run one configured source end to end, wrapped in a source_runs record linked to
// its sources row. A missing parser or unavailable mechanism (no API key) is a
// visible `skipped`, never a silent empty source.
async function runSource(source: SourceRow): Promise<{ upserted: number; found: number; rejected: number }> {
  const parser = PARSERS[source.parser]
  if (!parser || !parser.available()) {
    const id = await startSourceRun(source.name, source.id)
    await finishSourceRun(id, { status: 'skipped', error: parser ? 'parser unavailable (missing key)' : `unknown parser: ${source.parser}` })
    return { upserted: 0, found: 0, rejected: 0 }
  }

  const id = await startSourceRun(source.name, source.id)
  try {
    const { result, meter } = await withGeminiMeter(async () => {
      const { events, skipped } = await parser.fetch(source, contextFor(source))
      if (skipped) return { skipped: true as const, persist: null }
      return { skipped: false as const, persist: await persistEvents(events) }
    })

    if (result.skipped) {
      // Content-hash short-circuit: page unchanged, no Gemini spent.
      await finishSourceRun(id, { status: 'skipped', error: 'unchanged since last crawl' })
      await touchSourceSuccess(source.id)
      return { upserted: 0, found: 0, rejected: 0 }
    }

    const { inserted, rejected, total } = result.persist!
    const budgetBlocked = meter.requests === 0 && meter.skippedForBudget > 0 && total === 0
    await finishSourceRun(id, {
      status: budgetBlocked ? 'skipped' : 'ok',
      events_found: total,
      events_upserted: inserted,
      events_rejected: rejected,
      gemini_requests: meter.requests,
      error: meter.skippedForBudget > 0 ? `${meter.skippedForBudget} Gemini calls skipped (daily budget)` : null,
    })
    if (!budgetBlocked) await touchSourceSuccess(source.id)
    return { upserted: inserted, found: total, rejected }
  } catch (e) {
    console.error(`Source ${source.name} failed:`, e)
    await finishSourceRun(id, { status: 'error', error: (e as Error).message?.slice(0, 500) ?? 'unknown' })
    return { upserted: 0, found: 0, rejected: 0 }
  }
}

async function runIngest() {
  const sources = await getEnabledSources(CITY_ID)
  const results = await Promise.all(
    sources.map(async source => ({ name: source.name, ...(await runSource(source)) }))
  )

  const bySource: Record<string, number> = {}
  let inserted = 0, found = 0, rejected = 0
  for (const r of results) {
    bySource[r.name] = r.upserted
    inserted += r.upserted
    found += r.found
    rejected += r.rejected
  }

  return NextResponse.json({ inserted, rejected, total: found, bySource, mode: isLocal() ? 'local' : 'supabase' })
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  return runIngest()
}

// Vercel Cron invokes scheduled jobs with GET (carrying the CRON_SECRET bearer).
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  return runIngest()
}
```

- [ ] **Step 5: Run typecheck (still fails on 009 until Task 7)**

Run: `npx tsc --noEmit`
Expected: PASS for the orchestrator/registry now. Proceed to Task 7 for the migration, then run the integration tests together.

- [ ] **Step 6: (After Task 7) run the stamping test**

Run: `npx vitest run lib/db/db.integration.test.ts -t "source_runs source_id"`
Expected: PASS.

- [ ] **Step 7: Commit (with Task 7)**

Commit the orchestrator, registry, and 009 migration together so no commit has a broken build:

```bash
git add app/api/ingest/route.ts lib/sources/registry.ts lib/sources/types.ts lib/sources/registry.test.ts lib/db/index.ts
git commit -m "feat(ingest): dispatch DB-configured sources by parser + stamp source_id"
```

---

## Task 7: `source_id` FK migration + backfill

**Files:**
- Create: `supabase/migrations/009_source_id_fk.sql`
- Modify: `lib/db/index.ts` (`recordProvenance` sets `source_id`; `SourceRun` type gains `source_id`)
- Test: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/db/db.integration.test.ts`:

```ts
import { recordProvenance } from './index'

describe('event_sources.source_id backfill + stamping (migration 009)', () => {
  it('backfills legacy provenance rows by name and stamps new ones', async () => {
    const db = await getPgliteDb()
    // Baseline seed rows use source 'seed' which has no sources row → source_id null.
    // eventbrite has a sources row, so a new provenance row resolves its id.
    const ev = (await db.query<{ id: string }>(`SELECT id FROM events LIMIT 1`))[0]
    await recordProvenance({ eventId: ev.id, source: 'eventbrite', externalId: 'eb-test-1', url: null, raw: {} })
    const row = (await db.query<{ source_id: number | null }>(
      `SELECT es.source_id FROM event_sources es WHERE es.external_id = 'eb-test-1'`
    ))[0]
    const eb = (await db.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'eventbrite'`))[0]
    expect(row.source_id).toBe(eb.id)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/db/db.integration.test.ts -t "source_id backfill"`
Expected: FAIL — `column es.source_id does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/009_source_id_fk.sql`:

```sql
-- Phase 2B: link the observability ledger and provenance to the sources table.
-- source_runs.source and event_sources.source (TEXT) were placeholders for this
-- FK (see migrations 006, 007). We ADD source_id and backfill by matching the
-- legacy text to sources.name — we keep the TEXT columns for human readability
-- and for rows whose source predates the sources table (source_id stays NULL).

ALTER TABLE source_runs   ADD COLUMN source_id INT REFERENCES sources(id);
ALTER TABLE event_sources ADD COLUMN source_id INT REFERENCES sources(id);

-- Backfill: every seeded sources.name equals the RawEvent.source string these
-- rows were written with, so this is an exact join.
UPDATE source_runs   sr SET source_id = s.id FROM sources s WHERE sr.source = s.name;
UPDATE event_sources es SET source_id = s.id FROM sources s WHERE es.source = s.name;

CREATE INDEX source_runs_source_id   ON source_runs(source_id);
CREATE INDEX event_sources_source_id ON event_sources(source_id);
```

- [ ] **Step 4: Stamp `source_id` in `recordProvenance`**

In `lib/db/index.ts`, replace `recordProvenance` so new rows resolve `source_id` from `sources.name` (a subquery — no signature change, works for ingest and import alike; NULL when no matching row, e.g. `seed`/`import`):

```ts
export async function recordProvenance(p: {
  eventId: string
  source: string
  externalId: string
  url: string | null
  raw: unknown
}): Promise<void> {
  const db = await getDb()
  await db.query(
    `INSERT INTO event_sources (event_id, source, source_id, external_id, url, raw, ingested_at)
     VALUES ($1, $2, (SELECT id FROM sources WHERE name = $2), $3, $4, $5, NOW())
     ON CONFLICT (source, external_id) DO UPDATE SET
       event_id = EXCLUDED.event_id, source_id = EXCLUDED.source_id,
       url = EXCLUDED.url, raw = EXCLUDED.raw, ingested_at = NOW()`,
    [p.eventId, p.source, p.externalId, p.url, JSON.stringify(p.raw)]
  )
}
```

Also add `source_id: number | null` to the exported `SourceRun` type so reads of `source_runs.*` are typed:

```ts
export type SourceRun = {
  id: number
  source: string
  source_id: number | null
  started_at: string
  // ...unchanged fields...
}
```

- [ ] **Step 5: Update the PGlite baseline seed to write `source_id`**

`lib/db/pglite.ts`'s `seedBaselineEvents` inserts `event_sources` directly. Baseline `seed` events have no `sources` row, so `source_id` stays NULL — no change needed, but confirm the insert still works (it omits `source_id`, which now defaults to NULL). No edit required; verify in Step 6.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run lib/db/db.integration.test.ts`
Expected: PASS (all describe blocks, including 009 backfill and the Task 6 stamping test).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/009_source_id_fk.sql lib/db/index.ts
git commit -m "feat(db): source_id FK on source_runs + event_sources with name backfill"
```

---

## Task 8: Seed ~50 Austin T3 venue sources

**Files:**
- Create: `supabase/migrations/010_austin_venues.sql`
- Test: `lib/db/db.integration.test.ts` (venue count)

- [ ] **Step 1: Write the failing test**

Add to `lib/db/db.integration.test.ts`:

```ts
describe('Austin venue sources (migration 010)', () => {
  it('seeds a substantial set of enabled crawl/ical venue sources', async () => {
    const db = await getPgliteDb()
    const rows = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sources WHERE notes = 'venue' AND enabled = true`
    )
    expect(parseInt(rows[0].n, 10)).toBeGreaterThanOrEqual(40)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/db/db.integration.test.ts -t "venue sources"`
Expected: FAIL — count is 0.

- [ ] **Step 3: Write the venue-seed migration**

Create `supabase/migrations/010_austin_venues.sql`. Each row is a T3 venue calendar/listing page crawled by Gemini (`parser 'crawl'`) or an official iCal where the venue publishes one. `notes = 'venue'` tags them for the test + ops filtering. Names follow the `crawl:<hostSlug>` convention. **Use real Austin venue event-page URLs**; the set below is the launch payload (PRODUCT-SPEC §1.1 T3, §3.2 playbook). Trim/extend to the venues that actually publish crawlable calendars:

```sql
-- Phase 2B: ~50 Austin T3 venue sources — the coverage payload that makes the
-- app "feel complete to a local" (PRODUCT-SPEC §1.1). Each is a DB row, not a
-- parser: adding/removing a venue is an INSERT/UPDATE, never a code change.
INSERT INTO sources (name, kind, url, parser, cadence, notes) VALUES
  ('crawl:mohawkaustin-com',        'crawl', 'https://mohawkaustin.com/calendar/', 'crawl', 'daily',  'venue'),
  ('crawl:theparishaustin-com',     'crawl', 'https://theparishaustin.com/calendar/', 'crawl', 'daily', 'venue'),
  ('crawl:continentalclub-com',     'crawl', 'https://continentalclub.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:antonesnightclub-com',    'crawl', 'https://antonesnightclub.com/calendar/', 'crawl', 'daily', 'venue'),
  ('crawl:emosaustin-com',          'crawl', 'https://www.emosaustin.com/shows', 'crawl', 'daily', 'venue'),
  ('crawl:stubbsaustin-com',        'crawl', 'https://www.stubbsaustin.com/calendar/', 'crawl', 'daily', 'venue'),
  ('crawl:austintheatre-org',       'crawl', 'https://www.austintheatre.org/events/', 'crawl', 'daily', 'venue'),
  ('crawl:themoodyamphitheater-com','crawl', 'https://www.themoodyamphitheater.com/events', 'crawl', 'daily', 'venue'),
  ('crawl:acl-live-com',            'crawl', 'https://www.acl-live.com/calendar', 'crawl', 'daily', 'venue'),
  ('crawl:capcitycomedy-com',       'crawl', 'https://www.capcitycomedy.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:thelongcenter-org',       'crawl', 'https://thelongcenter.org/events/', 'crawl', 'daily', 'venue'),
  ('crawl:paramountaustin-com',     'crawl', 'https://www.austintheatre.org/paramount/', 'crawl', 'daily', 'venue'),
  ('crawl:scootinn-com',            'crawl', 'https://scootinnaustin.com/events/', 'crawl', 'daily', 'venue'),
  ('crawl:thebellhouse-com',        'crawl', 'https://www.c-boys.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:sahararoom-com',          'crawl', 'https://www.saharalounge.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:elephantroom-com',        'crawl', 'https://elephantroom.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:thewhiteHorseaustin-com', 'crawl', 'https://www.thewhitehorseaustin.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:hotelvegas-com',          'crawl', 'https://www.texashotelvegas.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:cheerupcharlies-com',     'crawl', 'https://cheerupcharlies.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:radioeastaustin-com',     'crawl', 'https://www.radioeast.co/', 'crawl', 'weekly', 'venue'),
  ('crawl:empireatx-com',           'crawl', 'https://empireatx.com/calendar/', 'crawl', 'daily', 'venue'),
  ('crawl:3ten-acl-live-com',       'crawl', 'https://www.acl-live.com/3ten/calendar', 'crawl', 'daily', 'venue'),
  ('crawl:germaniainsurance-com',   'crawl', 'https://www.germaniainsurancetheater.com/events', 'crawl', 'daily', 'venue'),
  ('crawl:bassconcerthall-org',     'crawl', 'https://texasperformingarts.org/calendar', 'crawl', 'daily', 'venue'),
  ('crawl:zilkerpark-org',          'crawl', 'https://www.austintexas.gov/department/zilker-metropolitan-park', 'crawl', 'weekly', 'venue'),
  ('crawl:thecontinentalclub-gallery','crawl','https://continentalclub.com/gallery', 'crawl', 'weekly', 'venue'),
  ('crawl:sagebrushaustin-com',     'crawl', 'https://www.sagebrushtexas.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:brokenspokeaustintx-com', 'crawl', 'https://brokenspokeaustintx.net/', 'crawl', 'weekly', 'venue'),
  ('crawl:donsdepot-com',           'crawl', 'https://www.donsdepot.net/', 'crawl', 'weekly', 'venue'),
  ('crawl:evangelinecafe-com',      'crawl', 'https://www.evangelinecafe.com/music', 'crawl', 'weekly', 'venue'),
  ('crawl:gueros-com',              'crawl', 'https://www.guerostacobar.com/music/', 'crawl', 'weekly', 'venue'),
  ('crawl:thetavernaustin-com',     'crawl', 'https://www.thetavernaustin.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:mohawk-outdoor',          'crawl', 'https://mohawkaustin.com/', 'crawl', 'weekly', 'venue'),
  ('crawl:vortexrep-org',           'crawl', 'https://www.vortexrep.org/upcoming', 'crawl', 'weekly', 'venue'),
  ('crawl:zachtheatre-org',         'crawl', 'https://www.zachtheatre.org/shows/', 'crawl', 'daily', 'venue'),
  ('crawl:hydeparktheatre-org',     'crawl', 'https://hydeparktheatre.org/', 'crawl', 'weekly', 'venue'),
  ('crawl:coldtowne-com',           'crawl', 'https://coldtownetheater.com/shows', 'crawl', 'weekly', 'venue'),
  ('crawl:fallouttheater-com',      'crawl', 'https://fallouttheater.com/shows/', 'crawl', 'weekly', 'venue'),
  ('crawl:austinsymphony-org',      'crawl', 'https://austinsymphony.org/concerts/', 'crawl', 'weekly', 'venue'),
  ('crawl:laguna-gloria',           'crawl', 'https://thecontemporaryaustin.org/whats-on/', 'crawl', 'weekly', 'venue'),
  ('crawl:blantonmuseum-org',       'crawl', 'https://blantonmuseum.org/events/', 'crawl', 'weekly', 'venue'),
  ('crawl:thethinkeryaustin-org',   'crawl', 'https://thinkeryaustin.org/visit/calendar/', 'crawl', 'weekly', 'venue'),
  ('crawl:austinbotanical',         'crawl', 'https://zilkergarden.org/events/', 'crawl', 'weekly', 'venue'),
  ('crawl:umlaufsculpture-org',     'crawl', 'https://www.umlaufsculpture.org/events', 'crawl', 'weekly', 'venue'),
  ('crawl:jewishaustin-org',        'crawl', 'https://www.shalomaustin.org/events', 'crawl', 'weekly', 'venue'),
  ('crawl:centrallibrary-atx',      'crawl', 'https://library.austintexas.gov/events', 'crawl', 'daily', 'venue'),
  ('crawl:centralmarket-com',       'crawl', 'https://www.centralmarket.com/events', 'crawl', 'weekly', 'venue'),
  ('crawl:mueller-atx',             'crawl', 'https://www.muelleraustin.com/events/', 'crawl', 'weekly', 'venue'),
  ('crawl:thedomain-atx',           'crawl', 'https://www.simon.com/mall/the-domain/events', 'crawl', 'weekly', 'venue'),
  ('crawl:austinfc-com',            'crawl', 'https://www.austinfc.com/schedule/', 'crawl', 'weekly', 'venue'),
  ('crawl:utathletics-com',         'crawl', 'https://texassports.com/calendar', 'crawl', 'weekly', 'venue');
```

> These URLs are the launch set; some will 404 or block the light fetcher — that's expected and *safe*: the crawler returns `[]` on failure and the source is recorded as a zero-event `ok`/`error` run in `source_runs`, visible in `/api/admin/health` for ops to prune or fix. The point of Phase 2B is that pruning/fixing is a DB `UPDATE`, not a code change. Verify each host's `hostSlug` matches its `name` where you rely on the backfill; for brand-new venues (no history) the name only needs to be unique.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/db/db.integration.test.ts -t "venue sources"`
Expected: PASS (≥40 venue rows).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/010_austin_venues.sql lib/db/db.integration.test.ts
git commit -m "feat(sources): seed ~50 Austin T3 venue sources (PRODUCT-SPEC §1.1)"
```

---

## Task 9: Prune dead code + full verification

**Files:**
- Modify: `lib/sources/newspapers.ts` (delete — folded into rss source rows) OR keep as unused; decide below.
- Verify: full suite, typecheck, lint, build.

- [ ] **Step 1: Remove now-unreferenced source aggregators**

The registry no longer imports `fetchNewspaperEvents` or `fetchCrawlEvents` (the multi-URL aggregates) or `fetchSocialEvents` (reddit+bluesky). Search for remaining references:

Run: `grep -rn "fetchNewspaperEvents\|fetchCrawlEvents\|fetchSocialEvents\|SOURCES\b\|SourceAdapter" lib app --include=*.ts | grep -v node_modules`
Expected: only definitions remain, no importers.

Delete `lib/sources/newspapers.ts` (its feeds are now DB rows; nothing imports it). Remove the now-unused `fetchCrawlEvents` from `crawler.ts` and `fetchSocialEvents` from `social.ts` **only if** the grep shows no importers (keep `fetchBlueskyEvents`, `fetchCrawlSource`, `fetchIcalUrl`, `fetchPage`, `pageFromHtml`). Keep `fetchIcalEvents` only if a test references it; otherwise delete. Do NOT delete anything a test imports — check `grep -rn "from '@/lib/sources" lib --include=*.test.ts`.

- [ ] **Step 2: Remove the dead `SourceAdapter` type**

If the `grep` in Step 1 shows no remaining `SourceAdapter` importers, delete the `SourceAdapter` interface from `lib/sources/types.ts` (it's superseded by `SourceParser`). Keep `RawEvent`, `SourceContext`, `SourceKind`, `SourceRow`, `SourceParser`.

- [ ] **Step 3: Full verification**

Run each and confirm PASS:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Expected: typecheck clean, lint clean, all Vitest suites green, Next build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(sources): drop superseded adapters/aggregates after registry flip"
```

---

## Self-Review

**Spec coverage (PRODUCT-SPEC §1.2, §6.1; Phase 2A plan's 2B bullet):**

- `sources` table with the §1.2 schema → Task 1. ✅ (`content_hash`, `cadence`, `enabled`, `parser`, `city_id` all present.)
- Registry dispatch by `parser` → Tasks 5–6. ✅
- Seed today's ~11 sources → Task 1; ~50 Austin venues → Task 8. ✅
- Content-hash crawl skipping → Task 4 (`hashPageText`) + Task 6 (skip run). ✅
- `source_runs.source` + `event_sources.source` → `source_id` FK → Task 7. ✅
- `enabled()` silent-[]-return replaced by `available()` + `skipped` runs → Tasks 5–6. ✅

**Not in scope (correctly deferred):** full `[city]` routing (Phase 3), user submissions (2C), programmatic SEO (2D), embeddings (Phase 4), per-source Gemini batch/token governance beyond the existing meter (PRODUCT-SPEC §6.3–6.4 — the content-hash lever is the 2B piece; batching/cadence-weekly enforcement can ride 2C or a follow-up).

**Type consistency:** `SourceRow` fields match the 008 columns; `SourceParser.fetch` returns `{ events, skipped }` everywhere (crawler returns it natively; `simple()` wraps producers with `skipped:false`); `startSourceRun(source, sourceId?)` arity matches its one caller; `recordProvenance` signature unchanged (source_id via subquery).

**Open item to confirm during execution:** the `cadence = 'weekly'` column is seeded but not yet *enforced* (every enabled source runs each ingest). Enforcing "weekly sources only run on Mondays" is a small orchestrator filter; if the cron runs daily it's a cost item, not correctness. Left as a fast-follow — noted in Task 8's migration comment. If desired, add to `getEnabledSources` a `AND (cadence = 'daily' OR EXTRACT(DOW FROM now()) = 1)` clause, but that needs a test with an injectable clock, so it's deliberately out of this plan.

---

*Phase 2B done-state: adding or removing a source is a SQL `INSERT`/`UPDATE`; the ingest orchestrator is driven entirely by the `sources` table; every run and every provenance row is linked to its source via `source_id`; unchanged crawl pages cost zero Gemini requests. This unblocks 2C (user submissions add `sources` rows) and Phase 3 (multi-city iterates `sources` per city).*
