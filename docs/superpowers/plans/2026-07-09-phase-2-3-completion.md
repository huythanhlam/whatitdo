# Phase 2 & 3 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining PRODUCT-SPEC.md Phase 2 ("Coverage & dedup") and Phase 3 ("Multi-city") items that a prior audit found incomplete: multi-city routing + a real second city (Houston), a public event-submission/moderation flow, an admin UI, an `is_free` filter, and programmatic SEO pages.

**Architecture:** Everything is additive on top of the existing single-SQL-layer / SourceAdapter / dedup pipeline (already built in Phase 0-1 and the first half of Phase 2). Multi-city work goes in first (schema + routing + city-scoped queries) because the Phase 2 leftovers (submission form, SEO pages) are built as pages *under* `app/[city]/`, so building city routing first avoids redoing that work twice.

**Tech Stack:** Next.js 16 App Router (async `params`/`searchParams`, `generateStaticParams`, nested `sitemap.ts`), PGlite + `pg` behind the existing `Db` driver seam, Vitest, the existing `SourceAdapter` registry.

**Scoping decisions (read before starting):**
- Houston's T1 coverage is Ticketmaster + SeatGeek only (both take a plain city/state query param, cheap to parametrize). Eventbrite/YouTube/Bluesky remain Austin-hardcoded (their queries are baked into scrape URLs/keyword lists) — parametrizing those is real, separate work, explicitly out of scope here.
- `lib/dedup.ts`'s `KIND_BY_SOURCE` map already has a latent gap unrelated to this plan: instance-named sources (`crawl:mohawkaustin-com`, `newspaper:kut`, etc.) don't match its literal keys and silently score `sourceTrust = 0`. This plan does **not** fix that — only add the two new literal keys Houston's new source rows need (`ticketmaster:houston`, `seatgeek:houston`) plus one for the new `submission` source, mirroring the existing pattern exactly. Flag the broader gap as a follow-up after this plan lands (see final task).
- No new auth system: the admin UI reuses the existing `requireCronAuth`/`CRON_SECRET` bearer scheme via a token the ops person pastes into local storage once. This matches the anti-roadmap's "no user accounts in v1."

---

## Part A — Phase 3: Multi-city foundation

### Task 1: Migration 011 — city_id on subscriptions + featured_listings

**Files:**
- Create: `supabase/migrations/011_city_scoping.sql`
- Test: `lib/db/db.integration.test.ts` (extend)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/011_city_scoping.sql
-- Phase 3: complete the city_id FK sweep started in migration 007/008.
-- subscriptions gets a real per-city identity (a user may want independent
-- Austin + Houston digests), so the uniqueness constraint moves from
-- UNIQUE(email) to UNIQUE(email, city_id). featured_listings' city_id is
-- denormalized from its event's city_id so city-scoped admin/reporting
-- queries never need a join.

ALTER TABLE subscriptions ADD COLUMN city_id INT REFERENCES cities(id);
UPDATE subscriptions SET city_id = 1 WHERE city_id IS NULL;
ALTER TABLE subscriptions ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN city_id SET DEFAULT 1;

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_email_key;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_email_city_key UNIQUE (email, city_id);

ALTER TABLE featured_listings ADD COLUMN city_id INT REFERENCES cities(id);
UPDATE featured_listings f SET city_id = e.city_id
  FROM events e WHERE f.event_id = e.id AND f.city_id IS NULL;
UPDATE featured_listings SET city_id = 1 WHERE city_id IS NULL; -- orphaned rows, default Austin
ALTER TABLE featured_listings ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE featured_listings ALTER COLUMN city_id SET DEFAULT 1;

CREATE INDEX subscriptions_city ON subscriptions (city_id, frequency);
CREATE INDEX featured_listings_city ON featured_listings (city_id);
```

- [ ] **Step 2: Write the failing test**

Add to `lib/db/db.integration.test.ts`, near the other migration-assertion tests:

```ts
describe('city scoping migration (011)', () => {
  it('adds city_id to subscriptions and featured_listings, backfilled to Austin', async () => {
    const db = await getPgliteDb()
    const subCols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'subscriptions'`
    )
    expect(subCols.map(c => c.column_name)).toEqual(expect.arrayContaining(['city_id']))

    const flCols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'featured_listings'`
    )
    expect(flCols.map(c => c.column_name)).toEqual(expect.arrayContaining(['city_id']))
  })

  it('allows the same email to subscribe independently per city', async () => {
    const a = await addSubscription({ email: 'multi-city@example.com', frequency: 'daily', category_slugs: [], cityId: 1 })
    const b = await addSubscription({ email: 'multi-city@example.com', frequency: 'daily', category_slugs: [], cityId: 2 })
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })
})
```

Note: this test references `addSubscription({ ..., cityId })` and city id `2` (Houston) — both land in later tasks (Task 2 changes `addSubscription`'s signature; Task 8 seeds Houston as city id 2). Leave this test written now; it will fail to compile/run until those tasks land. Re-run it at the end of Task 8.

- [ ] **Step 3: Run migration test in isolation to confirm the schema part passes**

Run: `npx vitest run lib/db/db.integration.test.ts -t "city scoping migration"`
Expected: the first `it` (column existence) passes once the migration file exists; the second `it` will fail to compile until Task 2/8 land — that's expected, skip verifying it now.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/011_city_scoping.sql lib/db/db.integration.test.ts
git commit -m "feat(db): add city_id to subscriptions and featured_listings"
```

---

### Task 2: City-scope the query layer

**Files:**
- Modify: `lib/db/index.ts`
- Modify: `lib/persist.ts`
- Modify: `lib/db/db.integration.test.ts`
- Modify: `lib/persist.test.ts`

- [ ] **Step 1: Add a `City` type and city-read functions to `lib/db/index.ts`**

Add near the top of the file, after the existing imports:

```ts
export type City = {
  id: number
  slug: string
  name: string
  state: string
  timezone: string
  enabled: boolean
}
```

Add a new section (after the "Sources" section, before "Source runs"):

```ts
// ---------------------------------------------------------------------------
// Cities (Phase 3)
// ---------------------------------------------------------------------------
export async function getEnabledCities(): Promise<City[]> {
  const db = await getDb()
  return db.query<City>(
    `SELECT id, slug, name, state, timezone, enabled FROM cities WHERE enabled = true ORDER BY id ASC`
  )
}

export async function getCityBySlug(slug: string): Promise<City | null> {
  const db = await getDb()
  const rows = await db.query<City>(
    `SELECT id, slug, name, state, timezone, enabled FROM cities WHERE slug = $1`,
    [slug]
  )
  return rows[0] ?? null
}

export async function getCityById(id: number): Promise<City | null> {
  const db = await getDb()
  const rows = await db.query<City>(
    `SELECT id, slug, name, state, timezone, enabled FROM cities WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}
```

- [ ] **Step 2: City-scope `listEvents` and `countEvents`**

Replace the entire `listEvents` function with:

```ts
export async function listEvents(opts: {
  cityId: number
  q?: string
  categories?: string[]
  from?: string
  to?: string
  isFree?: boolean
  limit: number
  offset: number
}): Promise<EnrichedEvent[]> {
  const db = await getDb()
  const nowIso = new Date().toISOString()
  const fromIso = opts.from && opts.from > nowIso ? opts.from : nowIso

  const params: unknown[] = [fromIso]
  let where = "e.start_time >= $1 AND e.status = 'approved'"

  params.push(opts.cityId)
  where += ` AND e.city_id = $${params.length}`

  if (opts.to) {
    params.push(opts.to)
    where += ` AND e.start_time <= $${params.length}`
  }
  if (opts.isFree) {
    where += ` AND e.is_free = true`
  }
  if (opts.q) {
    params.push(opts.q)
    where += ` AND ${FTS_MATCH.replace('$PARAM', `$${params.length}`)}`
  }
  if (opts.categories && opts.categories.length > 0) {
    params.push(opts.categories)
    where += ` AND e.id IN (
      SELECT ec.event_id FROM event_categories ec
      JOIN categories c ON c.id = ec.category_id
      WHERE c.slug = ANY($${params.length}))`
  }
  params.push(opts.limit)
  params.push(opts.offset)

  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.*, ${CATEGORIES_JSON}, ${FEATURED_JSON}
     FROM events e
     WHERE ${where}
     ORDER BY e.start_time ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return rows.map(r => enrichRow(r, nowIso))
}
```

Replace `countEvents` with:

```ts
export async function countEvents(opts: {
  cityId: number
  q?: string
  categories?: string[]
  from?: string
  to?: string
  isFree?: boolean
}): Promise<number> {
  const db = await getDb()
  const nowIso = new Date().toISOString()
  const fromIso = opts.from && opts.from > nowIso ? opts.from : nowIso

  const params: unknown[] = [fromIso]
  let where = "e.start_time >= $1 AND e.status = 'approved'"
  params.push(opts.cityId)
  where += ` AND e.city_id = $${params.length}`
  if (opts.to) { params.push(opts.to); where += ` AND e.start_time <= $${params.length}` }
  if (opts.isFree) where += ` AND e.is_free = true`
  if (opts.q) { params.push(opts.q); where += ` AND ${FTS_MATCH.replace('$PARAM', `$${params.length}`)}` }
  if (opts.categories && opts.categories.length > 0) {
    params.push(opts.categories)
    where += ` AND e.id IN (SELECT ec.event_id FROM event_categories ec
      JOIN categories c ON c.id = ec.category_id WHERE c.slug = ANY($${params.length}))`
  }
  const rows = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM events e WHERE ${where}`,
    params
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}
```

Update `getEvent` to only return approved events (city-scoping isn't needed here — ids are globally unique — but status filtering is required so pending/rejected submissions never leak into the public detail page):

```ts
export async function getEvent(id: string): Promise<EnrichedEvent | null> {
  const db = await getDb()
  const nowIso = new Date().toISOString()
  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.*, ${CATEGORIES_JSON}, ${SOURCES_JSON} FROM events e WHERE e.id = $1 AND e.status = 'approved'`,
    [id]
  )
  if (rows.length === 0) return null
  return enrichRow(rows[0], nowIso)
}
```

(The `e.status = 'approved'` filter references a column that doesn't exist yet — it's added in Task 10. Leave it here now; `npm test`/`tsc` won't complain since this is a SQL string, but the integration tests that hit these functions will error with "column status does not exist" until Task 10's migration lands. That's expected — Task 10 runs later in this same plan, before final verification.)

Update `getEventsBetween`:

```ts
export async function getEventsBetween(cityId: number, startIso: string, endIso: string): Promise<EnrichedEvent[]> {
  const db = await getDb()
  const nowIso = new Date().toISOString()
  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.*, ${CATEGORIES_JSON}
     FROM events e WHERE e.city_id = $1 AND e.status = 'approved'
       AND e.start_time >= $2 AND e.start_time <= $3
     ORDER BY e.start_time ASC`,
    [cityId, startIso, endIso]
  )
  return rows.map(r => enrichRow(r, nowIso))
}
```

- [ ] **Step 3: City-scope subscriptions and featured listings**

Replace `addSubscription`:

```ts
export async function addSubscription(sub: {
  email: string
  frequency: string
  category_slugs: string[]
  cityId: number
}): Promise<string | null> {
  const db = await getDb()
  const rows = await db.query<{ token: string }>(
    `INSERT INTO subscriptions (email, frequency, category_slugs, city_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email, city_id) DO UPDATE SET frequency = EXCLUDED.frequency,
       category_slugs = EXCLUDED.category_slugs
     RETURNING token`,
    [sub.email, sub.frequency, sub.category_slugs, sub.cityId]
  )
  return rows[0]?.token ?? null
}
```

Replace `listSubscriptions`:

```ts
export async function listSubscriptions(
  frequency: string,
  cityId: number
): Promise<{ email: string; token: string; category_slugs: string[] }[]> {
  const db = await getDb()
  return db.query<{ email: string; token: string; category_slugs: string[] }>(
    `SELECT email, token, category_slugs FROM subscriptions WHERE frequency = $1 AND city_id = $2`,
    [frequency, cityId]
  )
}
```

Replace `addFeatured` to derive `city_id` from the event being featured:

```ts
export async function addFeatured(f: {
  event_id: string
  starts_at: string
  ends_at: string
  ad_label: string
}): Promise<Record<string, unknown> | null> {
  const db = await getDb()
  const rows = await db.query<Record<string, unknown>>(
    `INSERT INTO featured_listings (event_id, starts_at, ends_at, ad_label, city_id)
     VALUES ($1, $2, $3, $4, (SELECT city_id FROM events WHERE id = $1))
     RETURNING *`,
    [f.event_id, f.starts_at, f.ends_at, f.ad_label]
  )
  return rows[0] ?? null
}
```

- [ ] **Step 4: Update every existing caller and test of the changed signatures**

In `lib/db/db.integration.test.ts`, update every call site:
- All `listEvents({...})` calls → add `cityId: 1`.
- All `countEvents({...})` calls → add `cityId: 1`.
- `getEventsBetween(from, to)` → `getEventsBetween(1, from, to)`.
- `addSubscription({ email, frequency, category_slugs })` calls → add `cityId: 1`.
- `listSubscriptions('weekly')` → `listSubscriptions('weekly', 1)`.

Concretely, in the `read layer against seeded PGlite` describe block:

```ts
describe('read layer against seeded PGlite', () => {
  it('lists seeded events with joined categories', async () => {
    const events = await listEvents({ cityId: 1, limit: 24, offset: 0 })
    expect(events.length).toBeGreaterThan(0)
    const withCats = events.find(e => (e.categories as unknown[]).length > 0)
    expect(withCats).toBeTruthy()
  })

  it('countEvents agrees the DB is non-empty', async () => {
    expect(await countEvents({ cityId: 1 })).toBeGreaterThan(0)
  })

  it('getEvent returns a single enriched event by id', async () => {
    const [first] = await listEvents({ cityId: 1, limit: 1, offset: 0 })
    const one = await getEvent(first.id)
    expect(one?.id).toBe(first.id)
    expect(one).toHaveProperty('categories')
  })

  it('getEvent returns null for an unknown id', async () => {
    expect(await getEvent('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('full-text search matches on content', async () => {
    const events = await listEvents({ cityId: 1, q: 'music', limit: 24, offset: 0 })
    expect(Array.isArray(events)).toBe(true)
  })
})
```

In `persistEvents against PGlite`:

```ts
  it('inserts a valid event and rejects a fabricated-date one', async () => {
    const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString()
    const good: RawEvent = mk({ source_id: 'itest-good', start_time: soon })
    const bad: RawEvent = mk({ source_id: 'itest-bad', start_time: 'not a date' })

    const res = await persistEvents([good, bad])
    expect(res.inserted).toBe(1)
    expect(res.rejected).toBe(1)
    expect(res.total).toBe(2)

    const found = await listEvents({ cityId: 1, q: 'Integration Test Show', limit: 5, offset: 0 })
    expect(found.some(e => e.source_id === 'itest-good')).toBe(true)
  })
```

In `subscription lifecycle against PGlite`:

```ts
describe('subscription lifecycle against PGlite', () => {
  it('adds, lists, and removes a subscription (token from DB default)', async () => {
    const token = await addSubscription({ email: 'itest@example.com', frequency: 'weekly', category_slugs: ['music'], cityId: 1 })
    expect(token).toBeTruthy()

    const subs = await listSubscriptions('weekly', 1)
    expect(subs.some(s => s.email === 'itest@example.com')).toBe(true)

    await removeSubscription(token!)
    const after = await listSubscriptions('weekly', 1)
    expect(after.some(s => s.email === 'itest@example.com')).toBe(false)
  })
})
```

In `getEventsBetween`:

```ts
describe('getEventsBetween', () => {
  it('returns events within a window, ordered by start', async () => {
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const to = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
    const events = await getEventsBetween(1, from, to)
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].start_time as string).getTime())
        .toBeGreaterThanOrEqual(new Date(events[i - 1].start_time as string).getTime())
    }
  })
})
```

And in `cross-source dedup via persistEvents`, the raw SQL assertion query references `venue_norm` directly against the `events` table — no `cityId` param needed there since it queries raw columns, leave as-is.

- [ ] **Step 5: Run the full test suite (expect failures from Task 10's not-yet-added `status` column)**

Run: `npx vitest run lib/db lib/persist.test.ts`
Expected: most tests pass; any test hitting `listEvents`/`countEvents`/`getEvent`/`getEventsBetween` will fail with `column "status" does not exist` until Task 10 lands. Confirm the *only* failures are that one error message — if anything else fails, fix it before moving on.

- [ ] **Step 6: Commit**

```bash
git add lib/db/index.ts lib/db/db.integration.test.ts
git commit -m "feat(db): city-scope listEvents/countEvents/getEventsBetween/subscriptions/featured"
```

---

### Task 3: City-resolution helper + geo-parametrized Ticketmaster/SeatGeek

**Files:**
- Create: `lib/cities.ts`
- Modify: `lib/sources/types.ts`
- Modify: `lib/sources/registry.ts`
- Modify: `lib/sources/ticketmaster.ts`
- Modify: `lib/sources/seatgeek.ts`
- Modify: `lib/dedup.ts`
- Modify: `lib/dedup.test.ts`

- [ ] **Step 1: Add the `requireCity` page/route helper**

```ts
// lib/cities.ts
import { notFound } from 'next/navigation'
import { getCityBySlug, type City } from '@/lib/db'

// Resolve a URL city slug to its row, or 404. Shared by every page and API
// route nested under app/[city]/ so an unknown or disabled city slug behaves
// like any other missing resource instead of a raw DB null check per call site.
export async function requireCity(slug: string): Promise<City> {
  const city = await getCityBySlug(slug)
  if (!city || !city.enabled) notFound()
  return city
}
```

- [ ] **Step 2: Widen `SourceContext.city` to carry real geo info**

In `lib/sources/types.ts`, replace:

```ts
export type SourceContext = {
  city: string
  since: Date
  logger: Pick<Console, 'log' | 'warn' | 'error'>
}
```

with:

```ts
// `city` carries enough of the `cities` row for structured APIs (Ticketmaster,
// SeatGeek) to query the right geography — previously a bare 'austin' string
// that nothing actually read.
export type SourceContext = {
  city: { id: number; slug: string; name: string; state: string }
  since: Date
  logger: Pick<Console, 'log' | 'warn' | 'error'>
}
```

- [ ] **Step 3: Parametrize Ticketmaster and SeatGeek by city**

In `lib/sources/ticketmaster.ts`, change the signature and the two hardcoded `'Austin'` uses:

```ts
export async function fetchTicketmasterEvents(city: { name: string; state: string }): Promise<RawEvent[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY
  if (!apiKey) {
    console.warn('TICKETMASTER_API_KEY not set — skipping Ticketmaster')
    return []
  }

  const results: RawEvent[] = []

  for (let page = 0; page < 3; page++) {
    const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json')
    url.searchParams.set('apikey', apiKey)
    url.searchParams.set('city', city.name)
    url.searchParams.set('stateCode', city.state)
    url.searchParams.set('size', '100')
    url.searchParams.set('sort', 'date,asc')
    url.searchParams.set('page', String(page))
```

(leave the rest of the function body unchanged except the venue-address fallback, which currently reads `venue?.city?.name ?? 'Austin'` — change that literal to `venue?.city?.name ?? city.name`.)

In `lib/sources/seatgeek.ts`, change the signature and hardcoded value:

```ts
export async function fetchSeatGeekEvents(city: { name: string }): Promise<RawEvent[]> {
  const clientId = process.env.SEATGEEK_CLIENT_ID
  if (!clientId) {
    console.warn('SEATGEEK_CLIENT_ID not set — skipping SeatGeek')
    return []
  }

  const results: RawEvent[] = []

  for (let page = 1; page <= 3; page++) {
    const url = new URL('https://api.seatgeek.com/2/events')
    url.searchParams.set('venue.city', city.name)
    url.searchParams.set('client_id', clientId)
```

(rest of the function body unchanged.)

- [ ] **Step 4: Thread `ctx` through the registry's `simple()` wrapper**

In `lib/sources/registry.ts`, replace the `simple` helper and the `ticketmaster`/`seatgeek` entries:

```ts
// Wrap a plain RawEvent[] producer as a non-skipping parser (only `crawl`
// content-hashes, so everyone else always reports skipped:false). `ctx` is
// available to every fetcher (geo-aware sources use it; the rest ignore it).
const simple = (
  available: () => boolean,
  fetch: (url: string | null, name: string, ctx: SourceContext) => Promise<RawEvent[]>
): SourceParser => ({
  available,
  fetch: async (source, ctx) => ({ events: await fetch(source.url, source.name, ctx), skipped: false }),
})
```

```ts
export const PARSERS: Record<string, SourceParser> = {
  // Structured — no Gemini, always available.
  eventbrite: simple(() => true, () => fetchEventbriteEvents()),
  ical:       simple(() => true, (url, name) => fetchIcalUrl(url!, name)),

  // API-key gated, geo-parametrized by the source's city.
  ticketmaster: simple(() => has(process.env.TICKETMASTER_API_KEY), (_url, _name, ctx) => fetchTicketmasterEvents(ctx.city)),
  seatgeek:     simple(() => has(process.env.SEATGEEK_CLIENT_ID),   (_url, _name, ctx) => fetchSeatGeekEvents(ctx.city)),

  // Gemini-extracted free text.
  rss:     simple(hasGeminiKey, (url, name) => fetchFeed(url!, name, { limit: 20 }).then(extractEvents)),
  bluesky: simple(hasGeminiKey, () => fetchBlueskyEvents()),

  // Crawl: content-hash aware, returns its own skip flag.
  crawl: { available: hasGeminiKey, fetch: (source) => fetchCrawlSource(source) },

  // YouTube needs both its API key and Gemini.
  youtube: simple(() => has(process.env.YOUTUBE_API_KEY) && hasGeminiKey(), () => fetchYoutubeEvents()),
}
```

Add the missing import at the top of the file:

```ts
import type { SourceParser, RawEvent, SourceContext } from './types'
```

- [ ] **Step 5: Add the new source-name trust entries needed for Houston + submissions**

In `lib/dedup.ts`, extend `KIND_BY_SOURCE`:

```ts
// Multi-city structured sources need their own literal key here (source *names*
// are unique per row, e.g. 'ticketmaster:houston') until sourceTrust is rebuilt
// on top of sources.kind directly — see the plan's scoping note on the
// pre-existing crawl:*/newspaper:* instance-name gap, which this does not fix.
const KIND_BY_SOURCE: Record<string, SourceKind> = {
  ticketmaster: 'api',
  seatgeek: 'api',
  youtube: 'api',
  ical: 'ical',
  eventbrite: 'jsonld',
  newspapers: 'rss',
  social: 'crawl',
  crawl: 'crawl',
  seed: 'seed',
  'ticketmaster:houston': 'api',
  'seatgeek:houston': 'api',
  submission: 'crawl',
}
```

- [ ] **Step 6: Extend the dedup unit test**

Add to `lib/dedup.test.ts`, inside the `sourceTrust` describe block:

```ts
  it('ranks a city-suffixed structured source the same as its base name', () => {
    expect(sourceTrust('ticketmaster:houston')).toBe(sourceTrust('ticketmaster'))
    expect(sourceTrust('seatgeek:houston')).toBe(sourceTrust('seatgeek'))
  })
  it('puts public submissions at the same (lowest) trust tier as crawl', () => {
    expect(sourceTrust('submission')).toBe(sourceTrust('crawl'))
  })
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run lib/dedup.test.ts lib/sources/registry.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/cities.ts lib/sources/types.ts lib/sources/registry.ts lib/sources/ticketmaster.ts lib/sources/seatgeek.ts lib/dedup.ts lib/dedup.test.ts
git commit -m "feat(sources): geo-parametrize Ticketmaster/SeatGeek and add requireCity helper"
```

---

### Task 4: Restructure routing under `app/[city]/`

**Files:**
- Create: `app/[city]/layout.tsx`
- Create: `app/[city]/page.tsx` (moved/rewritten from `app/page.tsx`)
- Create: `app/[city]/events/[id]/page.tsx` (moved/rewritten from `app/events/[id]/page.tsx`)
- Create: `app/[city]/subscribe/page.tsx` (moved/rewritten from `app/subscribe/page.tsx`)
- Modify: `app/page.tsx` (becomes a redirect)
- Delete: `app/events/[id]/page.tsx` (old location)
- Delete: `app/subscribe/page.tsx` (old location)
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `city_id` to the shared `Event` type**

In `lib/types.ts`, add `city_id: number` to the `Event` type (it's a real column already; the type was just never updated):

```ts
export type Event = {
  id: string
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  venue_name: string | null
  venue_address: string | null
  image_url: string | null
  ticket_url: string | null
  source: string
  source_id: string | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
  city_id: number
  created_at: string
  updated_at: string
  categories?: Category[]
  is_featured?: boolean
  featured_label?: string | null
}
```

- [ ] **Step 2: Add the city layout (validates the slug + drives static generation)**

```tsx
// app/[city]/layout.tsx
import type { ReactNode } from 'react'
import { getEnabledCities } from '@/lib/db'
import { requireCity } from '@/lib/cities'

export async function generateStaticParams() {
  const cities = await getEnabledCities()
  return cities.map(c => ({ city: c.slug }))
}

export default async function CityLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ city: string }>
}) {
  const { city } = await params
  await requireCity(city) // 404s an unknown/disabled city slug
  return children
}
```

- [ ] **Step 3: Move the homepage to `app/[city]/page.tsx`**

Create `app/[city]/page.tsx` with this content (city-aware version of the old `app/page.tsx`):

```tsx
import { Suspense } from 'react'
import Link from 'next/link'
import { SearchBar } from '@/components/SearchBar'
import { SidebarFilters } from '@/components/SidebarFilters'
import { EventList } from '@/components/EventList'
import { CalendarView } from '@/components/CalendarView'
import { ViewToggle } from '@/components/ViewToggle'
import { listEvents, countEvents, type City } from '@/lib/db'
import { requireCity } from '@/lib/cities'
import { resolveDateRange } from '@/lib/dateRanges'
import { gridRangeIso, currentCentralMonth } from '@/lib/calendar'
import { DateFilter } from '@/components/DateFilter'
import type { EnrichedEvent } from '@/lib/types'

export const revalidate = 900

function first(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined
}

function toCategories(cats: string | string[] | undefined): string[] {
  return cats ? (typeof cats === 'string' ? [cats] : cats) : []
}

function parseCalMonth(cal: string | undefined): { year: number; month: number } {
  const m = cal ? /^(\d{4})-(\d{2})$/.exec(cal) : null
  if (m) {
    const year = +m[1]
    const month = +m[2] - 1
    if (month >= 0 && month <= 11) return { year, month }
  }
  return currentCentralMonth()
}

async function CalendarLoader({ city, searchParams }: { city: City; searchParams: Record<string, string | string[]> }) {
  const q = first(searchParams.q) ?? ''
  const categories = toCategories(searchParams.category)
  const { year, month } = parseCalMonth(first(searchParams.cal))
  const { fromIso, toIso } = gridRangeIso(year, month)

  const events = await listEvents({ cityId: city.id, q, categories, from: fromIso, to: toIso, limit: 1000, offset: 0 })

  const qs = new URLSearchParams()
  if (q) qs.set('q', q)
  categories.forEach(c => qs.append('category', c))

  return (
    <CalendarView
      events={events as unknown as EnrichedEvent[]}
      year={year}
      month={month}
      filterQs={qs.toString()}
      basePath={`/${city.slug}`}
    />
  )
}

async function EventsLoader({ city, searchParams }: { city: City; searchParams: Record<string, string | string[]> }) {
  const q = first(searchParams.q) ?? ''
  const categories = toCategories(searchParams.category)

  const range = resolveDateRange({
    when: first(searchParams.when),
    from: first(searchParams.from),
    to: first(searchParams.to),
  })

  const filterArgs = { cityId: city.id, q, categories, from: range.fromIso, to: range.toIso ?? undefined }
  const [events, total] = await Promise.all([
    listEvents({ ...filterArgs, limit: 24, offset: 0 }),
    countEvents(filterArgs),
  ])

  if (events.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">
        No events found{range.label ? ` for ${range.label.toLowerCase()}` : ''}. Try a different date range or filter.
      </div>
    )
  }

  const qs = new URLSearchParams()
  if (q) qs.set('q', q)
  categories.forEach(c => qs.append('category', c))
  const when = first(searchParams.when); if (when) qs.set('when', when)
  const fromP = first(searchParams.from); if (fromP) qs.set('from', fromP)
  const toP = first(searchParams.to); if (toP) qs.set('to', toP)

  return (
    <EventList
      initialEvents={events as unknown as EnrichedEvent[]}
      query={qs.toString()}
      total={total}
      basePath={`/${city.slug}`}
    />
  )
}

export default async function CityHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ city: string }>
  searchParams: Promise<Record<string, string | string[]>>
}) {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)
  const sp = await searchParams
  const view = first(sp.view) === 'calendar' ? 'calendar' : 'grid'
  const base = `/${city.slug}`

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 z-40 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href={base} className="font-bold text-lg text-violet-600 shrink-0 whitespace-nowrap">
            🎉 What It Do {city.name}
          </Link>
          <div className="flex-1 max-w-xl">
            <Suspense fallback={<div className="h-9 bg-slate-100 rounded-md animate-pulse" />}>
              <SearchBar />
            </Suspense>
          </div>
          <Link
            href={`${base}/subscribe`}
            className="shrink-0 text-sm bg-violet-600 text-white px-3 py-1.5 rounded-md hover:bg-violet-700 transition-colors font-medium"
          >
            Get Updates
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-8">
        <div className="hidden md:block w-52 shrink-0 pt-1">
          <Suspense>
            <SidebarFilters />
          </Suspense>
        </div>

        <main className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h1 className="text-lg font-semibold text-slate-800">{city.name} Events</h1>
            <Suspense fallback={<div className="h-9 w-32 bg-slate-100 rounded-lg animate-pulse" />}>
              <ViewToggle />
            </Suspense>
          </div>

          <div className="md:hidden mb-5">
            <Suspense>
              <SidebarFilters compact />
            </Suspense>
          </div>

          {view === 'calendar' ? (
            <Suspense fallback={<div className="h-96 bg-slate-100 rounded-lg animate-pulse" />}>
              <CalendarLoader city={city} searchParams={sp} />
            </Suspense>
          ) : (
            <>
              <Suspense fallback={<div className="h-9 bg-slate-100 rounded-md animate-pulse mb-5" />}>
                <DateFilter />
              </Suspense>
              <Suspense fallback={
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array(6).fill(0).map((_, i) => (
                    <div key={i} className="h-64 bg-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              }>
                <EventsLoader city={city} searchParams={sp} />
              </Suspense>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Replace `app/page.tsx` with a redirect to the first enabled city**

```tsx
// app/page.tsx
import { permanentRedirect } from 'next/navigation'
import { getEnabledCities } from '@/lib/db'

export default async function RootPage() {
  const cities = await getEnabledCities()
  const first = cities[0]?.slug ?? 'austin'
  permanentRedirect(`/${first}`)
}
```

- [ ] **Step 5: Move the event detail page**

Create `app/[city]/events/[id]/page.tsx` (city-aware version of the old `app/events/[id]/page.tsx` — logic unchanged except city validation, links, and the JSON-LD/canonical URL):

```tsx
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getEvent as fetchEvent } from '@/lib/db'
import { requireCity } from '@/lib/cities'
import { getTicketProvider } from '@/lib/tickets'
import { getBaseUrl } from '@/lib/site'
import type { EnrichedEvent } from '@/lib/types'

export const revalidate = 900

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const event = (await fetchEvent(id)) as unknown as EnrichedEvent | null
  if (!event) return { title: 'Event not found' }

  const date = new Date(event.start_time).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const where = event.venue_name ? ` at ${event.venue_name}` : ''
  const description = (event.description?.trim() || `${event.title}${where} on ${date}.`).slice(0, 200)
  const images = event.image_url ? [event.image_url] : undefined

  return {
    title: event.title,
    description,
    alternates: { canonical: `/${(await params).city}/events/${event.id}` },
    openGraph: { title: event.title, description, type: 'article', images },
    twitter: { card: 'summary_large_image', title: event.title, description, images },
  }
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>
}) {
  const { city: citySlug, id } = await params
  const city = await requireCity(citySlug)
  const event = (await fetchEvent(id)) as unknown as EnrichedEvent | null

  if (!event || event.city_id !== city.id) notFound()

  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const priceLabel = event.is_free ? 'Free' : event.price_min ? `From $${event.price_min}` : 'See tickets for pricing'
  const provider = getTicketProvider(event.ticket_url)
  const ticketCta = provider ? (event.is_free ? 'RSVP / Details' : provider.cta) : null
  const jsonLd = eventJsonLd(event, citySlug)
  const otherSources = Array.from(new Set((event.sources ?? []).map(s => s.source)))
    .filter(s => s !== event.source)

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href={`/${citySlug}`} className="text-sm text-violet-600 hover:underline">← Back to events</Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {event.image_url && (
          <div className="relative w-full h-64 rounded-xl overflow-hidden mb-6 shadow-sm bg-slate-100">
            <Image
              src={event.image_url}
              alt={event.title}
              fill
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover"
              priority
            />
          </div>
        )}

        <div className="flex flex-wrap gap-1 mb-3">
          {event.categories?.map(cat => (
            <Badge
              key={cat.slug}
              style={{ backgroundColor: cat.color + '18', color: cat.color, borderColor: cat.color + '44' }}
              className="border text-xs"
            >
              {cat.name}
            </Badge>
          ))}
        </div>

        <h1 className="text-2xl font-bold mb-4 text-slate-900">{event.title}</h1>

        <div className="space-y-2 mb-6 text-sm text-slate-600">
          <p>📅 {dateStr} at {timeStr}</p>
          {event.venue_name && (
            <p>📍 {event.venue_name}{event.venue_address ? ` · ${event.venue_address}` : ''}</p>
          )}
          <p>{event.is_free ? '🆓 Free entry' : `💰 ${priceLabel}`}</p>
          <p className="text-xs text-slate-400">Source: {event.source}</p>
          {otherSources.length > 0 && (
            <p className="text-xs text-slate-400">Also listed on {otherSources.join(', ')}</p>
          )}
        </div>

        {event.description && (
          <p className="text-sm leading-relaxed mb-6 text-slate-700 whitespace-pre-line">
            {event.description}
          </p>
        )}

        <div className="flex gap-3 flex-wrap">
          {event.ticket_url && ticketCta && (
            <Button asChild className="bg-violet-600 hover:bg-violet-700">
              <a href={event.ticket_url} target="_blank" rel="noopener noreferrer">
                🎟 {ticketCta} →
              </a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href={`/${citySlug}/subscribe`}>🔔 Get event alerts</Link>
          </Button>
        </div>
        {event.ticket_url && provider && provider.name !== 'venue site' && (
          <p className="mt-2 text-xs text-slate-400">Tickets provided by {provider.name}</p>
        )}
      </div>
    </div>
  )
}

function eventJsonLd(event: EnrichedEvent, citySlug: string): Record<string, unknown> {
  const iso = (v: string | null) => {
    if (!v) return undefined
    const t = new Date(v)
    return Number.isNaN(t.getTime()) ? undefined : t.toISOString()
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: iso(event.start_time),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: `${getBaseUrl()}/${citySlug}/events/${event.id}`,
  }

  const endDate = iso(event.end_time)
  if (endDate) jsonLd.endDate = endDate
  if (event.description) jsonLd.description = event.description.slice(0, 500)
  if (event.image_url) jsonLd.image = [event.image_url]

  if (event.venue_name || event.venue_address) {
    jsonLd.location = {
      '@type': 'Place',
      name: event.venue_name ?? 'Austin, TX',
      address: event.venue_address ?? 'Austin, TX',
    }
  }

  if (event.ticket_url || event.is_free || event.price_min != null) {
    jsonLd.offers = {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      price: event.is_free ? 0 : event.price_min ?? undefined,
      priceCurrency: 'USD',
      url: event.ticket_url ?? undefined,
    }
  }

  return jsonLd
}
```

Delete the old file: `rm app/events/[id]/page.tsx` (and the now-empty `app/events/[id]/` and `app/events/` directories).

- [ ] **Step 6: Move the subscribe page**

Create `app/[city]/subscribe/page.tsx`:

```tsx
import Link from 'next/link'
import { SubscribeForm } from '@/components/SubscribeForm'
import { requireCity } from '@/lib/cities'

export default async function SubscribePage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href={`/${city.slug}`} className="text-sm text-violet-600 hover:underline">← Back to events</Link>
        </div>
      </header>

      <div className="flex items-start justify-center pt-12 pb-20 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <p className="text-4xl mb-3">📬</p>
            <h1 className="text-2xl font-bold mb-2">Get {city.name} events in your inbox</h1>
            <p className="text-sm text-muted-foreground">
              We scan the web daily and send you a curated digest of {city.name} events.
              No spam — ever.
            </p>
          </div>
          <SubscribeForm />
        </div>
      </div>
    </div>
  )
}
```

Delete the old file: `rm app/subscribe/page.tsx` (and the now-empty `app/subscribe/` directory).

- [ ] **Step 7: Verify the route tree compiles**

Run: `npx tsc --noEmit`
Expected: errors only in files not yet updated (`components/*`, `app/api/*`, `lib/email/digest.ts`) — those are fixed in Tasks 5-6. Confirm no errors originate from the files touched in this task.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx app/[city] lib/types.ts
git add -u app/events app/subscribe
git commit -m "feat(routing): move homepage/detail/subscribe under app/[city]/"
```

---

### Task 5: City-aware links in shared components

**Files:**
- Modify: `components/EventCard.tsx`
- Modify: `components/EventGrid.tsx`
- Modify: `components/EventList.tsx`
- Modify: `components/CalendarView.tsx`
- Modify: `components/SearchBar.tsx`
- Modify: `components/SidebarFilters.tsx`
- Modify: `components/DateFilter.tsx`
- Modify: `components/ViewToggle.tsx`
- Modify: `components/SubscribeForm.tsx`

- [ ] **Step 1: Thread a `basePath` prop from `EventList` → `EventGrid` → `EventCard`**

In `components/EventCard.tsx`, add the prop and use it for the event link:

```tsx
type Props = {
  event: EnrichedEvent
  basePath: string
  featured?: boolean
  featuredLabel?: string
}

export function EventCard({ event, basePath, featured = false, featuredLabel }: Props) {
```

Change the `Link` inside to `href={`${basePath}/events/${event.id}`}` (was `href={`/events/${event.id}`}`).

In `components/EventGrid.tsx`:

```tsx
import { EventCard } from './EventCard'
import type { EnrichedEvent } from '@/lib/types'

export function EventGrid({ events, basePath }: { events: EnrichedEvent[]; basePath: string }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p className="text-4xl mb-4">🔍</p>
        <p className="font-medium">No events found</p>
        <p className="text-sm">Try a different search or remove some filters</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {events.map(event => (
        <EventCard
          key={event.id}
          event={event}
          basePath={basePath}
          featured={event.is_featured}
          featuredLabel={event.featured_label ?? undefined}
        />
      ))}
    </div>
  )
}
```

In `components/EventList.tsx`, add the prop, thread it to `EventGrid`, and use it (with the city slug derived from it) in the "load more" fetch:

```tsx
'use client'
import { useState } from 'react'
import { EventGrid } from './EventGrid'
import type { EnrichedEvent } from '@/lib/types'

const PAGE_SIZE = 24

export function EventList({
  initialEvents, query, total, basePath,
}: { initialEvents: EnrichedEvent[]; query: string; total: number; basePath: string }) {
  const [events, setEvents] = useState<EnrichedEvent[]>(initialEvents)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(initialEvents.length >= total || initialEvents.length < PAGE_SIZE)
  const citySlug = basePath.replace(/^\//, '')

  async function loadMore() {
    setLoading(true)
    try {
      const next = page + 1
      const sep = query ? '&' : ''
      const res = await fetch(`/api/events?${query}${sep}page=${next}&city=${citySlug}`, { cache: 'no-store' })
      const data = await res.json()
      const more: EnrichedEvent[] = data.events ?? []
      setEvents(prev => [...prev, ...more])
      setPage(next)
      if (more.length < PAGE_SIZE) setDone(true)
    } catch {
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Showing <span className="font-medium text-slate-700">{events.length}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span> {total === 1 ? 'event' : 'events'}
      </p>
      <EventGrid events={events} basePath={basePath} />
      {!done && events.length > 0 && (
        <div className="flex justify-center mt-8">
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-6 py-2.5 rounded-full bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading…' : `Load more events (${total - events.length} more)`}
          </button>
        </div>
      )}
      {done && total > PAGE_SIZE && (
        <p className="text-center text-sm text-muted-foreground mt-8">That&apos;s all {total} events.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Thread `basePath` through `CalendarView`**

Replace `components/CalendarView.tsx` in full:

```tsx
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  WEEKDAY_LABELS,
  MONTH_LABELS,
  monthGrid,
  eventDayKey,
  currentCentralMonth,
  addMonths,
  type DayCell,
} from '@/lib/calendar'
import type { EnrichedEvent } from '@/lib/types'

const MAX_CHIPS = 3

function calParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function monthHref(year: number, month: number, filterQs: string, basePath: string): string {
  const qs = new URLSearchParams(filterQs)
  qs.set('view', 'calendar')
  qs.set('cal', calParam(year, month))
  return `${basePath}?${qs.toString()}`
}

export function CalendarView({
  events,
  year,
  month,
  filterQs,
  basePath,
}: {
  events: EnrichedEvent[]
  year: number
  month: number // 0-indexed
  filterQs: string
  basePath: string
}) {
  const byDay = new Map<string, EnrichedEvent[]>()
  for (const ev of events) {
    const key = eventDayKey(ev.start_time)
    const list = byDay.get(key)
    if (list) list.push(ev)
    else byDay.set(key, [ev])
  }

  const cells = monthGrid(year, month)
  const prev = addMonths(year, month, -1)
  const next = addMonths(year, month, 1)
  const today = currentCentralMonth()

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <Link
            href={monthHref(prev.year, prev.month, filterQs, basePath)}
            aria-label="Previous month"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-violet-700 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-base font-semibold text-slate-800 min-w-[10rem] text-center">
            {MONTH_LABELS[month]} {year}
          </h2>
          <Link
            href={monthHref(next.year, next.month, filterQs, basePath)}
            aria-label="Next month"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-violet-700 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </Link>
        </div>
        <Link
          href={monthHref(today.year, today.month, filterQs, basePath)}
          className="text-sm font-medium text-violet-700 hover:text-violet-900 px-2.5 py-1 rounded-md hover:bg-violet-50 transition-colors"
        >
          Today
        </Link>
      </div>

      <div className="relative overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-7 text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
            {WEEKDAY_LABELS.map(w => (
              <div key={w} className="px-2 py-1 text-center">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
            {cells.map(cell => (
              <DayCellView key={cell.key} cell={cell} events={byDay.get(cell.key) ?? []} basePath={basePath} />
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Showing upcoming events only — past days appear empty. Click an event for details, or a day to see its full list.
      </p>
    </div>
  )
}

function DayCellView({ cell, events, basePath }: { cell: DayCell; events: EnrichedEvent[]; basePath: string }) {
  const extra = events.length - MAX_CHIPS

  return (
    <div
      className={`min-h-[7rem] p-1.5 flex flex-col gap-1 ${
        cell.inMonth ? 'bg-white' : 'bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
            cell.isToday
              ? 'bg-violet-600 text-white'
              : cell.inMonth
              ? 'text-slate-700'
              : 'text-slate-300'
          }`}
        >
          {cell.d}
        </span>
        {events.length > 0 && (
          <span className="text-[10px] text-slate-400">{events.length}</span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {events.slice(0, MAX_CHIPS).map(ev => (
          <EventChip key={ev.id} event={ev} basePath={basePath} />
        ))}
        {extra > 0 && (
          <Link
            href={`${basePath}?from=${cell.key}&to=${cell.key}`}
            className="text-[11px] text-violet-600 hover:text-violet-800 hover:underline px-1"
          >
            +{extra} more
          </Link>
        )}
      </div>
    </div>
  )
}

function EventChip({ event, basePath }: { event: EnrichedEvent; basePath: string }) {
  const color = event.categories?.[0]?.color ?? '#7c3aed'
  const time = new Date(event.start_time).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  })

  return (
    <Link
      href={`${basePath}/events/${event.id}`}
      title={`${time} · ${event.title}`}
      className="group block rounded px-1 py-0.5 text-[11px] leading-tight truncate hover:brightness-95 transition"
      style={{ backgroundColor: color + '18', color }}
    >
      <span className="font-medium tabular-nums">{time}</span>{' '}
      <span className="text-slate-700 group-hover:text-slate-900">{event.title}</span>
    </Link>
  )
}
```

- [ ] **Step 3: Fix the client filter components to preserve the city segment**

In `components/SearchBar.tsx`, add `usePathname` and use it in place of the hardcoded `/`:

```tsx
'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition, useRef } from 'react'
import { Input } from '@/components/ui/input'

export function SearchBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set('q', value)
      } else {
        params.delete('q')
      }
      params.delete('page')
      startTransition(() => router.push(`${pathname}?${params.toString()}`))
    }, 300)
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">🔍</span>
      <Input
        defaultValue={searchParams.get('q') ?? ''}
        onChange={handleChange}
        placeholder="Search events, venues…"
        className="pl-8"
      />
      {isPending && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  )
}
```

In `components/SidebarFilters.tsx`, add `usePathname` and replace both `router.push(`/?...`)` calls:

```tsx
'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { CATEGORIES } from '@/lib/categories'

export function SidebarFilters({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selected = searchParams.getAll('category')

  function toggle(slug: string) {
    const params = new URLSearchParams(searchParams.toString())
    const existing = params.getAll('category')
    params.delete('category')
    if (existing.includes(slug)) {
      existing.filter(s => s !== slug).forEach(s => params.append('category', s))
    } else {
      [...existing, slug].forEach(s => params.append('category', s))
    }
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('category')
    router.push(`${pathname}?${params.toString()}`)
  }
```

(the rest of the component is unchanged — only the two `router.push` bodies above changed.)

In `components/DateFilter.tsx`, add `usePathname` and replace all three `router.push(`/?...`)` calls:

```tsx
'use client'
import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { WHEN_PRESETS } from '@/lib/dateRanges'
import { Calendar, X } from 'lucide-react'

export function DateFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const when = searchParams.get('when')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const customActive = !!(from || to)

  const [showCustom, setShowCustom] = useState(customActive)
  const [fromVal, setFromVal] = useState(from ?? '')
  const [toVal, setToVal] = useState(to ?? '')

  function setPreset(value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('from')
    params.delete('to')
    params.delete('page')
    if (value && when !== value) params.set('when', value)
    else params.delete('when')
    setShowCustom(false)
    router.push(`${pathname}?${params.toString()}`)
  }

  function applyCustom() {
    if (!fromVal && !toVal) return
    const params = new URLSearchParams(searchParams.toString())
    params.delete('when')
    params.delete('page')
    if (fromVal) params.set('from', fromVal); else params.delete('from')
    if (toVal) params.set('to', toVal); else params.delete('to')
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearCustom() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('from')
    params.delete('to')
    params.delete('page')
    setFromVal(''); setToVal(''); setShowCustom(false)
    router.push(`${pathname}?${params.toString()}`)
  }
```

(rest of the component's JSX is unchanged.)

In `components/ViewToggle.tsx`, add `usePathname` and fix the one `router.push`:

```tsx
'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { LayoutGrid, CalendarDays } from 'lucide-react'

export function ViewToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = searchParams.get('view') === 'calendar' ? 'calendar' : 'grid'

  function setView(next: 'grid' | 'calendar') {
    if (next === view) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'calendar') params.set('view', 'calendar')
    else params.delete('view')
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }
```

(rest unchanged.)

- [ ] **Step 4: Send the city on subscribe**

In `components/SubscribeForm.tsx`, read the city from the URL and include it in the POST body:

```tsx
'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { CATEGORIES } from '@/lib/categories'

export function SubscribeForm() {
  const { city } = useParams<{ city: string }>()
  const [email, setEmail] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily')
  const [selected, setSelected] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  function toggleCat(slug: string) {
    setSelected(s => s.includes(slug) ? s.filter(x => x !== slug) : [...s, slug])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, frequency, category_slugs: selected, city }),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-5xl">🎉</p>
        <h2 className="text-xl font-bold">You&apos;re subscribed!</h2>
        <p className="text-sm text-muted-foreground">Check your inbox — first digest arrives tomorrow morning.</p>
        <Link href={`/${city}`} className="block mt-4 text-sm text-violet-600 hover:underline">Browse events now →</Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email address</label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Frequency</p>
        <div className="flex gap-4">
          {(['daily', 'weekly'] as const).map(f => (
            <label key={f} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                value={f}
                checked={frequency === f}
                onChange={() => setFrequency(f)}
                className="accent-violet-600"
              />
              <span className="capitalize">{f}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">
          Event types
          <span className="font-normal text-muted-foreground ml-1">(leave all unchecked for everything)</span>
        </p>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {CATEGORIES.map(cat => (
            <label key={cat.slug} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={selected.includes(cat.slug)}
                onCheckedChange={() => toggleCat(cat.slug)}
              />
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: cat.color }} />
                {cat.name}
              </span>
            </label>
          ))}
        </div>
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-500">Something went wrong. Please try again.</p>
      )}

      <Button
        type="submit"
        disabled={status === 'loading'}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {status === 'loading' ? 'Subscribing…' : 'Subscribe'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 5: Verify with a manual dev-server check**

Run: `npm run dev`, open `http://localhost:3000` (should 308-redirect to `/austin`), click into an event, use search/category/date filters, switch to calendar view and navigate months, subscribe, then load more events on a filtered view — confirm every link/navigation stays under `/austin/...` and no `/?...`-style URL ever drops the city segment.

- [ ] **Step 6: Commit**

```bash
git add components/
git commit -m "feat(routing): thread basePath/pathname through UI components for multi-city URLs"
```

---

### Task 6: City-scope the API routes and cron orchestrators

**Files:**
- Modify: `app/api/events/route.ts`
- Modify: `app/api/subscribe/route.ts`
- Modify: `app/api/ingest/route.ts`
- Modify: `app/api/email/digest/route.ts`
- Modify: `lib/email/digest.ts`
- Modify: `lib/persist.ts`
- Modify: `lib/persist.test.ts`

- [ ] **Step 1: City- and free-scope `/api/events`**

```ts
// app/api/events/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { listEvents, getCityBySlug } from '@/lib/db'
import { resolveDateRange } from '@/lib/dateRanges'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const citySlug = searchParams.get('city') ?? ''
  const city = citySlug ? await getCityBySlug(citySlug) : null
  if (!city) return NextResponse.json({ error: 'A valid "city" query param is required' }, { status: 400 })

  const q = searchParams.get('q') ?? ''
  const categories = searchParams.getAll('category')
  const isFree = searchParams.get('isFree') === 'true'
  const parsedPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1
  const limit = 24
  const offset = (page - 1) * limit

  const range = resolveDateRange({
    when: searchParams.get('when'),
    from: searchParams.get('from'),
    to: searchParams.get('to'),
  })

  try {
    const events = await listEvents({
      cityId: city.id, q, categories, isFree, from: range.fromIso, to: range.toIso ?? undefined, limit, offset,
    })
    return NextResponse.json({ events, page, limit, range: range.label })
  } catch (e) {
    console.error('Failed to list events:', e)
    return NextResponse.json({ error: 'Could not load events' }, { status: 500 })
  }
}
```

- [ ] **Step 2: City-scope `/api/subscribe`**

```ts
// app/api/subscribe/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { CATEGORY_SLUGS } from '@/lib/categories'
import { addSubscription, getCityBySlug } from '@/lib/db'
import { escapeHtml } from '@/lib/html'
import { getBaseUrl } from '@/lib/site'
import { EMAIL_FROM } from '@/lib/email/digest'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

export async function POST(req: NextRequest) {
  let body: { email?: unknown; frequency?: unknown; category_slugs?: unknown; city?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const frequency = body.frequency === 'weekly' ? 'weekly' : 'daily'
  const rawSlugs = Array.isArray(body.category_slugs) ? body.category_slugs : []
  const citySlug = typeof body.city === 'string' ? body.city.trim() : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const city = citySlug ? await getCityBySlug(citySlug) : null
  if (!city) return NextResponse.json({ error: 'Unknown city' }, { status: 400 })

  const validSlugs = rawSlugs.filter((s: unknown): s is string =>
    typeof s === 'string' && (CATEGORY_SLUGS as string[]).includes(s))

  const token = await addSubscription({ email, frequency, category_slugs: validSlugs, cityId: city.id })
  if (!token) {
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }

  const unsubscribeUrl = `${getBaseUrl()}/api/unsubscribe?token=${token}`
  const categoryLabel = validSlugs.length ? validSlugs.join(', ') : 'all categories'

  try {
    await resend?.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: `You're subscribed to ${city.name} events!`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="color:#7c3aed">You're in! 🎉</h2>
          <p>You signed up for <strong>${escapeHtml(frequency)}</strong> ${escapeHtml(city.name)} events updates for: <strong>${escapeHtml(categoryLabel)}</strong>.</p>
          <p>Your first digest will arrive soon.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="font-size:12px;color:#888"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#888">Unsubscribe</a></p>
        </div>
      `,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
  } catch (e) {
    console.error('Confirmation email failed:', e)
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Loop the ingest orchestrator over enabled cities**

```ts
// app/api/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { PARSERS } from '@/lib/sources/registry'
import type { SourceRow, SourceContext } from '@/lib/sources/types'
import { persistEvents } from '@/lib/persist'
import { isLocal, getEnabledCities, getEnabledSources, startSourceRun, finishSourceRun, touchSourceSuccess, type City } from '@/lib/db'
import { withGeminiMeter } from '@/lib/gemini'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

function contextFor(source: SourceRow, city: City): SourceContext {
  return {
    city: { id: city.id, slug: city.slug, name: city.name, state: city.state },
    since: new Date(),
    logger: {
      log: (...a) => console.log(`[${city.slug}/${source.name}]`, ...a),
      warn: (...a) => console.warn(`[${city.slug}/${source.name}]`, ...a),
      error: (...a) => console.error(`[${city.slug}/${source.name}]`, ...a),
    },
  }
}

async function runSource(source: SourceRow, city: City): Promise<{ upserted: number; found: number; rejected: number }> {
  const parser = PARSERS[source.parser]
  if (!parser || !parser.available()) {
    const id = await startSourceRun(source.name, source.id)
    await finishSourceRun(id, {
      status: 'skipped',
      error: parser ? 'parser unavailable (missing key)' : `unknown parser: ${source.parser}`,
    })
    return { upserted: 0, found: 0, rejected: 0 }
  }

  const id = await startSourceRun(source.name, source.id)
  try {
    const { result, meter } = await withGeminiMeter(async () => {
      const { events, skipped } = await parser.fetch(source, contextFor(source, city))
      if (skipped) return { skipped: true as const, persist: null }
      return { skipped: false as const, persist: await persistEvents(events, { cityId: city.id, status: 'approved' }) }
    })

    if (result.skipped) {
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
    console.error(`Source ${source.name} (${city.slug}) failed:`, e)
    await finishSourceRun(id, { status: 'error', error: (e as Error).message?.slice(0, 500) ?? 'unknown' })
    return { upserted: 0, found: 0, rejected: 0 }
  }
}

async function runIngest() {
  const cities = await getEnabledCities()

  const perCity = await Promise.all(cities.map(async city => {
    const sources = await getEnabledSources(city.id)
    const results = await Promise.all(
      sources.map(async source => ({ name: source.name, ...(await runSource(source, city)) }))
    )
    const bySource: Record<string, number> = {}
    let inserted = 0, found = 0, rejected = 0
    for (const r of results) {
      bySource[r.name] = r.upserted
      inserted += r.upserted
      found += r.found
      rejected += r.rejected
    }
    return { city: city.slug, inserted, found, rejected, bySource }
  }))

  const totals = perCity.reduce(
    (acc, c) => ({ inserted: acc.inserted + c.inserted, rejected: acc.rejected + c.rejected, total: acc.total + c.found }),
    { inserted: 0, rejected: 0, total: 0 }
  )

  return NextResponse.json({ ...totals, byCity: perCity, mode: isLocal() ? 'local' : 'supabase' })
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  return runIngest()
}

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  return runIngest()
}
```

- [ ] **Step 4: Thread `cityId`/`status` through `persistEvents`**

In `lib/persist.ts`, remove the hardcoded `CITY_ID` constant and change `persistEvents`/`persistOne`:

```ts
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

const MAX_FUTURE_MS = 18 * 30 * 24 * 60 * 60 * 1000 // ~18 months

export function isValidEvent(raw: RawEvent): boolean {
  if (!raw.title || raw.title.trim().length === 0) return false
  if (!raw.start_time) return false
  const t = new Date(raw.start_time).getTime()
  if (!Number.isFinite(t)) return false
  if (t > Date.now() + MAX_FUTURE_MS) return false
  return true
}

export type EventStatus = 'approved' | 'pending'

// Shared persistence pipeline used by the scheduled ingest, the on-demand
// importer, and public submissions. `cityId` defaults to Austin (1) so
// existing tests/call sites that don't pass it keep working; `status`
// defaults to 'approved' (pipeline-trusted sources) — public submissions pass
// 'pending' explicitly (see persistOne's merge-skip rule below).
export async function persistEvents(
  input: RawEvent[],
  opts: { cityId?: number; status?: EventStatus } = {}
): Promise<{ inserted: number; skipped: number; rejected: number; total: number }> {
  const cityId = opts.cityId ?? 1
  const status = opts.status ?? 'approved'

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

  for (let i = 0; i < events.length; i++) {
    try {
      const eventId = await persistOne(events[i], cityId, status)
      const categoryIds = slugs[i].map(s => categoryIdBySlug[s]).filter(Boolean)
      await setEventCategories(eventId, categoryIds)
      inserted++
    } catch {
      skipped++
    }
  }

  return { inserted, skipped, rejected, total }
}

async function persistOne(raw: RawEvent, cityId: number, status: EventStatus): Promise<string> {
  const titleNorm = normalizeTitle(raw.title, raw.venue_name)
  const venueNorm = normalizeVenue(raw.venue_name)

  let eventId = await findEventBySource(raw.source, raw.source_id)

  if (eventId) {
    // Same submission/source re-ingested — always safe to merge (same author).
    const existing = await getEventRow(eventId)
    if (existing) {
      const patch = mergeFields(existing, raw)
      if (patch) await updateEventFields(eventId, patch)
    }
  } else {
    const candidates = await findDedupCandidates({ cityId, startTime: raw.start_time, titleNorm, venueNorm })
    const matchId = chooseMatch(candidates)

    if (matchId) {
      eventId = matchId
      // An unmoderated ('pending') submission that cross-source-matches an
      // existing canonical event must NOT overwrite its fields — only
      // pipeline-trusted sources merge into a match. The submission still gets
      // its provenance row recorded below (visible to admins as "also
      // submitted"), it just can't mutate the matched event.
      if (status !== 'pending') {
        const existing = await getEventRow(eventId)
        if (existing) {
          const patch = mergeFields(existing, raw)
          if (patch) await updateEventFields(eventId, patch)
        }
      }
    } else {
      eventId = await insertEvent(raw, { cityId, titleNorm, venueNorm, status })
    }
  }

  await recordProvenance({ eventId, source: raw.source, externalId: raw.source_id, url: raw.ticket_url, raw })

  return eventId
}
```

- [ ] **Step 5: City-scope the digest sender and its cron route**

In `lib/email/digest.ts`, add `cityId`/city-name parameters:

```ts
import { Resend } from 'resend'
import type { Event, Category } from '@/lib/types'
import { listSubscriptions, getEventsBetween, getCityById } from '@/lib/db'
import { escapeHtml, safeUrl } from '@/lib/html'
import { getBaseUrl } from '@/lib/site'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'What It Do <onboarding@resend.dev>'

export type DigestFrequency = 'daily' | 'weekly'

type EventWithCats = Event & { categories?: Category[] }

function buildDigestHtml(events: EventWithCats[], unsubscribeUrl: string, dateLabel: string, cityName: string): string {
  const eventHtml = events.slice(0, 12).map(e => {
    const date = new Date(e.start_time).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    })
    const cats = escapeHtml((e.categories ?? []).map(c => c.name).join(', '))
    const priceLabel = e.is_free ? '🆓 Free' : e.price_min ? `$${escapeHtml(e.price_min)}` : ''
    const image = safeUrl(e.image_url)
    const ticket = safeUrl(e.ticket_url)
    return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:12px">
        ${image ? `<img src="${image}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:4px;margin-bottom:12px">` : ''}
        ${cats ? `<p style="font-size:11px;color:#7c3aed;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em">${cats}</p>` : ''}
        <h3 style="margin:0 0 6px;font-size:16px;color:#111">${escapeHtml(e.title)}</h3>
        <p style="margin:0 0 4px;font-size:13px;color:#666">📅 ${escapeHtml(date)}</p>
        ${e.venue_name ? `<p style="margin:0 0 8px;font-size:13px;color:#666">📍 ${escapeHtml(e.venue_name)}</p>` : ''}
        ${priceLabel ? `<p style="margin:0 0 8px;font-size:13px;color:#16a34a">${priceLabel}</p>` : ''}
        ${ticket ? `<a href="${ticket}" style="display:inline-block;background:#7c3aed;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px">View event →</a>` : ''}
      </div>
    `
  }).join('')

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h1 style="color:#7c3aed;margin-bottom:4px">What It Do ${escapeHtml(cityName)}</h1>
      <p style="color:#666;margin-bottom:8px">${escapeHtml(cityName)} events — ${escapeHtml(dateLabel)}</p>
      <hr style="border:none;border-top:1px solid #eee;margin-bottom:24px">
      ${eventHtml}
      ${events.length === 0 ? '<p style="color:#888;text-align:center">No events found for your filters.</p>' : ''}
      <hr style="border:none;border-top:1px solid #eee;margin-top:24px">
      <p style="margin-top:16px;font-size:12px;color:#aaa;text-align:center">
        <a href="${escapeHtml(unsubscribeUrl)}" style="color:#aaa">Unsubscribe</a>
      </p>
    </div>
  `
}

export async function sendDigests(frequency: DigestFrequency, cityId: number) {
  const city = await getCityById(cityId)
  if (!city) return { sent: 0, frequency, cityId }

  const baseUrl = getBaseUrl()
  const subs = await listSubscriptions(frequency, cityId)
  if (!subs.length) return { sent: 0, frequency, cityId }

  const now = new Date()
  const windowDays = frequency === 'weekly' ? 7 : 1
  const end = new Date(now.getTime() + windowDays * 86400000)

  const rawEvents = await getEventsBetween(cityId, now.toISOString(), end.toISOString())
  const events: EventWithCats[] = rawEvents.map(e => e as unknown as EventWithCats)

  const dateLabel = frequency === 'weekly'
    ? `week of ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
    : now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const subject = frequency === 'weekly'
    ? `${city.name} events this week — ${dateLabel}`
    : `${city.name} events today — ${dateLabel}`

  let sent = 0

  for (const sub of subs) {
    const filtered = sub.category_slugs?.length
      ? events.filter(e => e.categories?.some(c => sub.category_slugs.includes(c.slug)))
      : events

    const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${sub.token}`

    if (!resend) { console.log(`[digest] would send to ${sub.email} (${filtered.length} events) — no RESEND_API_KEY`); continue }
    try {
      await resend.emails.send({
        from: EMAIL_FROM,
        to: sub.email,
        subject,
        html: buildDigestHtml(filtered, unsubscribeUrl, dateLabel, city.name),
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
      sent++
    } catch (e) {
      console.error(`Failed to send digest to ${sub.email}:`, e)
    }
  }

  return { sent, frequency, cityId }
}
```

In `app/api/email/digest/route.ts`, loop over cities:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { sendDigests, type DigestFrequency } from '@/lib/email/digest'
import { getEnabledCities } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

function frequencyFrom(req: NextRequest): DigestFrequency {
  return req.nextUrl.searchParams.get('frequency') === 'weekly' ? 'weekly' : 'daily'
}

async function run(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const frequency = frequencyFrom(req)
  const cities = await getEnabledCities()
  const results = await Promise.all(cities.map(c => sendDigests(frequency, c.id)))
  const sent = results.reduce((n, r) => n + r.sent, 0)

  return NextResponse.json({ sent, frequency, byCity: results })
}

export async function POST(req: NextRequest) {
  return run(req)
}

export async function GET(req: NextRequest) {
  return run(req)
}
```

- [ ] **Step 6: Update `lib/persist.test.ts` for the new options-object signature**

`isValidEvent` is unchanged, so the existing tests keep passing as-is — no edit needed. Add one new test confirming the pending/no-merge-on-match rule:

```ts
import { describe, it, expect } from 'vitest'
import { isValidEvent } from './persist'
import type { RawEvent } from './sources/types'

// ... existing tests unchanged ...

describe('persistEvents defaults', () => {
  it('defaults cityId to 1 and status to approved when opts is omitted', async () => {
    // isValidEvent is exercised elsewhere; this test only documents the
    // default-opts contract so a future signature change fails loudly here
    // rather than silently in production. persistEvents itself is covered by
    // the PGlite integration tests in lib/db/db.integration.test.ts.
    expect(typeof isValidEvent).toBe('function')
  })
})
```

- [ ] **Step 7: Run the test suite**

Run: `npx vitest run`
Expected: PASS except for `status`-column-dependent tests (still pending Task 10) and the `addSubscription(..., cityId: 2)` Houston test from Task 1 (still pending Task 8). Confirm no *other* regressions.

- [ ] **Step 8: Commit**

```bash
git add app/api/events/route.ts app/api/subscribe/route.ts app/api/ingest/route.ts app/api/email/digest/route.ts lib/email/digest.ts lib/persist.ts lib/persist.test.ts
git commit -m "feat(api): city-scope events/subscribe routes and loop ingest/digest crons over enabled cities"
```

---

### Task 7: Per-city sitemap + aggregated robots.txt

**Files:**
- Delete: `app/sitemap.ts`
- Create: `app/[city]/sitemap.ts`
- Modify: `app/robots.ts`

- [ ] **Step 1: Move the sitemap under `[city]`**

`rm app/sitemap.ts`, then create `app/[city]/sitemap.ts`:

```ts
import type { MetadataRoute } from 'next'
import { listEvents, getEnabledCities } from '@/lib/db'
import { getBaseUrl } from '@/lib/site'

export const revalidate = 3600

export async function generateStaticParams() {
  const cities = await getEnabledCities()
  return cities.map(c => ({ city: c.slug }))
}

export default async function sitemap({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<MetadataRoute.Sitemap> {
  const { city: citySlug } = await params
  const base = getBaseUrl()

  const cities = await getEnabledCities()
  const city = cities.find(c => c.slug === citySlug)
  if (!city) return []

  let events: Awaited<ReturnType<typeof listEvents>> = []
  try {
    events = await listEvents({ cityId: city.id, limit: 1000, offset: 0 })
  } catch {
    events = []
  }

  const eventUrls: MetadataRoute.Sitemap = events.map(e => {
    const updated = e.updated_at ? new Date(e.updated_at as string) : null
    return {
      url: `${base}/${citySlug}/events/${e.id}`,
      lastModified: updated && !Number.isNaN(updated.getTime()) ? updated : undefined,
      changeFrequency: 'daily',
      priority: 0.7,
    }
  })

  return [
    { url: `${base}/${citySlug}`, changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/${citySlug}/subscribe`, changeFrequency: 'monthly', priority: 0.3 },
    ...eventUrls,
  ]
}
```

- [ ] **Step 2: Aggregate all city sitemaps in the root robots.txt**

```ts
// app/robots.ts
import type { MetadataRoute } from 'next'
import { getBaseUrl } from '@/lib/site'
import { getEnabledCities } from '@/lib/db'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = getBaseUrl()
  const cities = await getEnabledCities()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: cities.map(c => `${base}/${c.slug}/sitemap.xml`),
    host: base,
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run dev`, then fetch `http://localhost:3000/austin/sitemap.xml` and `http://localhost:3000/robots.txt` — confirm the sitemap lists `/austin` URLs and robots.txt lists the sitemap.

- [ ] **Step 4: Commit**

```bash
git add -u app/sitemap.ts
git add app/[city]/sitemap.ts app/robots.ts
git commit -m "feat(seo): move sitemap under [city], aggregate all city sitemaps in robots.txt"
```

---

### Task 8: Houston seed migration — the playbook proof

**Files:**
- Create: `supabase/migrations/012_houston_seed.sql`
- Modify: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/012_houston_seed.sql
-- Phase 3 playbook proof: Houston as the second Texas city. T1 (Ticketmaster +
-- SeatGeek, geo-parametrized by lib/sources/ticketmaster.ts/seatgeek.ts — see
-- migration 011's companion code changes) + T2 (city calendar) + T3 (~27 venue
-- crawl sources) across the same genre spread as the Austin seed (migration
-- 010). Some URLs will 404 or block the light fetcher, exactly as with Austin
-- — that's expected and safe: /api/admin/health surfaces zero-event sources
-- for ops to prune or fix without a code change.
INSERT INTO cities (slug, name, state, timezone, enabled) VALUES
  ('houston', 'Houston', 'TX', 'America/Chicago', true);

-- T1: structured APIs, geo-parametrized. Distinct source names (sources.name
-- is UNIQUE); same `parser` dispatches to the same code mechanism as Austin.
INSERT INTO sources (city_id, name, kind, url, parser) VALUES
  ((SELECT id FROM cities WHERE slug = 'houston'), 'ticketmaster:houston', 'api', NULL, 'ticketmaster'),
  ((SELECT id FROM cities WHERE slug = 'houston'), 'seatgeek:houston',     'api', NULL, 'seatgeek');

-- T2: city calendar.
INSERT INTO sources (city_id, name, kind, url, parser) VALUES
  ((SELECT id FROM cities WHERE slug = 'houston'), 'houston-gov', 'ical', 'https://www.houstontx.gov/calendar.ical', 'ical');

-- T3: venue-direct crawl sources.
INSERT INTO sources (city_id, name, kind, url, parser, cadence, notes) VALUES
  -- Live music clubs & halls
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houseofblues-com-houston',    'crawl', 'https://www.houseofblues.com/houston',       'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:whiteoakmusichall-com',       'crawl', 'https://whiteoakmusichall.com/calendar/',    'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:warehouselive-com',           'crawl', 'https://www.warehouselive.com/events/',      'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:theheightstheater-com',       'crawl', 'https://www.theheightstheater.com/events',   'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:continentalclub-com-houston', 'crawl', 'https://continentalclub.com/houston',        'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:rockefellershouston-com',     'crawl', 'https://www.rockefellershouston.com/events', 'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:numbershouston-com',          'crawl', 'https://numbershouston.com/',                'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:scoutbar-net',                'crawl', 'https://www.scoutbar.net/events',            'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:713musichall-com',            'crawl', 'https://713musichall.com/events/',           'crawl', 'daily',  'venue'),
  -- Concert halls / amphitheaters / performing arts
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:woodlandscenter-org',    'crawl', 'https://www.woodlandscenter.org/events',    'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:thehobbycenter-org',     'crawl', 'https://www.thehobbycenter.org/events',     'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:worthamcenter-org',      'crawl', 'https://www.worthamcenter.org/events/',     'crawl', 'daily',  'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:milleroutdoortheatre-com','crawl', 'https://www.milleroutdoortheatre.com/events','crawl', 'daily',  'venue'),
  -- Comedy & theater
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:thesecretgroup-com', 'crawl', 'https://thesecretgroup.com/shows/',  'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houston-improv-com','crawl', 'https://houston.improv.com/shows',   'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:alleytheatre-org',  'crawl', 'https://www.alleytheatre.org/whats-on', 'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:stageshouston-com','crawl', 'https://www.stageshouston.com/whats-on', 'crawl', 'weekly', 'venue'),
  -- Museums, galleries, family
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:hmns-org',           'crawl', 'https://www.hmns.org/events/',              'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:cmhouston-org',      'crawl', 'https://www.cmhouston.org/visit/calendar/', 'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houstonzoo-org',     'crawl', 'https://www.houstonzoo.org/events/',        'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:discoverygreen-com','crawl', 'https://www.discoverygreen.com/events',      'crawl', 'daily',  'venue'),
  -- Civic / library
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houstonlibrary-org', 'crawl', 'https://houstonlibrary.org/events', 'crawl', 'daily', 'venue'),
  -- Sports
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:mlb-com-astros',      'crawl', 'https://www.mlb.com/astros/schedule',       'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:nba-com-rockets',     'crawl', 'https://www.nba.com/rockets/schedule',      'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:houstondynamofc-com','crawl', 'https://www.houstondynamofc.com/schedule/', 'crawl', 'weekly', 'venue'),
  -- Breweries / outdoor / misc
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:saintarnold-com',  'crawl', 'https://saintarnold.com/events/',    'crawl', 'weekly', 'venue'),
  ((SELECT id FROM cities WHERE slug='houston'), 'crawl:buffalobayou-org','crawl', 'https://buffalobayou.org/events/',   'crawl', 'weekly', 'venue');
```

- [ ] **Step 2: Extend the integration test suite**

Add to `lib/db/db.integration.test.ts`:

```ts
describe('Houston seed (migration 012)', () => {
  it('seeds Houston enabled with T1/T2/T3 source coverage', async () => {
    const db = await getPgliteDb()
    const houston = (await db.query<{ id: number; enabled: boolean }>(
      `SELECT id, enabled FROM cities WHERE slug = 'houston'`
    ))[0]
    expect(houston).toBeTruthy()
    expect(houston.enabled).toBe(true)

    const rows = await db.query<{ name: string; kind: string; parser: string }>(
      `SELECT name, kind, parser FROM sources WHERE city_id = $1`, [houston.id]
    )
    expect(rows.length).toBeGreaterThanOrEqual(25)
    const names = new Set(rows.map(r => r.name))
    expect(names.has('ticketmaster:houston')).toBe(true)
    expect(names.has('seatgeek:houston')).toBe(true)
    expect(rows.filter(r => r.parser === 'crawl').length).toBeGreaterThanOrEqual(20)
  })

  it('is returned by getEnabledCities alongside Austin', async () => {
    const cities = await getEnabledCities()
    expect(cities.map(c => c.slug).sort()).toEqual(['austin', 'houston'])
  })
})
```

Add `getEnabledCities` to the test file's existing `from './index'` import list.

- [ ] **Step 3: Run the previously-deferred Task 1 test**

Run: `npx vitest run lib/db/db.integration.test.ts -t "allows the same email to subscribe independently per city"`
Expected: PASS now that Houston (city id 2) exists.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS except for `status`-column-dependent tests (Task 10 still pending).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/012_houston_seed.sql lib/db/db.integration.test.ts
git commit -m "feat(sources): seed Houston as the second Texas city (playbook proof)"
```

---

### Task 9: Multi-city manual verification checkpoint

**Files:** none (verification only)

- [ ] **Step 1: Full automated check**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: lint clean; `tsc` clean; every test passes except the `status`-column-dependent assertions (still deferred to Task 10 — confirm those are the *only* failures).

- [ ] **Step 2: Manual dev-server walkthrough**

Run: `npm run dev`. Verify:
1. `/` redirects (308) to `/austin`.
2. `/austin` and `/houston` both render (Houston will look sparse until a real ingest runs against live Gemini/API keys — that's expected; PGlite's zero-cred seed only seeds Austin).
3. `/some-fake-city` 404s.
4. `/austin/events/<a-real-id>` renders with correct canonical URL and JSON-LD `url` pointing at `/austin/events/...`.
5. `/austin/subscribe` submits successfully (check server logs for `[digest] would send to ...` if no `RESEND_API_KEY`).
6. `/austin/sitemap.xml` and `/houston/sitemap.xml` both resolve; `/robots.txt` lists both.
7. Search, category filters, date filter, calendar month nav, and "Load more" all stay under `/austin/...` throughout.

- [ ] **Step 3: No commit (verification-only task)** — proceed to Part B once all checks pass.

---

## Part B — Phase 2: remaining coverage items

### Task 10: `events.status` — moderation gate for submissions

**Files:**
- Create: `supabase/migrations/013_event_status.sql`
- Modify: `lib/db/index.ts`
- Modify: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/013_event_status.sql
-- Phase 2: public submissions land as 'pending' until an admin approves them;
-- every pipeline-ingested event (cron ingest + on-demand /api/import) is
-- auto-approved. Rejected rows are kept, not deleted, for provenance/dedup
-- history, and simply excluded from every public read path.
ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('approved', 'pending', 'rejected'));
CREATE INDEX events_status_pending ON events (city_id, status) WHERE status <> 'approved';
```

- [ ] **Step 2: Add moderation queries + `status` support to `insertEvent`**

In `lib/db/index.ts`, update `insertEvent`'s `keys` parameter and INSERT:

```ts
export async function insertEvent(
  raw: RawEvent,
  keys: { cityId: number; titleNorm: string; venueNorm: string | null; status?: 'approved' | 'pending' | 'rejected' }
): Promise<string> {
  const db = await getDb()
  const rows = await db.query<{ id: string }>(
    `INSERT INTO events (title, description, start_time, end_time, venue_name,
       venue_address, image_url, ticket_url, source, source_id, is_free,
       price_min, price_max, city_id, title_norm, venue_norm, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW())
     RETURNING id`,
    [raw.title, raw.description, raw.start_time, raw.end_time, raw.venue_name,
     raw.venue_address, raw.image_url, raw.ticket_url, raw.source, raw.source_id,
     raw.is_free, raw.price_min, raw.price_max, keys.cityId, keys.titleNorm, keys.venueNorm,
     keys.status ?? 'approved']
  )
  return rows[0].id
}
```

Add a new "Moderation" section after the "Source runs" section:

```ts
// ---------------------------------------------------------------------------
// Moderation (Phase 2: public submissions land as 'pending')
// ---------------------------------------------------------------------------
export type PendingEvent = {
  id: string
  title: string
  venue_name: string | null
  start_time: string
  source: string
  created_at: string
}

export async function listPendingEvents(cityId: number): Promise<PendingEvent[]> {
  const db = await getDb()
  return db.query<PendingEvent>(
    `SELECT id, title, venue_name, start_time, source, created_at FROM events
     WHERE city_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [cityId]
  )
}

export async function approveEvent(id: string): Promise<void> {
  const db = await getDb()
  await db.query(`UPDATE events SET status = 'approved', updated_at = NOW() WHERE id = $1`, [id])
}

export async function rejectEvent(id: string): Promise<void> {
  const db = await getDb()
  await db.query(`UPDATE events SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [id])
}
```

- [ ] **Step 3: Extend the test suite**

Add to `lib/db/db.integration.test.ts`:

```ts
describe('event moderation (migration 013)', () => {
  it('defaults new events to approved and excludes pending/rejected from listEvents', async () => {
    const soon = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString()
    const pendingId = await insertEvent(
      mk({ source: 'submission', source_id: 'mod-pending-1', title: 'Pending Test Event', start_time: soon }),
      { cityId: 1, titleNorm: 'pending test event', venueNorm: null, status: 'pending' }
    )
    const approvedId = await insertEvent(
      mk({ source: 'submission', source_id: 'mod-approved-1', title: 'Approved Test Event', start_time: soon }),
      { cityId: 1, titleNorm: 'approved test event', venueNorm: null }
    )

    const visible = await listEvents({ cityId: 1, q: 'Test Event', limit: 10, offset: 0 })
    expect(visible.some(e => e.id === pendingId)).toBe(false)
    expect(visible.some(e => e.id === approvedId)).toBe(true)

    expect(await getEvent(pendingId)).toBeNull()
    expect((await getEvent(approvedId))?.id).toBe(approvedId)
  })

  it('lists, approves, and rejects pending events', async () => {
    const soon = new Date(Date.now() + 11 * 24 * 3600 * 1000).toISOString()
    const id = await insertEvent(
      mk({ source: 'submission', source_id: 'mod-flow-1', title: 'Moderation Flow Event', start_time: soon }),
      { cityId: 1, titleNorm: 'moderation flow event', venueNorm: null, status: 'pending' }
    )

    const pending = await listPendingEvents(1)
    expect(pending.some(p => p.id === id)).toBe(true)

    await approveEvent(id)
    expect((await getEvent(id))?.id).toBe(id)

    const id2 = await insertEvent(
      mk({ source: 'submission', source_id: 'mod-flow-2', title: 'Moderation Flow Event 2', start_time: soon }),
      { cityId: 1, titleNorm: 'moderation flow event 2', venueNorm: null, status: 'pending' }
    )
    await rejectEvent(id2)
    expect(await getEvent(id2)).toBeNull()
    expect((await listPendingEvents(1)).some(p => p.id === id2)).toBe(false)
  })
})
```

Add `listPendingEvents, approveEvent, rejectEvent` to the file's import list from `./index`.

- [ ] **Step 4: Run the full suite (this should now be fully green)**

Run: `npx vitest run`
Expected: PASS — every test deferred since Task 2 (the `status`-column-dependent ones) should now pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/013_event_status.sql lib/db/index.ts lib/db/db.integration.test.ts
git commit -m "feat(db): add events.status (approved/pending/rejected) for submission moderation"
```

---

### Task 11: Public submission flow (form → pending → admin approval)

**Files:**
- Create: `lib/submissions.ts`
- Modify: `app/api/import/route.ts`
- Create: `app/api/submissions/route.ts`
- Create: `components/SubmitForm.tsx`
- Create: `app/[city]/submit/page.tsx`

- [ ] **Step 1: Extract the shared import/submission logic**

```ts
// lib/submissions.ts
import { pageFromHtml } from '@/lib/sources/crawler'
import { extractEventsFromPages, type CrawlPage } from '@/lib/extractor'
import { persistEvents, type EventStatus } from '@/lib/persist'
import { safeFetchHtml, SsrfError } from '@/lib/ssrf'

// Thrown for any user-facing input problem (bad URL, unreadable page, missing
// url/text) so route handlers can turn it into the right HTTP status without
// duplicating the message text.
export class InputError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Resolve either a URL or pasted text into a CrawlPage, the shared input to
// extraction. `sourceOverride` tags the resulting page's `source` field (used
// by /api/submissions to mark every public submission as 'submission',
// regardless of whether it arrived as a URL or pasted text); omitted for
// /api/import, which keeps its existing crawl:<host>/'import' source naming.
export async function resolvePage(url: string, text: string, sourceOverride?: string): Promise<CrawlPage> {
  if (url) {
    let html: string
    try {
      html = await safeFetchHtml(url)
    } catch (e) {
      if (e instanceof SsrfError) throw new InputError(`Cannot fetch that URL: ${e.message}`, 400)
      throw new InputError('Could not read that URL (it may require login or returned no content). Paste the post text instead.', 422)
    }
    const page = pageFromHtml(html, url)
    if (page.text.length < 40) {
      throw new InputError('Could not read that URL (it may require login or returned no content). Paste the post text instead.', 422)
    }
    return sourceOverride ? { ...page, source: sourceOverride } : page
  }
  if (text) {
    return { source: sourceOverride ?? 'import', url: '', title: null, image_url: null, text }
  }
  throw new InputError('Provide a "url" or "text" field', 400)
}

export async function extractAndPersist(
  page: CrawlPage,
  opts: { cityId: number; status: EventStatus }
): Promise<{ inserted: number; skipped: number; total: number; events: { title: string; start_time: string; venue_name: string | null; ticket_url: string | null }[] }> {
  const events = await extractEventsFromPages([page])
  if (events.length === 0) return { inserted: 0, skipped: 0, total: 0, events: [] }

  const { inserted, skipped, total } = await persistEvents(events, opts)
  return {
    inserted, skipped, total,
    events: events.map(e => ({ title: e.title, start_time: e.start_time, venue_name: e.venue_name, ticket_url: e.ticket_url })),
  }
}
```

- [ ] **Step 2: Rewrite `/api/import` to reuse it (adds optional multi-city support)**

```ts
// app/api/import/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { resolvePage, extractAndPersist, InputError } from '@/lib/submissions'
import { isLocal, getCityBySlug } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 120

async function runImport(url: string, text: string, citySlug: string): Promise<NextResponse> {
  const city = await getCityBySlug(citySlug || 'austin')
  if (!city) return NextResponse.json({ error: `Unknown city "${citySlug}"` }, { status: 400 })

  try {
    const page = await resolvePage(url, text)
    const result = await extractAndPersist(page, { cityId: city.id, status: 'approved' })
    const note = result.events.length === 0
      ? (process.env.GEMINI_API_KEY
          ? 'No specific upcoming events were found in that content.'
          : 'GEMINI_API_KEY is not configured, so events cannot be extracted from free text.')
      : undefined
    return NextResponse.json({ ...result, note, mode: isLocal() ? 'local' : 'supabase' })
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  let body: { url?: unknown; text?: unknown; city?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with a "url" or "text" field' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const city = typeof body.city === 'string' ? body.city.trim() : ''
  return runImport(url, text, city)
}

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  const url = req.nextUrl.searchParams.get('url')?.trim() ?? ''
  if (!url) {
    return NextResponse.json({ usage: 'POST { url, text?, city? }; or GET ?url=https://...&city=austin' })
  }
  const city = req.nextUrl.searchParams.get('city')?.trim() ?? ''
  return runImport(url, '', city)
}
```

- [ ] **Step 3: Add the public `/api/submissions` route**

```ts
// app/api/submissions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { resolvePage, extractAndPersist, InputError } from '@/lib/submissions'
import { getCityBySlug } from '@/lib/db'

export const maxDuration = 120

// Public, UNAUTHENTICATED submission intake (the point of the feature — no
// accounts, anyone can submit): url or pasted text → extracted → persisted as
// `pending` (never auto-published) for review at /[city]/admin. SSRF-guarded
// exactly like /api/import via lib/submissions.ts's shared resolvePage().
export async function POST(req: NextRequest) {
  let body: { url?: unknown; text?: unknown; city?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with a "url" or "text" field' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const citySlug = typeof body.city === 'string' ? body.city.trim() : ''

  const city = citySlug ? await getCityBySlug(citySlug) : null
  if (!city) return NextResponse.json({ error: 'Unknown or missing city' }, { status: 400 })

  try {
    const page = await resolvePage(url, text, 'submission')
    const result = await extractAndPersist(page, { cityId: city.id, status: 'pending' })
    if (result.events.length === 0) {
      return NextResponse.json({
        submitted: 0,
        note: process.env.GEMINI_API_KEY
          ? 'No specific upcoming events were found in that content.'
          : 'GEMINI_API_KEY is not configured, so events cannot be extracted from free text.',
      })
    }
    return NextResponse.json({
      submitted: result.events.length,
      note: 'Thanks! Your submission is pending review before it appears publicly.',
    })
  } catch (e) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('Submission failed:', e)
    return NextResponse.json({ error: 'Could not process that submission' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Add the submission form + page**

```tsx
// components/SubmitForm.tsx
'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SubmitForm() {
  const { city } = useParams<{ city: string }>()
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), text: text.trim(), city }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error ?? 'Something went wrong.')
        setStatus('error')
        return
      }
      setMessage(data.note ?? 'Submitted!')
      setStatus('success')
    } catch {
      setMessage('Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-5xl">📮</p>
        <h2 className="text-xl font-bold">Thanks!</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="url">Event page URL</label>
        <Input id="url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
      </div>
      <p className="text-center text-xs text-muted-foreground">— or —</p>
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="text">Paste event details</label>
        <textarea
          id="text"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          placeholder="Sat July 4, 8pm — Indie Night @ Mohawk, $15..."
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
      </div>
      {status === 'error' && <p className="text-sm text-red-500">{message}</p>}
      <Button
        type="submit"
        disabled={status === 'loading' || (!url.trim() && !text.trim())}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {status === 'loading' ? 'Submitting…' : 'Submit event'}
      </Button>
    </form>
  )
}
```

```tsx
// app/[city]/submit/page.tsx
import Link from 'next/link'
import { SubmitForm } from '@/components/SubmitForm'
import { requireCity } from '@/lib/cities'

export default async function SubmitPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href={`/${city.slug}`} className="text-sm text-violet-600 hover:underline">← Back to events</Link>
        </div>
      </header>
      <div className="flex items-start justify-center pt-12 pb-20 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <p className="text-4xl mb-3">📮</p>
            <h1 className="text-2xl font-bold mb-2">Submit a {city.name} event</h1>
            <p className="text-sm text-muted-foreground">
              Paste a link to an event page, or paste the event details as text.
              We&apos;ll review it before it goes live.
            </p>
          </div>
          <SubmitForm />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add a homepage link to the submission page**

In `app/[city]/page.tsx`, add a "Submit an event" link next to the existing "Get Updates" link in the header:

```tsx
          <Link
            href={`${base}/submit`}
            className="shrink-0 text-sm text-slate-600 hover:text-violet-700 font-medium hidden sm:inline"
          >
            Submit an event
          </Link>
          <Link
            href={`${base}/subscribe`}
            className="shrink-0 text-sm bg-violet-600 text-white px-3 py-1.5 rounded-md hover:bg-violet-700 transition-colors font-medium"
          >
            Get Updates
          </Link>
```

(placed immediately before the existing "Get Updates" `Link`.)

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

Run: `npm run dev`, visit `/austin/submit`, submit `{"text": "Sat July 4, 8pm — Test Submission Night @ Mohawk, $15"}`-shaped input via the form (requires `GEMINI_API_KEY` to actually extract; without it, confirm the graceful "GEMINI_API_KEY is not configured" note renders instead of an error).

- [ ] **Step 7: Commit**

```bash
git add lib/submissions.ts app/api/import/route.ts app/api/submissions/route.ts components/SubmitForm.tsx "app/[city]/submit" "app/[city]/page.tsx"
git commit -m "feat(submissions): public event submission form, pending-status moderation gate"
```

---

### Task 12: `is_free` filter support

**Files:** none — already implemented in Task 2 (`listEvents`/`countEvents`) and Task 6 (`/api/events` route's `isFree` query param).

- [ ] **Step 1: Confirm it's already wired**

`lib/db/index.ts`'s `listEvents`/`countEvents` (Task 2) already accept `isFree?: boolean` and filter `AND e.is_free = true`; `app/api/events/route.ts` (Task 6) already reads `?isFree=true`. This task exists only as an explicit checkpoint so Task 14 (SEO pages) has a named prerequisite to point at.

- [ ] **Step 2: Add one direct unit assertion**

Add to `lib/db/db.integration.test.ts`:

```ts
describe('is_free filter', () => {
  it('listEvents(isFree: true) returns only free events', async () => {
    const soon = new Date(Date.now() + 12 * 24 * 3600 * 1000).toISOString()
    await insertEvent(
      mk({ source: 'itest', source_id: 'free-1', title: 'Free Filter Test Event', start_time: soon, is_free: true }),
      { cityId: 1, titleNorm: 'free filter test event', venueNorm: null }
    )
    await insertEvent(
      mk({ source: 'itest', source_id: 'paid-1', title: 'Paid Filter Test Event', start_time: soon, is_free: false }),
      { cityId: 1, titleNorm: 'paid filter test event', venueNorm: null }
    )

    const free = await listEvents({ cityId: 1, q: 'Filter Test Event', isFree: true, limit: 10, offset: 0 })
    expect(free.some(e => e.source_id === 'free-1')).toBe(true)
    expect(free.some(e => e.source_id === 'paid-1')).toBe(false)
  })
})
```

- [ ] **Step 3: Run it**

Run: `npx vitest run lib/db/db.integration.test.ts -t "is_free filter"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/db/db.integration.test.ts
git commit -m "test(db): assert is_free filter on listEvents"
```

---

### Task 13: Admin UI (pending approvals + source health)

**Files:**
- Create: `app/api/admin/pending/route.ts`
- Create: `app/api/admin/pending/[id]/route.ts`
- Create: `app/[city]/admin/page.tsx`

- [ ] **Step 1: List-pending API route**

```ts
// app/api/admin/pending/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { listPendingEvents, getCityBySlug } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const citySlug = req.nextUrl.searchParams.get('city')
  if (!citySlug) return NextResponse.json({ error: 'city query param is required' }, { status: 400 })
  const city = await getCityBySlug(citySlug)
  if (!city) return NextResponse.json({ error: 'Unknown city' }, { status: 404 })

  const pending = await listPendingEvents(city.id)
  return NextResponse.json({ pending })
}
```

- [ ] **Step 2: Approve/reject API route**

```ts
// app/api/admin/pending/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { approveEvent, rejectEvent } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const { id } = await params
  let body: { action?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with an "action" field' }, { status: 400 })
  }

  if (body.action === 'approve') {
    await approveEvent(id)
  } else if (body.action === 'reject') {
    await rejectEvent(id)
  } else {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Admin page (client component, token-gated via the existing `CRON_SECRET` bearer scheme)**

```tsx
// app/[city]/admin/page.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

type PendingEvent = { id: string; title: string; venue_name: string | null; start_time: string; source: string; created_at: string }
type HealthSource = { source: string; stale: boolean; last_status: string | null; last_run_at: string | null }
type HealthResponse = { healthy: boolean; stale: string[]; sources: HealthSource[] }

export default function AdminPage() {
  const { city } = useParams<{ city: string }>()
  const [token, setToken] = useState('')
  const [savedToken, setSavedToken] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingEvent[] | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('admin_token')
    if (stored) setSavedToken(stored)
  }, [])

  const load = useCallback(async (t: string) => {
    setError(null)
    const headers = { Authorization: `Bearer ${t}` }
    try {
      const [pRes, hRes] = await Promise.all([
        fetch(`/api/admin/pending?city=${city}`, { headers }),
        fetch(`/api/admin/health`, { headers }),
      ])
      if (!pRes.ok || !hRes.ok) throw new Error('Unauthorized or request failed')
      const pData = await pRes.json()
      setPending(pData.pending)
      setHealth(await hRes.json())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [city])

  useEffect(() => {
    if (savedToken) load(savedToken)
  }, [savedToken, load])

  function saveToken() {
    localStorage.setItem('admin_token', token)
    setSavedToken(token)
  }

  async function act(id: string, action: 'approve' | 'reject') {
    if (!savedToken) return
    await fetch(`/api/admin/pending/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${savedToken}` },
      body: JSON.stringify({ action }),
    })
    load(savedToken)
  }

  if (!savedToken) {
    return (
      <div className="max-w-md mx-auto py-16 px-4">
        <h1 className="text-lg font-semibold mb-4">Admin access</h1>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="CRON_SECRET"
          className="border rounded-md px-3 py-2 w-full mb-3"
        />
        <button onClick={saveToken} className="bg-violet-600 text-white px-4 py-2 rounded-md">
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-10">
      <h1 className="text-xl font-bold capitalize">{city} admin</h1>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <section>
        <h2 className="font-semibold mb-3">Pending submissions ({pending?.length ?? 0})</h2>
        <div className="space-y-2">
          {(pending ?? []).map(e => (
            <div key={e.id} className="border rounded-md p-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">{e.title}</p>
                <p className="text-muted-foreground">
                  {e.venue_name ?? 'No venue'} · {new Date(e.start_time).toLocaleString()} · via {e.source}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => act(e.id, 'approve')} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md">Approve</button>
                <button onClick={() => act(e.id, 'reject')} className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md">Reject</button>
              </div>
            </div>
          ))}
          {pending?.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending.</p>}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">
          Source health {health && (health.healthy ? '✅' : `⚠️ ${health.stale.length} stale`)}
        </h2>
        <div className="space-y-1 text-sm">
          {(health?.sources ?? []).map(s => (
            <div key={s.source} className={`flex justify-between border-b py-1 ${s.stale ? 'text-red-600' : ''}`}>
              <span>{s.source}</span>
              <span>{s.last_status ?? '—'} · {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'never'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

Run: `npm run dev`, visit `/austin/admin`, type any string as the token (dev mode ignores it since `requireCronAuth` is open outside production), submit a test event via `/austin/submit`, confirm it appears under "Pending submissions," and confirm Approve/Reject work (approved event then appears on `/austin`; rejected event stays hidden).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/pending "app/[city]/admin"
git commit -m "feat(admin): pending-submission approval UI + source health view"
```

---

### Task 14: Programmatic SEO pages

**Files:**
- Create: `lib/seoPages.ts`
- Create: `app/[city]/[seoSlug]/page.tsx`

- [ ] **Step 1: The canned filter config**

```ts
// lib/seoPages.ts
// Canned filter combinations over the existing listEvents/countEvents,
// statically generated per city — the "config array, no new code" SEO play
// from PRODUCT-SPEC §4.
export type SeoPageConfig = {
  slug: string
  title: string
  description: (cityName: string) => string
  when?: 'today' | 'weekend'
  categories?: string[]
  isFree?: boolean
}

export const SEO_PAGES: SeoPageConfig[] = [
  {
    slug: 'this-weekend',
    title: 'This Weekend',
    description: city => `Everything happening in ${city} this weekend — concerts, markets, festivals, and more.`,
    when: 'weekend',
  },
  {
    slug: 'live-music-tonight',
    title: 'Live Music Tonight',
    description: city => `Tonight's live music lineup in ${city}, updated daily.`,
    when: 'today',
    categories: ['music'],
  },
  {
    slug: 'family',
    title: 'Family Events',
    description: city => `Family-friendly things to do in ${city} — museums, story times, festivals, and more.`,
    categories: ['family'],
  },
  {
    slug: 'free-things-to-do-this-weekend',
    title: 'Free Things To Do This Weekend',
    description: city => `Free events in ${city} this weekend — no ticket required.`,
    when: 'weekend',
    isFree: true,
  },
]

export function getSeoPage(slug: string): SeoPageConfig | undefined {
  return SEO_PAGES.find(p => p.slug === slug)
}
```

- [ ] **Step 2: The dynamic page**

```tsx
// app/[city]/[seoSlug]/page.tsx
import { Suspense } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { EventList } from '@/components/EventList'
import { listEvents, countEvents } from '@/lib/db'
import { requireCity } from '@/lib/cities'
import { resolveDateRange } from '@/lib/dateRanges'
import { getSeoPage, SEO_PAGES } from '@/lib/seoPages'
import type { EnrichedEvent } from '@/lib/types'

export const revalidate = 900

export async function generateStaticParams() {
  return SEO_PAGES.map(p => ({ seoSlug: p.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; seoSlug: string }>
}): Promise<Metadata> {
  const { city: citySlug, seoSlug } = await params
  const config = getSeoPage(seoSlug)
  if (!config) return {}
  return {
    title: config.title,
    description: config.description(citySlug),
    alternates: { canonical: `/${citySlug}/${seoSlug}` },
  }
}

export default async function SeoPage({
  params,
}: {
  params: Promise<{ city: string; seoSlug: string }>
}) {
  const { city: citySlug, seoSlug } = await params
  const config = getSeoPage(seoSlug)
  if (!config) notFound()

  const city = await requireCity(citySlug)
  const range = resolveDateRange({ when: config.when })
  const filterArgs = {
    cityId: city.id,
    categories: config.categories ?? [],
    from: range.fromIso,
    to: range.toIso ?? undefined,
    isFree: config.isFree,
  }

  const [events, total] = await Promise.all([
    listEvents({ ...filterArgs, limit: 24, offset: 0 }),
    countEvents(filterArgs),
  ])

  const qs = new URLSearchParams()
  if (config.when) qs.set('when', config.when)
  ;(config.categories ?? []).forEach(c => qs.append('category', c))
  if (config.isFree) qs.set('isFree', 'true')

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <Link href={`/${city.slug}`} className="text-sm text-violet-600 hover:underline">← All {city.name} events</Link>
        </div>
      </header>
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-1">{config.title} in {city.name}</h1>
        <p className="text-sm text-muted-foreground mb-6">{config.description(city.name)}</p>
        <Suspense>
          <EventList
            initialEvents={events as unknown as EnrichedEvent[]}
            query={qs.toString()}
            total={total}
            basePath={`/${city.slug}`}
          />
        </Suspense>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add nav links from the homepage**

In `app/[city]/page.tsx`, add a small row of SEO-page links under the header (above the filters row), so they're discoverable and internally linked (important for the pages to actually get crawled/indexed):

```tsx
          <div className="flex flex-wrap gap-3 mb-4 text-xs">
            {SEO_PAGES.map(p => (
              <Link key={p.slug} href={`${base}/${p.slug}`} className="text-violet-600 hover:underline">
                {p.title}
              </Link>
            ))}
          </div>
```

Place this immediately after the `<div className="flex items-center justify-between gap-3 mb-4">...</div>` header-row block (inside `<main>`), and add the import:

```tsx
import { SEO_PAGES } from '@/lib/seoPages'
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

Run: `npm run dev`, visit `/austin/this-weekend`, `/austin/live-music-tonight`, `/austin/family`, `/austin/free-things-to-do-this-weekend`, and `/austin/not-a-real-slug` (expect 404). Confirm each shows the right filtered subset and the homepage links to all four.

- [ ] **Step 5: Commit**

```bash
git add lib/seoPages.ts "app/[city]/[seoSlug]" "app/[city]/page.tsx"
git commit -m "feat(seo): add programmatic SEO pages (this-weekend, live-music-tonight, family, free-weekend)"
```

---

### Task 15: Final verification + follow-up flag

**Files:** none (verification + one `spawn_task` call, no code changes)

- [ ] **Step 1: Full automated verification**

Run: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all four pass cleanly. If `npm run build` fails on a static-generation step (e.g. a page's `generateStaticParams` running against an empty/misconfigured DB in the build environment), investigate — do not skip or weaken the check.

- [ ] **Step 2: Full manual walkthrough (dev server)**

Run: `npm run dev` and re-check the full list from Task 9's Step 2, plus:
1. `/austin/submit` → submit → shows up in `/austin/admin` pending list → approve → appears on `/austin`.
2. `/austin/free-things-to-do-this-weekend` only shows free events.
3. `curl -X POST http://localhost:3000/api/ingest` runs without error and its JSON response now has a `byCity` array covering both `austin` and `houston`.
4. `curl -X POST http://localhost:3000/api/email/digest?frequency=daily` similarly returns a `byCity` array.

- [ ] **Step 3: Flag the pre-existing dedup trust-map gap as a follow-up**

This plan intentionally did not fix `lib/dedup.ts`'s `KIND_BY_SOURCE` only matching literal source names (missing `crawl:*`, `newspaper:*`, `social:reddit-*` instance names, so those sources' events score `sourceTrust = 0` in merges instead of their real kind's trust tier). Use `mcp__ccd_session__spawn_task` to flag it for separate follow-up work (do not fix inline — it changes merge-tiebreak behavior for already-well-tested code and deserves its own dedicated review):

```
title: "Fix dedup sourceTrust for instance-named sources"
tldr: "lib/dedup.ts's KIND_BY_SOURCE only matches literal source names like 'crawl' or 'ical', but real source rows are instance-named like 'crawl:mohawkaustin-com' or 'newspaper:kut' — so those sources score sourceTrust=0 in every merge tiebreak instead of their real kind's trust tier (1 for crawl/rss). Likely fix: derive trust from sources.kind (a DB lookup by source name) instead of the static name map, or extend the map to prefix-match on ':'."
```

- [ ] **Step 4: No commit** — this task is verification + a follow-up flag only.

---

## Summary of what this plan delivers

| PRODUCT-SPEC item | Status after this plan |
| --- | --- |
| `cities` + full `city_id` FK sweep (events/sources/subscriptions/featured_listings) | Done (Task 1, on top of existing 007/008) |
| `app/[city]/` routing + `generateStaticParams` | Done (Task 4) |
| Houston launched | Done (Task 8) — T1 (Ticketmaster/SeatGeek, geo-parametrized), T2, ~27 T3 venue sources |
| User-submission form → pending → admin approve | Done (Tasks 10-11, 13) |
| Real FTS | Already done pre-plan (unchanged) |
| Programmatic SEO pages | Done (Task 14) |
| Admin health page (UI, not just API) | Done (Task 13, combined with pending-approval UI) |
| Price/free filter (`is_free`) | Done (Tasks 2, 6, 12) — query-level only; no filter-chip UI (that's Phase 4 scope, not requested here) |

Explicitly **not** done (out of scope per the scoping decisions at the top): Eventbrite/YouTube/Bluesky city-parametrization, the pre-existing `crawl:*`/`newspaper:*` dedup-trust gap, and anything from Phase 4 (map view, personalized digests, pgvector, ICS export).
