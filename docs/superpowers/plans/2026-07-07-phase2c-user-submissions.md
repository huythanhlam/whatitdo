# Phase 2C — User Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone submit an event by URL or pasted text through a public form; the submission runs the existing extraction pipeline and lands the events with `status = 'pending'` (invisible to the public site) until an admin approves them — turning the long tail even the crawler misses into a config-free contribution path, and organizers into stakeholders (PRODUCT-SPEC §4.5).

**Architecture:** A migration adds `events.status` (`pending | approved | rejected`, default `approved` so all ingested/seed events stay visible) and the public read functions filter to `approved`. `persistEvents` gains a `{ status }` option threaded only to newly-created canonical events — a submission that dedups into an existing event just adds provenance and never downgrades it. A public `POST /api/submit` (unauthenticated; guarded by the existing SSRF check, the global Gemini budget, input caps, and a honeypot) reuses the import extraction and persists as `pending`. Moderation is API-only for v1 (bearer `CRON_SECRET`, mirroring `/api/admin/health`): `GET /api/admin/submissions` lists pending events, `POST` approves/rejects. A public `/submit` page + client form complete the loop.

**Tech Stack:** PostgreSQL / PGlite, TypeScript, Next.js App Router (RSC + client form), Vitest.

---

## Phase 2 decomposition (context)

Per PRODUCT-SPEC §7 and the Phase 2A plan, Phase 2 splits into 2A (dedup, merged), 2B (config-driven sources, PR #16), **2C (this plan — user submissions)**, and 2D (programmatic SEO pages). This plan builds on 2B's migrations (008–010), so its migration is **011**.

**Deferred within 2C (noted, not built):** T4 source-discovery logging (auto-suggesting a `sources` row when an approved submission references a new domain — PRODUCT-SPEC §1.2) is a fast-follow; it needs a `suggested_sources` surface that isn't worth coupling to the core submit→approve loop. A browser-authenticated admin UI is also deferred (accounts are post-v1, PRODUCT-SPEC §5); moderation is API-only.

---

## Design decisions locked in

1. **`events.status` defaults to `approved`.** Every existing row, every ingest insert, and the PGlite baseline seed stay visible with zero code changes. Only the public submit path passes `pending`.
2. **Public reads filter `approved`.** `listEvents`, `countEvents`, `getEventsBetween`, and `getEvent` add `status = 'approved'` so pending submissions never appear on the site, in search, in the calendar, in digests, in the sitemap, or on a detail page. Admin reads use dedicated functions.
3. **Status is set only on newly-created events.** `persistEvents({ status })` threads to `insertEvent` for the 3b "no match → new canonical event" branch only. A submission that matches an existing (approved) event adds an `event_sources` provenance row and merges richer fields, but never changes the canonical event's status. (Upgrading a matched pending event when a trusted source later confirms it is a deliberate fast-follow, not v1.)
4. **The public endpoint is unauthenticated but bounded.** `/api/submit` reuses `safeFetchHtml` (SSRF guards) for URLs, caps pasted-text length, drops requests whose honeypot field is filled, and inherits the global Gemini daily-budget cap. Heavy-duty rate limiting (Vercel BotID / WAF) is the production hardening layer, noted but out of scope.
5. **Submitted events carry `source = 'submission'`** so provenance distinguishes them from the auth'd `import` path and from crawler output. `source` has no `sources` row, so `event_sources.source_id` stays NULL (nullable FK from 2B).

---

## File Structure

- `supabase/migrations/011_event_status.sql` — **create.** Add `events.status` + CHECK + index; existing rows default to `approved`.
- `lib/db/index.ts` — **modify.** Add `status = 'approved'` to the four public read queries; add optional `status` to `insertEvent`; add `listPendingEvents` + `setEventStatus`.
- `lib/persist.ts` — **modify.** `persistEvents` accepts `{ status }`; thread to `persistOne` → `insertEvent` for new events only.
- `lib/db/db.integration.test.ts` — **modify.** Tests: pending events hidden from public reads, surfaced by `listPendingEvents`, `setEventStatus` flips visibility.
- `app/api/submit/route.ts` — **create.** Public submission endpoint.
- `app/api/admin/submissions/route.ts` — **create.** Admin list + approve/reject (bearer auth).
- `components/SubmitForm.tsx` — **create.** Client form (URL or pasted text, honeypot, success/error states).
- `app/submit/page.tsx` — **create.** Public page wrapping the form.
- `app/page.tsx` — **modify.** Add a "Submit an event" link near the existing subscribe entry point (discovery).

---

## Conventions used below

- Austin `city_id` is `1`. Run one Vitest file: `npm test -- <path>`. Full suite: `npm test`. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`. Build: `npm run build`.
- New DB-touching functions get a PGlite integration test; the API routes are thin wrappers verified by typecheck + build (matching the codebase, which has no route-handler unit tests).
- The migration runner auto-applies `011_event_status.sql` to both drivers.

---

## Task 1: `events.status` migration + public read filter + insertEvent status

**Files:**
- Create: `supabase/migrations/011_event_status.sql`
- Modify: `lib/db/index.ts`
- Test: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/db/db.integration.test.ts` (uses the existing `mk`, `getPgliteDb`, and `insertEvent`/`listEvents` imports):

```ts
describe('event status (migration 011)', () => {
  it('defaults seeded/ingested events to approved and hides pending from public reads', async () => {
    const db = await getPgliteDb()
    // Existing seed rows are all approved.
    const seededPending = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM events WHERE status <> 'approved'`
    )
    expect(parseInt(seededPending[0].n, 10)).toBe(0)

    // A pending insert is invisible to the public list/count.
    const soon = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString()
    const raw = mk({ title: 'Pending Only Show', source: 'submission', source_id: 'pend-1', start_time: soon })
    const id = await insertEvent(raw, {
      cityId: 1, titleNorm: normalizeTitle(raw.title, raw.venue_name), venueNorm: normalizeVenue(raw.venue_name),
      status: 'pending',
    })
    expect(id).toBeTruthy()
    const listed = await listEvents({ q: 'Pending Only Show', limit: 10, offset: 0 })
    expect(listed.some(e => e.id === id)).toBe(false)
    const detail = await getEvent(id)
    expect(detail).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- lib/db/db.integration.test.ts -t "event status"`
Expected: FAIL — `column "status" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/011_event_status.sql`:

```sql
-- Phase 2C: moderation status for user submissions. Every existing row and every
-- ingest insert defaults to 'approved' (visible), so nothing changes for the
-- pipeline; only the public /api/submit path writes 'pending'. Public reads
-- filter to 'approved' (see lib/db/index.ts), so pending submissions are invisible
-- until an admin approves them.
ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- Moderation queue reads pending rows; public reads filter approved. Both benefit.
CREATE INDEX events_status ON events(status);
```

- [ ] **Step 4: Add the public status filter + insertEvent status**

In `lib/db/index.ts`:

(a) `listEvents` — add the filter to the initial `where`:

```ts
  const params: unknown[] = [fromIso]
  let where = `e.start_time >= $1 AND e.status = 'approved'`
```

(b) `countEvents` — same change to its `where` initializer:

```ts
  const params: unknown[] = [fromIso]
  let where = `e.start_time >= $1 AND e.status = 'approved'`
```

(c) `getEvent` — filter the single-row read:

```ts
  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.*, ${CATEGORIES_JSON}, ${SOURCES_JSON} FROM events e WHERE e.id = $1 AND e.status = 'approved'`,
    [id]
  )
```

(d) `getEventsBetween` — add to its WHERE:

```ts
    `SELECT e.*, ${CATEGORIES_JSON}
     FROM events e WHERE e.start_time >= $1 AND e.start_time <= $2 AND e.status = 'approved'
     ORDER BY e.start_time ASC`,
```

(e) `insertEvent` — accept an optional `status` (default `approved`) and write it:

```ts
export async function insertEvent(
  raw: RawEvent,
  keys: { cityId: number; titleNorm: string; venueNorm: string | null; status?: 'pending' | 'approved' | 'rejected' }
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- lib/db/db.integration.test.ts -t "event status"`
Expected: PASS.

- [ ] **Step 6: Run the whole integration file to confirm no regressions**

Run: `npm test -- lib/db/db.integration.test.ts`
Expected: PASS (seeded events are approved, so all existing read/dedup tests are unaffected).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/011_event_status.sql lib/db/index.ts lib/db/db.integration.test.ts
git commit -m "feat(db): events.status + public reads filter approved (PRODUCT-SPEC §4.5)"
```

---

## Task 2: persist a submission as pending

**Files:**
- Modify: `lib/persist.ts`
- Test: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/db/db.integration.test.ts` (import `persistEvents` is already present):

```ts
describe('persistEvents pending submissions (Phase 2C)', () => {
  it('lands a new submission as pending, hidden from public list', async () => {
    const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const sub = mk({ title: 'Backyard Taco Popup', source: 'submission', source_id: 'sub-taco-1', venue_name: 'Someone Yard', start_time: soon })
    const res = await persistEvents([sub], { status: 'pending' })
    expect(res.inserted).toBe(1)

    const listed = await listEvents({ q: 'Backyard Taco Popup', limit: 10, offset: 0 })
    expect(listed.length).toBe(0)
  })

  it('a pending submission that matches an approved event does not downgrade it', async () => {
    const soon = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString()
    const approved = mk({ title: 'Downgrade Test Fest', source: 'crawl', source_id: 'dt-approved', venue_name: 'Mohawk', start_time: soon })
    await persistEvents([approved]) // default approved
    const dup = mk({ title: 'Downgrade Test Fest', source: 'submission', source_id: 'dt-sub', venue_name: 'Mohawk', start_time: soon })
    await persistEvents([dup], { status: 'pending' })

    // Still visible publicly (approved event unchanged), exactly one canonical row.
    const listed = await listEvents({ q: 'Downgrade Test Fest', limit: 10, offset: 0 })
    expect(listed.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- lib/db/db.integration.test.ts -t "pending submissions"`
Expected: FAIL — `persistEvents` doesn't accept a second arg / new events aren't pending, so the first assertion (`listed.length === 0`) fails.

- [ ] **Step 3: Thread `status` through persist**

In `lib/persist.ts`:

(a) Update the signature and pass `status` to `persistOne`:

```ts
export async function persistEvents(
  input: RawEvent[],
  opts: { status?: 'pending' | 'approved' } = {}
): Promise<{ inserted: number; skipped: number; rejected: number; total: number }> {
```

(b) In the persist loop, pass the status:

```ts
      const eventId = await persistOne(events[i], CITY_ID, opts.status ?? 'approved')
```

(c) Update `persistOne` to apply status only on the insert (3b) branch:

```ts
async function persistOne(raw: RawEvent, cityId: number, status: 'pending' | 'approved'): Promise<string> {
```

and in its "no match — new canonical event" branch:

```ts
    } else {
      // 3b. No match — new canonical event (carries the caller's moderation status).
      eventId = await insertEvent(raw, { cityId, titleNorm, venueNorm, status })
    }
```

Leave the matched/idempotent branches untouched — a submission that matches an existing event adds provenance but never changes its status.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/db/db.integration.test.ts -t "pending submissions"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/persist.ts lib/db/db.integration.test.ts
git commit -m "feat(persist): optional pending status for user submissions"
```

---

## Task 3: Admin moderation queries + API

**Files:**
- Modify: `lib/db/index.ts` (`listPendingEvents`, `setEventStatus`)
- Create: `app/api/admin/submissions/route.ts`
- Test: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/db/db.integration.test.ts` (add `listPendingEvents, setEventStatus` to the `./index` import):

```ts
describe('admin moderation queries (Phase 2C)', () => {
  it('lists pending events and approving one makes it public', async () => {
    const soon = new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString()
    await persistEvents(
      [mk({ title: 'Moderate Me Meetup', source: 'submission', source_id: 'mod-1', start_time: soon })],
      { status: 'pending' }
    )

    const pending = await listPendingEvents(50)
    const mine = pending.find(p => p.source_id === 'mod-1')
    expect(mine).toBeTruthy()
    expect(await listEvents({ q: 'Moderate Me Meetup', limit: 10, offset: 0 })).toHaveLength(0)

    await setEventStatus(mine!.id, 'approved')
    expect(await listEvents({ q: 'Moderate Me Meetup', limit: 10, offset: 0 })).toHaveLength(1)
    // No longer in the pending queue.
    expect((await listPendingEvents(50)).some(p => p.source_id === 'mod-1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- lib/db/db.integration.test.ts -t "admin moderation"`
Expected: FAIL — `listPendingEvents is not a function`.

- [ ] **Step 3: Implement the queries**

Add to `lib/db/index.ts` (near the other event helpers):

```ts
// ---------------------------------------------------------------------------
// Moderation — user-submission queue (Phase 2C)
// ---------------------------------------------------------------------------
export type PendingEvent = {
  id: string
  title: string
  start_time: string
  venue_name: string | null
  source: string
  source_id: string | null
  ticket_url: string | null
  created_at: string
}

// The moderation queue: pending events newest-first for admin review.
export async function listPendingEvents(limit: number): Promise<PendingEvent[]> {
  const db = await getDb()
  return db.query<PendingEvent>(
    `SELECT id, title, start_time, venue_name, source, source_id, ticket_url, created_at
     FROM events WHERE status = 'pending'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  )
}

// Approve/reject a submission. Idempotent; only touches the status column.
export async function setEventStatus(
  id: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  const db = await getDb()
  await db.query(`UPDATE events SET status = $2, updated_at = NOW() WHERE id = $1`, [id, status])
}
```

- [ ] **Step 4: Run the query test to verify it passes**

Run: `npm test -- lib/db/db.integration.test.ts -t "admin moderation"`
Expected: PASS.

- [ ] **Step 5: Create the admin API route**

Create `app/api/admin/submissions/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { listPendingEvents, setEventStatus } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Admin moderation queue for user submissions (Phase 2C). API-only for v1 —
// accounts are post-v1 (PRODUCT-SPEC §5), so this reuses the same fail-closed
// bearer auth as /api/admin/health rather than a browser-authenticated UI.
//
//   GET  /api/admin/submissions           → the pending queue
//   POST /api/admin/submissions           → { event_id, action: 'approve'|'reject' }
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  const pending = await listPendingEvents(200)
  return NextResponse.json({ count: pending.length, pending })
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  let body: { event_id?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with event_id and action' }, { status: 400 })
  }

  const eventId = typeof body.event_id === 'string' ? body.event_id : ''
  const action = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : null
  if (!eventId || !action) {
    return NextResponse.json({ error: 'event_id and action ("approve"|"reject") are required' }, { status: 400 })
  }

  try {
    await setEventStatus(eventId, action)
    return NextResponse.json({ ok: true, event_id: eventId, status: action })
  } catch (e) {
    console.error('Moderation action failed:', e)
    return NextResponse.json({ error: 'Could not update submission' }, { status: 500 })
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/index.ts app/api/admin/submissions/route.ts lib/db/db.integration.test.ts
git commit -m "feat(admin): moderation queue API + listPendingEvents/setEventStatus"
```

---

## Task 4: Public submission endpoint

**Files:**
- Create: `app/api/submit/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/submit/route.ts`. It reuses the import extraction (SSRF-guarded URL fetch or pasted text) but persists as `pending` and is unauthenticated:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { pageFromHtml } from '@/lib/sources/crawler'
import { extractEventsFromPages, type CrawlPage } from '@/lib/extractor'
import { persistEvents } from '@/lib/persist'
import { safeFetchHtml, SsrfError } from '@/lib/ssrf'

export const maxDuration = 120

// Public event submission (PRODUCT-SPEC §4.5). Anyone can submit an event by URL
// or pasted text; it runs the same extraction as /api/import but lands the events
// as `status = 'pending'` (invisible to the site) for admin approval.
//
// Unauthenticated by design, but bounded: SSRF guards on URLs (safeFetchHtml),
// a pasted-text length cap, a honeypot field, and the global Gemini daily budget.
// Heavy-duty bot defense (Vercel BotID / WAF rate limiting) is the production
// hardening layer and is configured at the platform, not here.
const MAX_TEXT = 8000

export async function POST(req: NextRequest) {
  let body: { url?: unknown; text?: unknown; website?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with a "url" or "text" field' }, { status: 400 })
  }

  // Honeypot: real users never fill a hidden "website" field; bots do. Silently
  // accept (200) so scrapers get no signal, but do nothing.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({ received: 0 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : ''

  let page: CrawlPage | null = null
  if (url) {
    try {
      const html = await safeFetchHtml(url)
      page = pageFromHtml(html, url)
    } catch (e) {
      if (e instanceof SsrfError) {
        return NextResponse.json({ error: `Cannot fetch that URL: ${e.message}` }, { status: 400 })
      }
      return NextResponse.json(
        { error: 'Could not read that URL. Paste the event details instead.' },
        { status: 422 }
      )
    }
    if (page.text.length < 40) {
      return NextResponse.json(
        { error: 'Could not read that URL. Paste the event details instead.' },
        { status: 422 }
      )
    }
    page.source = 'submission'
  } else if (text) {
    page = { source: 'submission', url: '', title: null, image_url: null, text }
  } else {
    return NextResponse.json({ error: 'Provide a "url" or "text" field' }, { status: 400 })
  }

  const events = await extractEventsFromPages([page])
  if (events.length === 0) {
    return NextResponse.json({
      received: 0,
      note: process.env.GEMINI_API_KEY
        ? 'We could not find a specific upcoming event in that. Try pasting the date, time, and venue.'
        : 'Submissions are temporarily unavailable.',
    })
  }

  // Land as pending for moderation. Events with source 'submission' get NULL
  // source_id in provenance (no sources row) — expected.
  const { inserted } = await persistEvents(events, { status: 'pending' })
  return NextResponse.json({
    received: inserted,
    message: 'Thanks! Your event was submitted and will appear after a quick review.',
  })
}
```

- [ ] **Step 2: Typecheck + build the route**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/submit/route.ts
git commit -m "feat(submit): public event submission endpoint → pending (PRODUCT-SPEC §4.5)"
```

---

## Task 5: Public submission form UI

**Files:**
- Create: `components/SubmitForm.tsx`
- Create: `app/submit/page.tsx`
- Modify: `app/page.tsx` (add a discovery link)

- [ ] **Step 1: Create the client form**

Create `components/SubmitForm.tsx` (models the existing `SubscribeForm` conventions — client component, fetch, success/error states):

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SubmitForm() {
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim() && !text.trim()) {
      setStatus('error')
      setMessage('Add a link or paste the event details.')
      return
    }
    setStatus('loading')
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, text, website }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && (data.received ?? 0) > 0) {
        setStatus('success')
        setMessage(data.message ?? 'Thanks! Your event was submitted for review.')
      } else {
        setStatus('error')
        setMessage(data.error ?? data.note ?? 'We could not find an event in that. Try adding the date, time, and venue.')
      }
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-5xl">✅</p>
        <h2 className="text-xl font-bold">Submitted!</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href="/" className="block mt-4 text-sm text-violet-600 hover:underline">Browse events now →</Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="url">Event link</label>
        <Input
          id="url"
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://…  (Eventbrite, a venue page, a post)"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="text">…or paste the details</label>
        <textarea
          id="text"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          maxLength={8000}
          placeholder="What, when, where — e.g. 'Taco popup at Someone's Yard, Sat July 12 at 6pm, free'"
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* Honeypot: hidden from users, catches bots. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={e => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {status === 'error' && <p className="text-sm text-red-500">{message}</p>}

      <Button
        type="submit"
        disabled={status === 'loading'}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {status === 'loading' ? 'Submitting…' : 'Submit event'}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Submissions are reviewed before they appear.
      </p>
    </form>
  )
}
```

- [ ] **Step 2: Create the page**

Create `app/submit/page.tsx` (models `app/subscribe/page.tsx`):

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { SubmitForm } from '@/components/SubmitForm'

export const metadata: Metadata = {
  title: 'Submit an event',
  description: 'Add an Austin event to What It Do — paste a link or the details and we’ll list it after a quick review.',
}

export default function SubmitPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href="/" className="text-sm text-violet-600 hover:underline">← Back to events</Link>
        </div>
      </header>

      <div className="flex items-start justify-center pt-12 pb-20 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <p className="text-4xl mb-3">📣</p>
            <h1 className="text-2xl font-bold mb-2">Submit an Austin event</h1>
            <p className="text-sm text-muted-foreground">
              Know something happening that we’re missing? Add it here — a link or a few details is all it takes.
            </p>
          </div>
          <SubmitForm />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add a discovery link on the homepage**

In `app/page.tsx`, find the existing subscribe entry point (a `Link` to `/subscribe`) and add a sibling link to `/submit`. Match the surrounding markup exactly — inspect the file first, then add, e.g. next to the subscribe link:

```tsx
<Link href="/submit" className="text-sm text-violet-600 hover:underline">Submit an event</Link>
```

If the homepage has no obvious link cluster, add it in the header/footer area alongside the subscribe call-to-action. Keep styling consistent with the existing link.

- [ ] **Step 4: Build to verify the routes + pages compile**

Run: `npm run build`
Expected: build succeeds; `/submit` appears in the route list (static) and `/api/submit` + `/api/admin/submissions` as dynamic.

- [ ] **Step 5: Commit**

```bash
git add components/SubmitForm.tsx app/submit/page.tsx app/page.tsx
git commit -m "feat(submit): public submission form + page + homepage link"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Expected: typecheck clean, lint clean, all Vitest suites green, Next build succeeds.

- [ ] **Step 2: Commit any lint/format fixes if needed**

If Steps produced fixes:

```bash
git add -A
git commit -m "chore(submit): lint/verify fixes"
```

---

## Self-Review

**Spec coverage (PRODUCT-SPEC §4.5, differentiation feature #5; Phase 2A plan's 2C bullet):**

- Public form → URL or pasted text → import pipeline → `pending` → admin approve. ✅ (Tasks 1–5.)
- Reuses the auth'd `/api/import` extraction (SSRF, Gemini) without exposing the auth'd route publicly — a separate bounded `/api/submit`. ✅
- Pending invisible to the public site/search/calendar/digest/sitemap/detail. ✅ (public reads filter `approved`, Task 1.)
- Dedup interaction handled: a submission matching an existing event adds provenance, never downgrades it. ✅ (Task 2 + its test.)

**Deferred (correctly, and flagged):** T4 source-discovery logging (§1.2); status-upgrade when a trusted source later confirms a pending event; browser-authenticated admin UI (accounts post-v1, §5) — moderation is API-only.

**Type consistency:** `insertEvent` keys gain optional `status`; `persistEvents(input, { status })` and `persistOne(raw, cityId, status)` agree; `PendingEvent` matches the `listPendingEvents` SELECT; `setEventStatus` restricted to `'approved' | 'rejected'`.

**Verification-before-completion:** Task 6 runs tsc + lint + test + build; no success claim before that gate passes.

---

*Phase 2C done-state: anyone can submit an event by link or text; it lands invisible as `pending`, an admin approves it via a bearer-auth API, and only then does it appear on the site. The long tail the crawler misses now has a contribution path, and the moderation surface is one status column + two queries. This composes with 2B (submissions can later auto-suggest `sources` rows) and 2D (approved events flow into the programmatic SEO pages).*
