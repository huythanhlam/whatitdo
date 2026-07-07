# Phase 2A — Dedup Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's `UNIQUE(source, source_id)` dedup — which lists the same concert once per source — with canonical events + an `event_sources` provenance table + a trigram matching pipeline in `persist.ts`, so the same event from N sources collapses into one record with N sources of provenance.

**Architecture:** A single migration adds a minimal `cities` scaffold, normalized match keys (`title_norm`, `venue_norm`) and `city_id` to `events`, the `event_sources` provenance table, and `pg_trgm` trigram indexes; it drops the cross-source `UNIQUE`. Matching runs at persist time as **block → score → merge → provenance**: block candidates by (city, ±2h, venue), score by `pg_trgm` title similarity (computed in SQL), apply a pure threshold policy, merge field-wise with source-trust tiebreaks, and always write an `event_sources` row. Pure policy (thresholds, field merge, normalization) is isolated in `lib/normalize.ts` + `lib/dedup.ts` and unit-tested; the DB-touching pipeline is integration-tested against PGlite.

**Tech Stack:** PostgreSQL / PGlite 0.5.3 (`pg_trgm` contrib), TypeScript, Vitest.

---

## Phase 2 decomposition (context)

Per PRODUCT-SPEC §7, Phase 2 (Coverage & dedup) is split into four sub-plans. **This document is 2A only** — the root dependency the rest build on:

- **2A — Dedup foundation** (this plan): canonical events + `event_sources` + trigram matching + minimal `cities`.
- **2B — Config-driven sources**: `sources` table, registry dispatch by `parser`, seed ~50 Austin venues, content-hash crawl skipping, migrate `source_runs.source` + `event_sources.source` → `source_id` FK.
- **2C — User submissions**: public form → auth'd `/api/import` → `pending` status → admin approve.
- **2D — Programmatic SEO pages**: config array of (slug, filters, copy) over `listEvents`, statically generated.

`cities` is introduced here **minimally** (table + Austin seed + `city_id` FK); full `[city]` routing / per-city sitemaps stay in Phase 3.

Already done in Phase 1 and therefore NOT in this plan: real FTS (`websearch_to_tsquery` is wired in `listEvents`), `/api/admin/health`.

---

## File Structure

- `supabase/migrations/007_dedup_foundation.sql` — **create.** The one schema change: `pg_trgm`, `cities`, `events` match-key columns, `event_sources`, dedup indexes, drop old UNIQUE, backfill provenance. Applied to both drivers by the existing runner.
- `lib/db/pglite.ts` — **modify.** Register the `pg_trgm` contrib extension at construction; update the baseline seed to write `event_sources` and the new columns (its old `ON CONFLICT (source, source_id)` breaks once the UNIQUE is dropped).
- `lib/normalize.ts` — **create.** Pure `normalizeTitle(title, venueName?)` and `normalizeVenue(venue)`. No imports from db/sources — safe to import anywhere.
- `lib/normalize.test.ts` — **create.** Unit tests for normalization.
- `lib/dedup.ts` — **create.** Pure policy: `chooseMatch`, `mergeFields`, `sourceTrust`. Plus the `Candidate`/`ExistingEvent`/`FieldPatch` types.
- `lib/dedup.test.ts` — **create.** Unit tests for the policy.
- `lib/db/index.ts` — **modify.** Remove `upsertEvent`; add the dedup pipeline queries (`findEventBySource`, `findDedupCandidates`, `insertEvent`, `getEventRow`, `updateEventFields`, `recordProvenance`, `getEventSources`); add `event_sources` to `getEvent`'s read.
- `lib/db/db.integration.test.ts` — **modify.** Add integration tests for the new queries + end-to-end dedup against PGlite.
- `lib/persist.ts` — **modify.** Rewrite `processOne` into the block→score→merge→provenance pipeline; keep `persistEvents`'s signature and return shape.
- `app/events/[id]/page.tsx` — **modify.** Render "Also listed on …" from provenance.

---

## Conventions used below

- **Austin `city_id` is `1`** (first `SERIAL` insert). The migration also sets it as the column `DEFAULT`, so inserts that omit `city_id` still land in Austin until Phase 3.
- Run a single Vitest file with: `npx vitest run <path>`.
- The migration runner (`lib/db/migrate.ts`) applies `supabase/migrations/*.sql` in filename order to both PGlite (at init) and Postgres (`npm run migrate`); a new numbered file is picked up automatically.

---

## Task 1: Schema migration + keep PGlite bootable

**Files:**
- Create: `supabase/migrations/007_dedup_foundation.sql`
- Modify: `lib/db/pglite.ts` (register `pg_trgm`; fix baseline seed)
- Test: `lib/db/db.integration.test.ts` (add a migration-shape test)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/007_dedup_foundation.sql`:

```sql
-- Phase 2A: canonical events + cross-source provenance + trigram dedup.
-- The same concert from two sources becomes ONE events row with two
-- event_sources rows, instead of two duplicate events.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Minimal cities scaffold. Full [city] routing is Phase 3; this exists now so
-- events/sources can carry city_id and the dedup block index matches the spec.
CREATE TABLE cities (
  id       SERIAL PRIMARY KEY,
  slug     TEXT UNIQUE NOT NULL,
  name     TEXT NOT NULL,
  state    TEXT NOT NULL DEFAULT 'TX',
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  lat      NUMERIC,
  lng      NUMERIC,
  enabled  BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO cities (slug, name) VALUES ('austin', 'Austin');

-- events becomes canonical: add city + normalized match keys.
ALTER TABLE events ADD COLUMN city_id    INT REFERENCES cities(id);
ALTER TABLE events ADD COLUMN title_norm TEXT;
ALTER TABLE events ADD COLUMN venue_norm TEXT;

-- Backfill existing rows to Austin, then enforce + default.
UPDATE events SET city_id = (SELECT id FROM cities WHERE slug = 'austin')
WHERE city_id IS NULL;
ALTER TABLE events ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE events ALTER COLUMN city_id SET DEFAULT 1;

-- Per-source provenance. external_id is the old events.source_id; the
-- (source, external_id) primary key preserves exactly the dedup key that
-- events.UNIQUE(source, source_id) used to enforce, and becomes a source_id FK
-- in Phase 2B (mirrors source_runs.source).
CREATE TABLE event_sources (
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url         TEXT,
  raw         JSONB,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_id)
);
CREATE INDEX event_sources_event ON event_sources(event_id);

-- Backfill provenance from existing events (one row each). COALESCE guards the
-- nullable legacy source_id; a UUID cast can't collide with a real external id.
INSERT INTO event_sources (event_id, source, external_id, url)
SELECT id, source, COALESCE(source_id, id::text), ticket_url FROM events;

-- Drop the constraint that blocked cross-source collapse. Named guard is safe on
-- both drivers (Postgres default constraint name is <table>_<cols>_key).
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_source_id_key;

-- Dedup indexes: block by (city, date, venue), score by title trigram similarity.
CREATE INDEX events_dedup_block ON events (city_id, (start_time::date), venue_norm);
CREATE INDEX events_title_trgm  ON events USING GIN (title_norm gin_trgm_ops);

-- RLS parity with the existing tables.
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read cities" ON cities FOR SELECT USING (true);

ALTER TABLE event_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read event_sources" ON event_sources FOR SELECT USING (true);
CREATE POLICY "Service role write event_sources" ON event_sources
  FOR ALL USING (auth.role() = 'service_role');
```

- [ ] **Step 2: Register `pg_trgm` in PGlite and fix the baseline seed**

`pg_trgm` is a loadable contrib extension in PGlite 0.5.3 — it must be passed at construction for `CREATE EXTENSION pg_trgm` to resolve. Also, `seedBaselineEvents` currently upserts with `ON CONFLICT (source, source_id)`, which errors once the UNIQUE is dropped; rewrite it to write the new columns + provenance.

In `lib/db/pglite.ts`, change the imports at the top:

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { fetchSeedEvents } from '@/lib/sources/seed'
import { tagByKeyword } from '@/lib/tagger'
import { imageForCategories } from '@/lib/images'
import { normalizeTitle, normalizeVenue } from '@/lib/normalize'
import type { Db } from './driver'
import { migrate } from './migrate'
```

Change the constructor in `init()`:

```typescript
async function init(): Promise<Db> {
  const pg = new PGlite({ extensions: { pg_trgm } })
  await pg.exec(PREAMBLE)
  const db = wrap(pg)
  await migrate(db)
  await seedBaselineEvents(db)
  return db
}
```

Replace the body of `seedBaselineEvents` (the per-event loop) with a provenance-aware insert:

```typescript
async function seedBaselineEvents(db: Db): Promise<void> {
  const slugToId = new Map<string, number>()
  const cats = await db.query<{ id: number; slug: string }>(`SELECT id, slug FROM categories`)
  for (const c of cats) slugToId.set(c.slug, c.id)

  const events = await fetchSeedEvents()

  for (const raw of events) {
    // Idempotent: skip if this (source, external_id) is already recorded.
    const seen = await db.query<{ event_id: string }>(
      `SELECT event_id FROM event_sources WHERE source = $1 AND external_id = $2`,
      [raw.source, raw.source_id]
    )
    if (seen.length > 0) continue

    const slugs = tagByKeyword(raw.title, raw.description)
    const imageUrl = raw.image_url ?? imageForCategories(slugs)
    const venueNorm = normalizeVenue(raw.venue_name)
    const titleNorm = normalizeTitle(raw.title, raw.venue_name)

    const res = await db.query<{ id: string }>(
      `INSERT INTO events (title, description, start_time, end_time, venue_name,
        venue_address, image_url, ticket_url, source, source_id, is_free,
        price_min, price_max, city_id, title_norm, venue_norm, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, 1, $14, $15, NOW())
       RETURNING id`,
      [raw.title, raw.description, raw.start_time, raw.end_time, raw.venue_name,
       raw.venue_address, imageUrl, raw.ticket_url, raw.source, raw.source_id,
       raw.is_free, raw.price_min, raw.price_max, titleNorm, venueNorm]
    )
    const eventId = res[0]?.id
    if (!eventId) continue

    await db.query(
      `INSERT INTO event_sources (event_id, source, external_id, url)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [eventId, raw.source, raw.source_id, raw.ticket_url]
    )

    for (const slug of slugs) {
      const cid = slugToId.get(slug)
      if (!cid) continue
      await db.query(
        `INSERT INTO event_categories (event_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [eventId, cid]
      )
    }
  }
}
```

> Note: this step imports `@/lib/normalize`, created in Task 2. If executing strictly in order, create the two functions' signatures in Task 2 first, or accept that `lib/db` won't type-check until Task 2 lands. The commit for this task should therefore be made after Task 2 (see Step 5); do Steps 1–4 here, then Task 2, then commit both. Subagent execution: run Task 2 immediately after Task 1's edits and before verifying.

- [ ] **Step 3: Add a migration-shape integration test**

In `lib/db/db.integration.test.ts`, add a test that a fresh PGlite instance has the new schema (this also proves `pg_trgm` loaded):

```typescript
import { getPgliteDb } from './pglite'

it('applies the dedup-foundation migration on a fresh PGlite instance', async () => {
  const db = await getPgliteDb()

  // pg_trgm is available
  const sim = await db.query<{ s: number }>(`SELECT similarity('austin blues', 'austin blues fest') AS s`)
  expect(sim[0].s).toBeGreaterThan(0)

  // cities seeded with Austin at id 1
  const city = await db.query<{ id: number; slug: string }>(`SELECT id, slug FROM cities WHERE slug = 'austin'`)
  expect(city[0]).toMatchObject({ id: 1, slug: 'austin' })

  // events has the new columns and no cross-source UNIQUE
  const cols = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'events'`
  )
  const names = cols.map(c => c.column_name)
  expect(names).toEqual(expect.arrayContaining(['city_id', 'title_norm', 'venue_norm']))

  // event_sources exists and was backfilled for every seeded event
  const counts = await db.query<{ e: string; s: string }>(
    `SELECT (SELECT count(*) FROM events)::text AS e, (SELECT count(*) FROM event_sources)::text AS s`
  )
  expect(Number(counts[0].s)).toBeGreaterThanOrEqual(Number(counts[0].e))
})
```

- [ ] **Step 4: Run the test to verify it passes** (after Task 2 lands `lib/normalize.ts`)

Run: `npx vitest run lib/db/db.integration.test.ts`
Expected: PASS (including the new migration-shape test). If `pg_trgm` fails to load, the `similarity(...)` query throws — that means the `extensions` option in Step 2 is wrong.

- [ ] **Step 5: Commit** (jointly with Task 2)

```bash
git add supabase/migrations/007_dedup_foundation.sql lib/db/pglite.ts lib/normalize.ts lib/normalize.test.ts lib/db/db.integration.test.ts
git commit -m "feat(db): dedup-foundation schema — cities, event_sources, trigram indexes"
```

---

## Task 2: Normalization pure functions

**Files:**
- Create: `lib/normalize.ts`
- Test: `lib/normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/normalize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeTitle, normalizeVenue } from './normalize'

describe('normalizeVenue', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeVenue("Antone's  Nightclub!")).toBe('antones nightclub')
  })
  it('returns null for null/empty', () => {
    expect(normalizeVenue(null)).toBeNull()
    expect(normalizeVenue('   ')).toBeNull()
  })
})

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle('Live Music: The Black Angels!')).toBe('the black angels')
  })
  it('strips a leading "X presents" promoter prefix', () => {
    expect(normalizeTitle('C3 Presents The Black Angels')).toBe('the black angels')
  })
  it('strips a trailing "live at <venue>" suffix', () => {
    expect(normalizeTitle('The Black Angels Live at Mohawk')).toBe('the black angels')
  })
  it('strips the venue name out of the title when given', () => {
    expect(normalizeTitle("The Black Angels at Antone's", "Antone's")).toBe('the black angels')
  })
  it('is stable — normalizing an already-normalized title is a no-op', () => {
    const once = normalizeTitle('C3 Presents The Black Angels Live at Mohawk')
    expect(normalizeTitle(once)).toBe(once)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/normalize.test.ts`
Expected: FAIL — `normalize.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/normalize.ts`:

```typescript
// Normalized match keys for cross-source dedup (PRODUCT-SPEC §2.2). Pure and
// deterministic so the matching policy is unit-testable with fixtures. Imported
// by persist.ts (at ingest), the PGlite seed, and lib/db — must stay dependency-free.

function basicNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation/symbols (unicode-aware)
    .replace(/\s+/g, ' ')
    .trim()
}

// Venue key: lowercase, punctuation-stripped, whitespace-collapsed. Null-safe.
export function normalizeVenue(venue: string | null | undefined): string | null {
  if (!venue) return null
  const n = basicNorm(venue)
  return n.length > 0 ? n : null
}

// Title key: strip promoter prefixes ("X presents"), "live at <venue>" suffixes,
// and — when the venue is known — the venue name itself, then basic-normalize.
export function normalizeTitle(title: string, venueName?: string | null): string {
  let t = title

  // "<promoter> presents <title>" → "<title>"
  t = t.replace(/^.*?\bpresents\b[:\s-]*/i, '')

  // "<title> live at <venue>" / "<title> at <venue>" → "<title>"
  t = t.replace(/\s+(?:live\s+)?at\s+.*$/i, '')

  let n = basicNorm(t)

  // Remove the venue tokens if they leaked into the title.
  const vn = normalizeVenue(venueName)
  if (vn) {
    n = n.replace(new RegExp(`\\b${vn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '')
    n = n.replace(/\s+/g, ' ').trim()
  }

  return n
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/normalize.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit** — folded into Task 1's commit (see Task 1, Step 5).

---

## Task 3: Dedup policy pure functions

**Files:**
- Create: `lib/dedup.ts`
- Test: `lib/dedup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/dedup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { chooseMatch, mergeFields, sourceTrust, type Candidate, type ExistingEvent } from './dedup'

describe('sourceTrust', () => {
  it('ranks api > ical > jsonld > crawl > unknown', () => {
    expect(sourceTrust('ticketmaster')).toBeGreaterThan(sourceTrust('ical'))
    expect(sourceTrust('ical')).toBeGreaterThan(sourceTrust('eventbrite')) // eventbrite is jsonld
    expect(sourceTrust('eventbrite')).toBeGreaterThan(sourceTrust('crawl'))
    expect(sourceTrust('nope')).toBe(0)
  })
})

describe('chooseMatch', () => {
  const cand = (id: string, sim: number, venueAgree: boolean): Candidate => ({ id, sim, venueAgree })

  it('matches at sim >= 0.55 when the venue agrees', () => {
    expect(chooseMatch([cand('a', 0.6, true)])).toBe('a')
  })
  it('does NOT match at sim 0.6 without venue agreement', () => {
    expect(chooseMatch([cand('a', 0.6, false)])).toBeNull()
  })
  it('matches at sim >= 0.85 even without venue agreement', () => {
    expect(chooseMatch([cand('a', 0.9, false)])).toBe('a')
  })
  it('picks the highest-scoring passing candidate', () => {
    expect(chooseMatch([cand('a', 0.56, true), cand('b', 0.99, false)])).toBe('b')
  })
  it('returns null when nothing passes', () => {
    expect(chooseMatch([cand('a', 0.4, true), cand('b', 0.7, false)])).toBeNull()
  })
})

describe('mergeFields', () => {
  const base: ExistingEvent = {
    source: 'crawl', source_id: 'x', title: 'old', venue_norm: 'mohawk',
    description: 'short', image_url: null, venue_name: null, venue_address: null,
    end_time: null, ticket_url: 'http://crawl', is_free: false,
    price_min: null, price_max: null,
  }

  it('takes the longer description', () => {
    const p = mergeFields(base, { ...raw(), description: 'a much longer description' })
    expect(p?.description).toBe('a much longer description')
  })
  it('fills a missing image but does not overwrite an existing one', () => {
    expect(mergeFields(base, { ...raw(), image_url: 'http://img' })?.image_url).toBe('http://img')
    expect(mergeFields({ ...base, image_url: 'http://have' }, { ...raw(), image_url: 'http://new' })?.image_url).toBeUndefined()
  })
  it('widens the price range', () => {
    const p = mergeFields({ ...base, price_min: 20, price_max: 30 }, { ...raw(), price_min: 10, price_max: 50 })
    expect(p).toMatchObject({ price_min: 10, price_max: 50 })
  })
  it('a higher-trust source wins title + ticket_url + primary source', () => {
    const p = mergeFields(base, { ...raw(), source: 'ticketmaster', source_id: 'tm1', title: 'Canonical Title', ticket_url: 'http://tm' })
    expect(p).toMatchObject({ source: 'ticketmaster', source_id: 'tm1', ticket_url: 'http://tm', title: 'Canonical Title' })
    expect(p?.title_norm).toBe('canonical title')
  })
  it('a lower-trust source does not overwrite title/ticket_url', () => {
    const p = mergeFields({ ...base, source: 'ticketmaster', ticket_url: 'http://tm' }, { ...raw(), source: 'crawl', title: 'spam', ticket_url: 'http://spam' })
    expect(p?.title).toBeUndefined()
    expect(p?.ticket_url).toBeUndefined()
  })
  it('returns null when nothing changes', () => {
    expect(mergeFields(base, { ...raw(), source: 'crawl', title: 'old', description: 'short' })).toBeNull()
  })
})

// Minimal RawEvent factory for merge tests.
function raw() {
  return {
    title: 'x', description: null, start_time: '2026-08-01T00:00:00Z', end_time: null,
    venue_name: null, venue_address: null, image_url: null, ticket_url: null,
    source: 'crawl', source_id: 'y', is_free: false, price_min: null, price_max: null,
  }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/dedup.test.ts`
Expected: FAIL — `dedup.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/dedup.ts`:

```typescript
import { normalizeTitle } from './normalize'
import type { RawEvent } from './sources/types'

// Source-trust ranking for merge tiebreaks (PRODUCT-SPEC §2.2.3): api > ical >
// jsonld > crawl. Keyed by source *name*; kinds come from the registry. Kept as a
// small static map so the pure merge stays dependency-light and testable. Phase
// 2B, which makes sources DB-driven, can replace this with a kind lookup.
const KIND_BY_SOURCE: Record<string, 'api' | 'ical' | 'jsonld' | 'crawl' | 'seed'> = {
  ticketmaster: 'api',
  seatgeek: 'api',
  youtube: 'api',
  ical: 'ical',
  eventbrite: 'jsonld',
  newspapers: 'crawl',
  social: 'crawl',
  crawl: 'crawl',
  seed: 'seed',
}

const TRUST_BY_KIND: Record<string, number> = { api: 4, ical: 3, jsonld: 2, crawl: 1, seed: 1 }

export function sourceTrust(source: string): number {
  const kind = KIND_BY_SOURCE[source]
  return kind ? TRUST_BY_KIND[kind] ?? 0 : 0
}

// A blocked candidate, scored in SQL: `sim` = pg_trgm similarity(title_norm),
// `venueAgree` = both venues non-null and equal.
export type Candidate = { id: string; sim: number; venueAgree: boolean }

// The match threshold policy (PRODUCT-SPEC §2.2.2): >= 0.55 with venue agreement,
// or >= 0.85 without. Candidates are pre-sorted by sim desc by the caller; we scan
// and return the first that passes, so the best score wins.
export function chooseMatch(candidates: Candidate[]): string | null {
  for (const c of candidates) {
    if ((c.sim >= 0.55 && c.venueAgree) || c.sim >= 0.85) return c.id
  }
  return null
}

// The canonical event's mergeable fields (a row already in `events`).
export type ExistingEvent = {
  source: string
  source_id: string | null
  title: string
  venue_norm: string | null
  description: string | null
  image_url: string | null
  venue_name: string | null
  venue_address: string | null
  end_time: string | null
  ticket_url: string | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
}

// A whitelisted patch of columns to UPDATE on the canonical event. All keys are
// column names; `updateEventFields` only writes these.
export type FieldPatch = Partial<{
  title: string
  title_norm: string
  source: string
  source_id: string | null
  description: string | null
  image_url: string | null
  venue_name: string | null
  venue_address: string | null
  end_time: string | null
  ticket_url: string | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
}>

// Field-wise "richest wins" (PRODUCT-SPEC §2.2.3), tie-broken by source trust.
// Returns null when the incoming record adds nothing.
export function mergeFields(existing: ExistingEvent, incoming: RawEvent): FieldPatch | null {
  const patch: FieldPatch = {}

  // Longest description wins.
  if ((incoming.description?.length ?? 0) > (existing.description?.length ?? 0)) {
    patch.description = incoming.description
  }
  // Any image over none.
  if (!existing.image_url && incoming.image_url) patch.image_url = incoming.image_url
  // Fill missing nullable fields.
  if (!existing.venue_name && incoming.venue_name) patch.venue_name = incoming.venue_name
  if (!existing.venue_address && incoming.venue_address) patch.venue_address = incoming.venue_address
  if (!existing.end_time && incoming.end_time) patch.end_time = incoming.end_time
  // Widen the price range.
  if (incoming.price_min != null && (existing.price_min == null || incoming.price_min < existing.price_min)) {
    patch.price_min = incoming.price_min
  }
  if (incoming.price_max != null && (existing.price_max == null || incoming.price_max > existing.price_max)) {
    patch.price_max = incoming.price_max
  }
  // Free is sticky: once any source says free, stay free.
  if (incoming.is_free && !existing.is_free) patch.is_free = true

  // A more-trusted source owns the canonical title, ticket link, and primary source.
  if (sourceTrust(incoming.source) > sourceTrust(existing.source)) {
    patch.source = incoming.source
    patch.source_id = incoming.source_id
    if (incoming.ticket_url) patch.ticket_url = incoming.ticket_url
    if (incoming.title) {
      patch.title = incoming.title
      patch.title_norm = normalizeTitle(incoming.title, incoming.venue_name)
    }
  }

  return Object.keys(patch).length > 0 ? patch : null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/dedup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dedup.ts lib/dedup.test.ts
git commit -m "feat(dedup): pure matching policy — chooseMatch, mergeFields, sourceTrust"
```

---

## Task 4: DB layer dedup queries

**Files:**
- Modify: `lib/db/index.ts` (remove `upsertEvent`; add the pipeline queries; extend `getEvent`)
- Test: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add to `lib/db/db.integration.test.ts`:

```typescript
import {
  insertEvent, getEventRow, updateEventFields, findEventBySource,
  findDedupCandidates, recordProvenance, getEventSources,
} from './index'
import { normalizeTitle, normalizeVenue } from '@/lib/normalize'

function rawEvent(over: Partial<import('@/lib/sources/types').RawEvent> = {}) {
  return {
    title: 'The Black Angels', description: 'psych rock', start_time: '2026-09-01T02:00:00Z',
    end_time: null, venue_name: 'Mohawk', venue_address: '912 Red River',
    image_url: null, ticket_url: 'http://a', source: 'crawl', source_id: 'c1',
    is_free: false, price_min: null, price_max: null, ...over,
  }
}

it('insert → find-by-source → provenance → candidates → merge', async () => {
  const r = rawEvent()
  const id = await insertEvent(r, {
    cityId: 1, titleNorm: normalizeTitle(r.title, r.venue_name), venueNorm: normalizeVenue(r.venue_name),
  })
  expect(id).toBeTruthy()

  await recordProvenance({ eventId: id, source: r.source, externalId: r.source_id, url: r.ticket_url, raw: r })
  expect(await findEventBySource('crawl', 'c1')).toBe(id)
  expect(await findEventBySource('crawl', 'nope')).toBeNull()

  const provenance = await getEventSources(id)
  expect(provenance).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'crawl', external_id: 'c1' })]))

  // A near-identical title, same venue, +90 min → blocked candidate with high sim.
  const cands = await findDedupCandidates({
    cityId: 1, startTime: '2026-09-01T03:30:00Z',
    titleNorm: normalizeTitle('Black Angels', 'Mohawk'), venueNorm: normalizeVenue('Mohawk'),
  })
  expect(cands.some(c => c.id === id && c.sim > 0.4 && c.venueAgree)).toBe(true)

  // A different day is NOT a candidate.
  const far = await findDedupCandidates({
    cityId: 1, startTime: '2026-09-05T02:00:00Z',
    titleNorm: normalizeTitle('The Black Angels', 'Mohawk'), venueNorm: normalizeVenue('Mohawk'),
  })
  expect(far.some(c => c.id === id)).toBe(false)

  const row = await getEventRow(id)
  const patch = { description: 'a much longer and richer description of the show' }
  await updateEventFields(id, patch)
  const after = await getEventRow(id)
  expect(after!.description).toBe(patch.description)
  expect(row!.title).toBe('The Black Angels')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/db/db.integration.test.ts`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Implement the queries**

In `lib/db/index.ts`, **delete** the existing `upsertEvent` function (lines defining `export async function upsertEvent`), and add the following. Put the imports/types near the top after the existing imports:

```typescript
import type { ExistingEvent, Candidate, FieldPatch } from '@/lib/dedup'
```

Add these functions in the "Ingestion helpers" section (replacing `upsertEvent`):

```typescript
// Idempotency lookup: has this exact (source, external_id) already been mapped to
// a canonical event? Mirrors the old UNIQUE(source, source_id) fast-path so a
// daily re-ingest updates in place instead of re-running dedup.
export async function findEventBySource(source: string, externalId: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db.query<{ event_id: string }>(
    `SELECT event_id FROM event_sources WHERE source = $1 AND external_id = $2`,
    [source, externalId]
  )
  return rows[0]?.event_id ?? null
}

// Blocking + scoring in one query (PRODUCT-SPEC §2.2.1–2.2.2): candidates share a
// city, start within ±2h, and either agree on venue or have a null venue; scored
// by pg_trgm title similarity. venueAgree = both venues present and equal.
export async function findDedupCandidates(opts: {
  cityId: number
  startTime: string
  titleNorm: string
  venueNorm: string | null
}): Promise<Candidate[]> {
  const db = await getDb()
  const rows = await db.query<{ id: string; sim: number; venue_agree: boolean }>(
    `SELECT e.id,
            similarity(e.title_norm, $1) AS sim,
            (e.venue_norm IS NOT NULL AND $2::text IS NOT NULL AND e.venue_norm = $2) AS venue_agree
     FROM events e
     WHERE e.city_id = $3
       AND e.start_time BETWEEN ($4)::timestamptz - interval '2 hours'
                            AND ($4)::timestamptz + interval '2 hours'
       AND (e.venue_norm = $2 OR e.venue_norm IS NULL OR $2::text IS NULL)
       AND e.title_norm IS NOT NULL
     ORDER BY sim DESC
     LIMIT 10`,
    [opts.titleNorm, opts.venueNorm, opts.cityId, opts.startTime]
  )
  return rows.map(r => ({ id: r.id, sim: Number(r.sim), venueAgree: !!r.venue_agree }))
}

// Insert a brand-new canonical event. Caller supplies the normalized keys.
export async function insertEvent(
  raw: RawEvent,
  keys: { cityId: number; titleNorm: string; venueNorm: string | null }
): Promise<string> {
  const db = await getDb()
  const rows = await db.query<{ id: string }>(
    `INSERT INTO events (title, description, start_time, end_time, venue_name,
       venue_address, image_url, ticket_url, source, source_id, is_free,
       price_min, price_max, city_id, title_norm, venue_norm, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
     RETURNING id`,
    [raw.title, raw.description, raw.start_time, raw.end_time, raw.venue_name,
     raw.venue_address, raw.image_url, raw.ticket_url, raw.source, raw.source_id,
     raw.is_free, raw.price_min, raw.price_max, keys.cityId, keys.titleNorm, keys.venueNorm]
  )
  return rows[0].id
}

// Fetch the mergeable columns of a canonical event for mergeFields().
export async function getEventRow(id: string): Promise<ExistingEvent | null> {
  const db = await getDb()
  const rows = await db.query<ExistingEvent>(
    `SELECT source, source_id, title, venue_norm, description, image_url,
            venue_name, venue_address, end_time, ticket_url, is_free, price_min, price_max
     FROM events WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

// Apply a whitelisted field patch. Column names come only from FieldPatch keys,
// so the dynamic SQL is injection-safe (values are parameterized).
const PATCHABLE = new Set([
  'title', 'title_norm', 'source', 'source_id', 'description', 'image_url',
  'venue_name', 'venue_address', 'end_time', 'ticket_url', 'is_free', 'price_min', 'price_max',
])
export async function updateEventFields(id: string, patch: FieldPatch): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => PATCHABLE.has(k))
  if (entries.length === 0) return
  const db = await getDb()
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`)
  const values = entries.map(([, v]) => v)
  await db.query(
    `UPDATE events SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [id, ...values]
  )
}

// Write/refresh the provenance row. ON CONFLICT keeps the pipeline idempotent
// across daily re-ingests of the same (source, external_id).
export async function recordProvenance(p: {
  eventId: string
  source: string
  externalId: string
  url: string | null
  raw: unknown
}): Promise<void> {
  const db = await getDb()
  await db.query(
    `INSERT INTO event_sources (event_id, source, external_id, url, raw, ingested_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (source, external_id) DO UPDATE SET
       event_id = EXCLUDED.event_id, url = EXCLUDED.url,
       raw = EXCLUDED.raw, ingested_at = NOW()`,
    [p.eventId, p.source, p.externalId, p.url, JSON.stringify(p.raw)]
  )
}

// Provenance for the UI ("also listed on …").
export async function getEventSources(
  eventId: string
): Promise<{ source: string; external_id: string; url: string | null }[]> {
  const db = await getDb()
  return db.query(
    `SELECT source, external_id, url FROM event_sources WHERE event_id = $1 ORDER BY source ASC`,
    [eventId]
  )
}
```

Extend `getEvent` to include provenance (so the detail page can render it) — add a `SOURCES_JSON` fragment next to `CATEGORIES_JSON` and select it:

```typescript
const SOURCES_JSON = `COALESCE((
  SELECT json_agg(json_build_object('source', s.source, 'url', s.url) ORDER BY s.source)
  FROM event_sources s WHERE s.event_id = e.id
), '[]'::json) AS sources`
```

Change the `getEvent` query to:

```typescript
  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.*, ${CATEGORIES_JSON}, ${SOURCES_JSON} FROM events e WHERE e.id = $1`,
    [id]
  )
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/db/db.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/index.ts lib/db/db.integration.test.ts
git commit -m "feat(db): dedup pipeline queries + event provenance in getEvent"
```

---

## Task 5: Rewrite persist.ts into the dedup pipeline

**Files:**
- Modify: `lib/persist.ts`
- Test: `lib/db/db.integration.test.ts` (end-to-end dedup)

- [ ] **Step 1: Write the failing end-to-end test**

Add to `lib/db/db.integration.test.ts`:

```typescript
import { persistEvents } from '@/lib/persist'

it('collapses the same event from two sources into one canonical row', async () => {
  const start = '2026-10-15T03:00:00Z'
  const a = rawEvent({ source: 'crawl', source_id: 'crawl-99', title: 'Spoon at Stubbs', venue_name: 'Stubbs', start_time: start, ticket_url: 'http://crawl', description: 'short' })
  const b = rawEvent({ source: 'ticketmaster', source_id: 'tm-99', title: 'Spoon', venue_name: "Stubb's", start_time: '2026-10-15T03:30:00Z', ticket_url: 'http://tm', description: 'a longer official description from the primary ticket seller' })

  const r1 = await persistEvents([a])
  const r2 = await persistEvents([b])
  expect(r1.inserted + r2.inserted).toBeGreaterThanOrEqual(2) // both persisted (one new, one merged)

  // Exactly one canonical event for this show...
  const { getPgliteDb } = await import('./pglite')
  const db = await getPgliteDb()
  const canon = await db.query<{ id: string; title: string; ticket_url: string; description: string }>(
    `SELECT id, title, ticket_url, description FROM events WHERE start_time BETWEEN '2026-10-15T02:00:00Z' AND '2026-10-15T05:00:00Z' AND venue_norm = 'stubbs'`
  )
  expect(canon).toHaveLength(1)
  // ...merged: TM (api) is more trusted → its title + ticket_url + longer description won.
  expect(canon[0].title).toBe('Spoon')
  expect(canon[0].ticket_url).toBe('http://tm')
  expect(canon[0].description).toContain('official')

  // ...with two provenance rows.
  const prov = await getEventSources(canon[0].id)
  expect(prov.map(p => p.source).sort()).toEqual(['crawl', 'ticketmaster'])
})

it('re-ingesting the same source row is idempotent (updates, not duplicates)', async () => {
  const e = rawEvent({ source: 'crawl', source_id: 'idem-1', title: 'Idem Fest', venue_name: 'Empire', start_time: '2026-11-01T03:00:00Z' })
  await persistEvents([e])
  await persistEvents([{ ...e, description: 'updated description' }])
  const { getPgliteDb } = await import('./pglite')
  const db = await getPgliteDb()
  const rows = await db.query(`SELECT id FROM event_sources WHERE source = 'crawl' AND external_id = 'idem-1'`)
  expect(rows).toHaveLength(1)
})
```

> The `rawEvent` factory and `getEventSources`/`getEventRow` imports were added in Task 4 — reuse them.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/db/db.integration.test.ts`
Expected: FAIL — current `persistEvents` uses `upsertEvent` (now deleted), so the module won't resolve / the collapse assertion fails.

- [ ] **Step 3: Rewrite `persist.ts`**

Replace `lib/persist.ts` in full:

```typescript
import { tagEvents } from '@/lib/tagger'
import { imageForCategories } from '@/lib/images'
import {
  getCategoryIdBySlug, setEventCategories,
  findEventBySource, findDedupCandidates, insertEvent,
  getEventRow, updateEventFields, recordProvenance,
} from '@/lib/db'
import { normalizeTitle, normalizeVenue } from '@/lib/normalize'
import { chooseMatch, mergeFields } from '@/lib/dedup'
import type { RawEvent } from '@/lib/sources/types'

// Austin until Phase 3 wires multi-city through the ingest context. Matches the
// events.city_id default from migration 007.
const CITY_ID = 1

// The single validation gate. A fabricated or nonsensical date is worse than no
// event — it actively misleads users — so an event is rejected when its
// start_time is missing/unparseable, its title is empty, or it starts more than
// 18 months out. Every source flows through persistEvents, so this bans
// fabricated dates repo-wide rather than per-scraper.
const MAX_FUTURE_MS = 18 * 30 * 24 * 60 * 60 * 1000 // ~18 months

export function isValidEvent(raw: RawEvent): boolean {
  if (!raw.title || raw.title.trim().length === 0) return false
  if (!raw.start_time) return false
  const t = new Date(raw.start_time).getTime()
  if (!Number.isFinite(t)) return false
  if (t > Date.now() + MAX_FUTURE_MS) return false
  return true
}

// Shared persistence pipeline used by both the scheduled ingest (/api/ingest) and
// the on-demand importer (/api/import). Per event: reject undateable input, tag
// (batched Gemini or keyword fallback), guarantee a themed image, then run
// cross-source dedup (block → score → merge → provenance) so the same event from
// multiple sources collapses into one canonical row. `inserted` counts every
// event successfully persisted — whether newly created or merged into an existing
// canonical row — preserving the return shape the ingest orchestrator records as
// events_upserted.
export async function persistEvents(
  input: RawEvent[]
): Promise<{ inserted: number; skipped: number; rejected: number; total: number }> {
  const total = input.length
  if (total === 0) return { inserted: 0, skipped: 0, rejected: 0, total: 0 }

  const events = input.filter(isValidEvent)
  const rejected = total - events.length
  if (events.length === 0) return { inserted: 0, skipped: 0, rejected, total }

  const categoryIdBySlug = await getCategoryIdBySlug()
  const slugs = await tagEvents(events.map(e => ({ title: e.title, description: e.description })))

  events.forEach((raw, i) => {
    if (!raw.image_url) raw.image_url = imageForCategories(slugs[i])
  })

  let inserted = 0
  let skipped = 0

  // Dedup mutates shared candidate state (an event inserted by one item can match
  // the next), so persist sequentially rather than with the old concurrency pool.
  // Ingest already runs sources concurrently; within a source, order matters.
  for (let i = 0; i < events.length; i++) {
    try {
      const eventId = await persistOne(events[i], CITY_ID)
      const categoryIds = slugs[i].map(s => categoryIdBySlug[s]).filter(Boolean)
      await setEventCategories(eventId, categoryIds)
      inserted++
    } catch {
      skipped++
    }
  }

  return { inserted, skipped, rejected, total }
}

// Resolve one raw event to a canonical event id, creating, matching, or merging
// as needed, and always recording provenance. Returns the canonical event id.
async function persistOne(raw: RawEvent, cityId: number): Promise<string> {
  const titleNorm = normalizeTitle(raw.title, raw.venue_name)
  const venueNorm = normalizeVenue(raw.venue_name)

  // 1. Idempotency: already seen this exact (source, external_id)?
  let eventId = await findEventBySource(raw.source, raw.source_id)

  if (eventId) {
    // Same source re-ingested — merge any newly-richer fields in place.
    const existing = await getEventRow(eventId)
    if (existing) {
      const patch = mergeFields(existing, raw)
      if (patch) await updateEventFields(eventId, patch)
    }
  } else {
    // 2. Block + score against existing canonical events.
    const candidates = await findDedupCandidates({ cityId, startTime: raw.start_time, titleNorm, venueNorm })
    const matchId = chooseMatch(candidates)

    if (matchId) {
      // 3a. Matched a different source's event — merge into it.
      eventId = matchId
      const existing = await getEventRow(eventId)
      if (existing) {
        const patch = mergeFields(existing, raw)
        if (patch) await updateEventFields(eventId, patch)
      }
    } else {
      // 3b. No match — new canonical event.
      eventId = await insertEvent(raw, { cityId, titleNorm, venueNorm })
    }
  }

  // 4. Provenance always (PRODUCT-SPEC §2.2.4).
  await recordProvenance({ eventId, source: raw.source, externalId: raw.source_id, url: raw.ticket_url, raw })

  return eventId
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/db/db.integration.test.ts`
Expected: PASS (collapse + idempotency tests green).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests PASS; no type errors. (Watch for other callers of the removed `upsertEvent` — there should be none; `grep -rn upsertEvent lib app` must return nothing.)

- [ ] **Step 6: Commit**

```bash
git add lib/persist.ts lib/db/db.integration.test.ts
git commit -m "feat(persist): cross-source dedup pipeline (block, score, merge, provenance)"
```

---

## Task 6: Surface provenance on the event detail page

**Files:**
- Modify: `app/events/[id]/page.tsx`

- [ ] **Step 1: Inspect the current detail page**

Run: `sed -n '1,80p' app/events/[id]/page.tsx` (or open it) to find where categories/venue render and how the event object is shaped. `getEvent` now returns a `sources: { source: string; url: string | null }[]` array (Task 4).

- [ ] **Step 2: Render "Also listed on"**

After the venue/description block in `app/events/[id]/page.tsx`, add a provenance line. Insert this JSX where the event metadata renders (adapt the surrounding variable name — the event object — to match the file):

```tsx
{Array.isArray((event as { sources?: { source: string; url: string | null }[] }).sources) &&
  (event as { sources: { source: string; url: string | null }[] }).sources.length > 1 && (
    <p className="text-xs text-muted-foreground mt-4">
      Also listed on{' '}
      {(event as { sources: { source: string; url: string | null }[] }).sources
        .map(s => s.source)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ')}
    </p>
)}
```

> If the page uses a typed `Event` model, prefer adding `sources?: { source: string; url: string | null }[]` to that type in `lib/types.ts` and dropping the inline casts. Check `lib/types.ts` for the shared event type before casting.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npx next build`
Expected: Type-checks and builds. (A manual smoke check — an event with two sources shows the line — happens in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add app/events/[id]/page.tsx lib/types.ts
git commit -m "feat(ui): show cross-source provenance on event detail"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: All green, including the three new files (`normalize`, `dedup`, and the extended `db.integration`).

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc --noEmit && npx eslint . && npx next build`
Expected: Clean. This mirrors the CI workflow (SIMPLIFICATION §4).

- [ ] **Step 3: Manual dedup smoke test against local PGlite**

Run the dev server and hit ingest to exercise the pipeline end to end:

```bash
npm run dev
# in another shell (dev mode → auth open per SIMPLIFICATION §6):
curl -s -X POST http://localhost:3000/api/ingest | tee /tmp/ingest.json
```

Expected: JSON with `inserted`/`rejected`/`bySource`. Then confirm no obvious duplicate titles at the same venue/time on the home page, and open one event that has provenance to see the "Also listed on" line. Query proof (optional):

```bash
curl -s "http://localhost:3000/api/events?limit=100" | python3 -c "import sys,json,collections; d=json.load(sys.stdin); c=collections.Counter((e['title'], e.get('venue_name')) for e in d.get('events',[])); print([k for k,v in c.items() if v>1][:10])"
```

Expected: an empty or near-empty list of `(title, venue)` collisions (some legitimately-distinct same-title events may remain — dedup keys on time+venue+title similarity, not title alone).

- [ ] **Step 4: Confirm the migration applies cleanly to Postgres (if `DATABASE_URL` is available)**

If a Supabase/Postgres `DATABASE_URL` is configured:

```bash
npm run migrate
```

Expected: `007_dedup_foundation.sql` applies without error and is recorded in `_migrations`. (Skip if running PGlite-only; CI + the integration tests already prove the SQL on PGlite.)

- [ ] **Step 5: Update the roadmap note**

Mark Phase 2A complete in your tracking and note that 2B (config-driven sources) is unblocked — it migrates `source_runs.source` and `event_sources.source` to `source_id` FKs against the new `sources` table.

---

## Self-Review (completed during authoring)

**Spec coverage (PRODUCT-SPEC §2):**
- §2.1 canonical events + `event_sources` provenance + `title_norm`/`venue_norm` + trigram/block indexes → Task 1.
- §2.2.1 block by city/±2h/venue → `findDedupCandidates` (Task 4).
- §2.2.2 score via `pg_trgm`, thresholds 0.55/0.85 → SQL `similarity()` + `chooseMatch` (Tasks 3–4).
- §2.2.3 field-wise richest-wins + source-trust tiebreak → `mergeFields`/`sourceTrust` (Task 3).
- §2.2.4 provenance always → `recordProvenance` called on every path (Task 5).
- "trigram now, embeddings later" → pg_trgm only; no pgvector. ✓
- Minimal `cities` per the confirmed scope decision → Task 1.

**Deferred to later sub-plans (intentional, noted):** `sources` table + `source_id` FKs, content-hash skipping, ~50 venue seeds (2B); user submissions (2C); programmatic SEO (2D). False-merge/false-split counters in `source_runs` (§2.2 note) ride along in 2B when `source_runs` gains its FK.

**Type consistency:** `Candidate`/`ExistingEvent`/`FieldPatch` defined in `lib/dedup.ts` (Task 3) and consumed by `lib/db` (Task 4) and `lib/persist` (Task 5) under the same names. `normalizeTitle(title, venueName?)` / `normalizeVenue(venue)` signatures identical across `pglite.ts`, `dedup.ts`, `db/index.ts`, `persist.ts`. `persistEvents` return shape unchanged, so `app/api/ingest/route.ts` needs no edit.

**Known simplifications (acceptable for 2A):** the `(start_time::date)` block index is a coarse aid for the ±2h range predicate; `KIND_BY_SOURCE` is a static map that Phase 2B replaces with a DB lookup; `city_id` is hardcoded to 1 until Phase 3 threads it through `SourceContext`.
```
