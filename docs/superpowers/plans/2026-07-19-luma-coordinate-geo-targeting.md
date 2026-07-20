# Luma Coordinate Geo-Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Luma crawler return the configured city's events regardless of which server region the cron runs in, by pinning geo with explicit coordinates instead of relying on the caller's IP.

**Architecture:** Luma's `get-paginated-events` endpoint geo-locates by caller IP and ignores `place_api_id`, but honors explicit `latitude`/`longitude` query params (verified). We pass each city's stored `cities.lat/lng` through the crawl context into the Luma fetch, drop the now-redundant place-ID HTML resolution (and its IP-biased `slug` fallback), and harden the state backstop filter to catch full state names.

**Tech Stack:** TypeScript, Next.js (App Router), Vitest, Postgres (Supabase).

## Global Constraints

- Node `fetch` with `AbortSignal.timeout(20000)`, header `User-Agent: <UA const>`, `Accept`, `cache: 'no-store'` — match existing patterns in `lib/sources/luma.ts`.
- Geo params MUST use the full names `latitude`/`longitude`. Luma silently ignores the `lat`/`lng` short forms.
- Austin coords: `30.2672, -97.7431`. Houston coords: `29.7604, -95.3698` (already in `cities` table; do not hardcode — read from the city row).
- The `targetState` post-filter contract is unchanged: an address that resolves to no state returns `null` and the event is KEPT (ambiguous ⇒ don't guess).
- Run tests with `npx vitest run <file>`. Typecheck with `npx tsc --noEmit`.
- Read the relevant guide under `node_modules/next/dist/docs/` before touching any Next.js route code (per AGENTS.md).

---

### Task 1: Harden `stateFromAddress` for full state names

**Files:**
- Modify: `lib/sources/luma.ts` (the `stateFromAddress` function, currently ~lines 139-143)
- Test: `lib/sources/luma.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `stateFromAddress(address: string | null): string | null` — unchanged signature. New behavior: resolves spelled-out state names (e.g. `"Arlington, Virginia"` → `VA`) when no trailing two-letter code is present. Two-letter code still takes precedence.

- [ ] **Step 1: Write the failing tests**

Add to `lib/sources/luma.test.ts`. First extend the import on line 2 to include `stateFromAddress`:

```ts
import { eventsFromEntries, slugFromUrl, placeApiIdFromNextData, stateFromAddress } from './luma'
```

Then add this describe block (place it above the `eventsFromEntries` block):

```ts
describe('stateFromAddress', () => {
  it('resolves a trailing two-letter code', () => {
    expect(stateFromAddress('701 Brazos St, Austin, TX 78701, USA')).toBe('TX')
  })

  it('resolves Washington, DC via the two-letter code', () => {
    expect(stateFromAddress('Pubkey, 410 7th St NW, Washington, DC 20004, USA')).toBe('DC')
  })

  it('resolves a spelled-out state name', () => {
    expect(stateFromAddress('Arlington, Virginia')).toBe('VA')
    expect(stateFromAddress('Laurel, Maryland')).toBe('MD')
  })

  it('resolves a spelled-out state name with a trailing zip and country', () => {
    expect(stateFromAddress('123 Main St, Fairfax, Virginia 22033, USA')).toBe('VA')
  })

  it('prefers a two-letter code over a spelled-out name when both are present', () => {
    // A city literally named after a state should not shadow the real code.
    expect(stateFromAddress('Austin, TX')).toBe('TX')
  })

  it('returns null for an address with no resolvable state', () => {
    expect(stateFromAddress('Online')).toBeNull()
    expect(stateFromAddress(null)).toBeNull()
    expect(stateFromAddress('Somewhere unlabeled')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/sources/luma.test.ts -t stateFromAddress`
Expected: FAIL — the "spelled-out state name" cases return `null` (current regex only matches two-letter codes).

- [ ] **Step 3: Implement the hardened function**

Replace the existing `stateFromAddress` (keep the doc comment above it, and update it to mention the full-name fallback) in `lib/sources/luma.ts` with:

```ts
// Full state-name → USPS code, for addresses Luma writes with the state
// spelled out (e.g. "Arlington, Virginia"). "washington dc" maps to DC;
// bare "washington" is the state (WA). Used only as a fallback when no
// trailing two-letter code is present.
const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC',
}

export function stateFromAddress(address: string | null): string | null {
  if (!address) return null
  // Prefer an explicit trailing two-letter code ("…, TX", "…, DC", "…, VA").
  const code = address.match(/,\s*([A-Za-z]{2})\b/)
  if (code) return code[1].toUpperCase()
  // Fall back to a spelled-out state name in any comma-delimited segment,
  // stripping periods, digits (zip), and a trailing country so
  // "…, Virginia 22201, USA" still resolves.
  for (const seg of address.split(',')) {
    const norm = seg
      .toLowerCase()
      .replace(/\b(usa|united states)\b/g, '')
      .replace(/[.\d]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (STATE_NAMES[norm]) return STATE_NAMES[norm]
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/sources/luma.test.ts -t stateFromAddress`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sources/luma.ts lib/sources/luma.test.ts
git commit -m "feat(luma): resolve spelled-out state names in stateFromAddress

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Coordinate-driven Luma fetch (drop place-ID resolution)

**Files:**
- Modify: `lib/sources/luma.ts` (module doc comment; `fetchPage`; `fetchLumaEvents`; delete `resolvePlaceApiId`, `placeApiIdFromNextData`, `slugFromUrl`)
- Test: `lib/sources/luma.test.ts`

**Interfaces:**
- Consumes: `eventsFromEntries(entries, source, targetState?)`, `MAX_PAGES`, `UA` (existing in module).
- Produces:
  - `buildPageUrl(lat: number, lng: number, cursor: string | null): string` — pure URL builder.
  - `type LumaFetchOptions = { targetState?: string; lat: number | null; lng: number | null }`
  - `fetchLumaEvents(url: string, source: string, opts: LumaFetchOptions): Promise<RawEvent[]>` — new third arg is an options object (was a bare `targetState?: string`). Returns `[]` (and logs) when `lat`/`lng` are null.

- [ ] **Step 1: Write the failing test for `buildPageUrl`**

In `lib/sources/luma.test.ts`, update the import on line 2 to drop the deleted functions and add `buildPageUrl`:

```ts
import { eventsFromEntries, stateFromAddress, buildPageUrl } from './luma'
```

Delete the entire `describe('slugFromUrl', …)` block and the entire `describe('placeApiIdFromNextData', …)` block (their functions are being removed). Add this block:

```ts
describe('buildPageUrl', () => {
  it('pins geo with full-name latitude/longitude params', () => {
    const u = new URL(buildPageUrl(30.2672, -97.7431, null))
    expect(u.origin + u.pathname).toBe('https://api.lu.ma/discover/get-paginated-events')
    expect(u.searchParams.get('latitude')).toBe('30.2672')
    expect(u.searchParams.get('longitude')).toBe('-97.7431')
    // Short forms are ignored by Luma, so we must not emit them.
    expect(u.searchParams.get('lat')).toBeNull()
    expect(u.searchParams.get('lng')).toBeNull()
  })

  it('omits the cursor on the first page and includes it on later pages', () => {
    expect(new URL(buildPageUrl(30.2672, -97.7431, null)).searchParams.get('pagination_cursor')).toBeNull()
    expect(new URL(buildPageUrl(30.2672, -97.7431, 'CUR123')).searchParams.get('pagination_cursor')).toBe('CUR123')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/sources/luma.test.ts -t buildPageUrl`
Expected: FAIL — `buildPageUrl` is not exported yet (import error / not a function).

- [ ] **Step 3: Implement `buildPageUrl`, rewrite `fetchPage`/`fetchLumaEvents`, delete dead functions**

In `lib/sources/luma.ts`:

(a) Add the pure builder (place it just above `fetchPage`):

```ts
// Pure builder for the paginated-events request URL, so param construction is
// unit-testable without network. Geo is pinned by latitude/longitude (full
// names only — Luma silently ignores the `lat`/`lng` short forms and otherwise
// geo-locates by the caller's IP).
export function buildPageUrl(lat: number, lng: number, cursor: string | null): string {
  const u = new URL('https://api.lu.ma/discover/get-paginated-events')
  u.searchParams.set('latitude', String(lat))
  u.searchParams.set('longitude', String(lng))
  if (cursor) u.searchParams.set('pagination_cursor', cursor)
  return u.toString()
}
```

(b) Replace `fetchPage` with a coordinate-based version:

```ts
async function fetchPage(lat: number, lng: number, cursor: string | null): Promise<LumaPage | null> {
  try {
    const res = await fetch(buildPageUrl(lat, lng, cursor), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as LumaPage
  } catch (e) {
    console.error(`Luma fetch failed for ${lat},${lng}:`, e)
    return null
  }
}
```

(c) Replace `fetchLumaEvents` (and export the options type):

```ts
export type LumaFetchOptions = { targetState?: string; lat: number | null; lng: number | null }

export async function fetchLumaEvents(url: string, source: string, opts: LumaFetchOptions): Promise<RawEvent[]> {
  const { targetState, lat, lng } = opts
  if (lat == null || lng == null) {
    // Fail closed: a coordinate-less crawl would fall back to IP geo — exactly
    // the DC-region leak this replaces. `url` is only the human discover page.
    console.error(`Luma ${source}: missing city coordinates (${url}); skipping`)
    return []
  }

  const merged: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(lat, lng, cursor)
    if (!data) break
    if (Array.isArray(data.entries)) merged.push(...data.entries)
    if (!data.has_more || typeof data.next_cursor !== 'string') break
    cursor = data.next_cursor
  }

  return eventsFromEntries(merged, source, targetState)
}
```

(d) Delete the now-unused functions and their doc comments: `resolvePlaceApiId`, `placeApiIdFromNextData`, and `slugFromUrl`.

(e) Update the module-level doc comment at the top of the file so it describes coordinate-based geo (latitude/longitude override the caller IP) instead of place-ID resolution and the slug fallback. Keep the note that `description` is always null.

- [ ] **Step 4: Run the Luma test file to verify it passes**

Run: `npx vitest run lib/sources/luma.test.ts`
Expected: PASS — `buildPageUrl`, `stateFromAddress`, and all existing `eventsFromEntries`/`targetState` tests green; no references to the deleted functions remain.

- [ ] **Step 5: Typecheck to confirm no dangling references**

Run: `npx tsc --noEmit`
Expected: FAIL with exactly one error in `lib/sources/registry.ts` — the `fetchLumaEvents` call still passes `ctx.city.state` (a string) where `LumaFetchOptions` is now required. (Fixed in Task 3.) No errors in `lib/sources/luma.ts` or `lib/sources/luma.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/sources/luma.ts lib/sources/luma.test.ts
git commit -m "feat(luma): pin geo with latitude/longitude, drop place-id resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Thread city coordinates through the crawl context

**Files:**
- Modify: `lib/sources/types.ts` (the `SourceContext.city` shape, ~line 28)
- Modify: `app/api/ingest/route.ts` (`contextFor`, ~line 11-14)
- Modify: `lib/sources/registry.ts` (the `luma` entry, ~line 88)

**Interfaces:**
- Consumes: `fetchLumaEvents(url, source, { targetState, lat, lng })` and `LumaFetchOptions` from Task 2; `City` (`lib/db/index.ts`) which already has `lat: number | null` and `lng: number | null`.
- Produces: `SourceContext.city` now includes `lat: number | null` and `lng: number | null`, available to every source parser.

- [ ] **Step 1: Extend the `SourceContext.city` type**

In `lib/sources/types.ts`, change the `city` field of `SourceContext` from:

```ts
  city: { id: number; slug: string; name: string; state: string }
```

to:

```ts
  city: { id: number; slug: string; name: string; state: string; lat: number | null; lng: number | null }
```

- [ ] **Step 2: Populate coordinates in `contextFor`**

In `app/api/ingest/route.ts`, update the `city` object built in `contextFor` (currently `city: { id: city.id, slug: city.slug, name: city.name, state: city.state }`) to:

```ts
    city: { id: city.id, slug: city.slug, name: city.name, state: city.state, lat: city.lat, lng: city.lng },
```

- [ ] **Step 3: Pass coordinates + state to the Luma parser**

In `lib/sources/registry.ts`, replace the `luma` entry (line ~88):

```ts
  luma: simple(() => true, (url, name, ctx) => fetchLumaEvents(url!, name, ctx.city.state)),
```

with:

```ts
  luma: simple(() => true, (url, name, ctx) =>
    fetchLumaEvents(url!, name, { targetState: ctx.city.state, lat: ctx.city.lat, lng: ctx.city.lng })),
```

Update the adjacent explanatory comment (lines ~80-87) so it reflects coordinate-based targeting: Luma geo-locates by caller IP, so the city's stored coordinates are passed as `latitude`/`longitude` to pin results to the city, and `state` is still passed as a backstop filter.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no errors. (The `SourceContext.city` type now requires `lat`/`lng`; `contextFor` supplies them from the `City` row, and the registry forwards them.)

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all files green, including `lib/sources/luma.test.ts` and the `lib/db` integration tests.

- [ ] **Step 6: Commit**

```bash
git add lib/sources/types.ts app/api/ingest/route.ts lib/sources/registry.ts
git commit -m "feat(luma): pass city coordinates through crawl context to Luma parser

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation verification (production)

Local runs cannot prove the fix — this machine's IP is already Austin, so the Luma feed returns Austin events with or without the change. The controlled experiments in the spec (DC-coords and NYC-coords from an Austin IP returning DC/NYC metros) already prove the parameter overrides IP. To confirm end-to-end in production after deploy:

1. Trigger ingest: `GET /api/ingest?city=austin` (the cron path).
2. Run `DATABASE_URL=… npx tsx scripts/audit-city-mismatch.ts austin` — expect 0 state mismatches among new `crawl:luma-com` rows.
3. Check the source run: `crawl:luma-com` `events_found` should jump from ~2 to ~100+.

## Self-review notes

- **Spec coverage:** coordinate params (Task 2 + 3), drop place-ID fetch/slug fallback (Task 2d), harden `stateFromAddress` (Task 1), wiring through `SourceContext`/`contextFor`/registry (Task 3), fail-closed on null coords (Task 2c), `targetState` backstop retained (Task 2c uses `eventsFromEntries` unchanged). All covered.
- **Type consistency:** `LumaFetchOptions` defined in Task 2, consumed in Task 3; `buildPageUrl` signature identical across Task 2 steps; `SourceContext.city` fields match what `contextFor` supplies and the registry reads.
- **Deleted-symbol safety:** `slugFromUrl` / `placeApiIdFromNextData` are imported only by `lib/sources/luma.test.ts` (updated in Task 2); `stateFromAddress` remains exported for `scripts/audit-city-mismatch.ts` and `scripts/delete-city-mismatch.ts`.
