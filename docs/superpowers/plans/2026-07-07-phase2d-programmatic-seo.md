# Phase 2D — Programmatic SEO Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a set of statically-generated landing pages for the canned "what to do" queries where organic search traffic actually lands (`/live-music-tonight`, `/free-things-to-do-this-weekend`, `/things-to-do-this-weekend`, …) — each a config row of `(slug, copy, filters)` over the existing `listEvents`, with per-page metadata and `ItemList` JSON-LD, so no code beyond the config array is needed to add another (PRODUCT-SPEC §4.2).

**Architecture:** A config array (`lib/landingPages.ts`) maps each slug to display copy + a filter set (`categories`, a `when` date preset, `isFree`). A single root dynamic route `app/[slug]/page.tsx` renders all of them: `generateStaticParams` emits only the configured slugs and `dynamicParams = false` 404s everything else, so the segment is fully static and never collides with the existing static routes (`/events`, `/submit`, `/subscribe`) which take routing priority. Each page resolves its `when` preset through the existing `resolveDateRange`, queries `listEvents`, renders the shared `EventGrid`, and emits per-page `<title>`/description/canonical + schema.org `ItemList` JSON-LD. `listEvents`/`countEvents` gain an `isFree` filter to power the "free" pages (also the groundwork for the price/free filter chip, feature #6). The pages are linked from a homepage footer and listed in `sitemap.ts` for discoverability.

**Tech Stack:** Next.js App Router (static generation + ISR), TypeScript, PostgreSQL / PGlite, Vitest.

---

## Phase 2 decomposition (context)

Phase 2 = 2A (dedup, merged), 2B (config-driven sources, PR #16), 2C (user submissions, PR #17), **2D (this plan — programmatic SEO)**. This is the last sub-plan of Phase 2. It builds on 2C (branch `claude/phase2c-user-submissions`), so it stacks on that branch; no new migration.

**Forward-compat with Phase 3:** full `[city]` routing is Phase 3. These pages are Austin-scoped at flat slugs now (`/live-music-tonight`); in Phase 3 they move under the city segment (`/austin/live-music-tonight`) — the config array and rendering carry over unchanged, only the file location moves.

---

## Design decisions locked in

1. **One root dynamic route, not one file per page.** `app/[slug]/page.tsx` + `generateStaticParams` over the config array is the "config, not code" spec intent. `dynamicParams = false` makes unknown slugs 404 and keeps every page static. Static sibling routes (`/events`, `/submit`, `/subscribe`, `sitemap.xml`, `robots.txt`) match first, so the dynamic segment only ever catches the configured slugs.
2. **Filters reuse the existing machinery.** `when` goes through `resolveDateRange` (same Central-time logic as the homepage); `categories` go straight to `listEvents`. Only `isFree` is new — a small `AND e.is_free = true` added to `listEvents`/`countEvents`.
3. **Static + ISR, `revalidate = 900`.** Same 15-minute revalidation as the homepage and detail pages, so "tonight"/"this weekend" windows stay fresh without per-request rendering.
4. **A capped static grid, no client "Load More".** Each page server-renders up to 48 events via the shared `EventGrid` and links to the filtered homepage for the rest. Keeps the page fully static and avoids widening `/api/events` with new params.
5. **Only approved events appear** — automatic, because `listEvents` already filters `status = 'approved'` (from 2C).

---

## File Structure

- `lib/landingPages.ts` — **create.** The config array (`LANDING_PAGES`) + `LandingPage`/`LandingFilters` types + `getLandingPage(slug)`.
- `lib/landingPages.test.ts` — **create.** Unit tests: unique slugs, valid category slugs, valid `when` presets.
- `lib/db/index.ts` — **modify.** Add optional `isFree` to `listEvents` + `countEvents`.
- `lib/db/db.integration.test.ts` — **modify.** Test the `isFree` filter.
- `app/[slug]/page.tsx` — **create.** The landing route: `generateStaticParams`, `generateMetadata`, render + `ItemList` JSON-LD.
- `components/SiteFooter.tsx` — **create.** Footer linking the landing pages (internal links for indexing).
- `app/page.tsx` — **modify.** Render `<SiteFooter />` at the bottom of the homepage.
- `app/sitemap.ts` — **modify.** Add the landing-page URLs.

---

## Conventions used below

- Austin `city_id` is `1`. Run one Vitest file: `npm test -- <path>`. Full suite: `npm test`. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`. Build: `npm run build`.
- Pure config/functions get a unit test; the `isFree` query gets a PGlite integration test; the route + footer are verified by `npm run build` (the 8 pages must appear as static routes).

---

## Task 1: `isFree` filter on listEvents/countEvents

**Files:**
- Modify: `lib/db/index.ts`
- Test: `lib/db/db.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/db/db.integration.test.ts`:

```ts
describe('isFree filter (Phase 2D)', () => {
  it('returns only free events when isFree is set', async () => {
    const soon = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString()
    await persistEvents([
      mk({ title: 'Free Yoga In The Park', source: 'crawl', source_id: 'free-1', is_free: true, start_time: soon }),
      mk({ title: 'Paid Yoga Workshop', source: 'crawl', source_id: 'paid-1', is_free: false, price_min: 20, start_time: soon }),
    ])
    const free = await listEvents({ q: 'Yoga', isFree: true, limit: 20, offset: 0 })
    expect(free.some(e => e.source_id === 'free-1')).toBe(true)
    expect(free.some(e => e.source_id === 'paid-1')).toBe(false)
    expect(await countEvents({ q: 'Yoga', isFree: true })).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- lib/db/db.integration.test.ts -t "isFree filter"`
Expected: FAIL — `isFree` is ignored, so the paid event is still returned (assertion `paid-1 === false` fails) or a TS error on the unknown option.

- [ ] **Step 3: Add the filter**

In `lib/db/index.ts`:

(a) `listEvents` — extend the options type and the WHERE. Change its signature options to include `isFree?: boolean` and add the clause after the categories block, before the `limit`/`offset` pushes:

```ts
export async function listEvents(opts: {
  q?: string
  categories?: string[]
  from?: string
  to?: string
  isFree?: boolean
  limit: number
  offset: number
}): Promise<EnrichedEvent[]> {
```

and, right before `params.push(opts.limit)`:

```ts
  if (opts.isFree) {
    where += ` AND e.is_free = true`
  }
```

(b) `countEvents` — same option + clause:

```ts
export async function countEvents(opts: {
  q?: string
  categories?: string[]
  from?: string
  to?: string
  isFree?: boolean
}): Promise<number> {
```

and after the categories block:

```ts
  if (opts.isFree) { where += ` AND e.is_free = true` }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/db/db.integration.test.ts -t "isFree filter"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/index.ts lib/db/db.integration.test.ts
git commit -m "feat(db): isFree filter on listEvents/countEvents (PRODUCT-SPEC §4.6)"
```

---

## Task 2: Landing-page config

**Files:**
- Create: `lib/landingPages.ts`
- Create: `lib/landingPages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/landingPages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LANDING_PAGES, getLandingPage } from './landingPages'
import { CATEGORY_SLUGS } from './categories'
import { WHEN_PRESETS } from './dateRanges'

const WHEN_VALUES = WHEN_PRESETS.map(p => p.value)

describe('landing pages config', () => {
  it('has at least 6 pages with unique, url-safe slugs', () => {
    expect(LANDING_PAGES.length).toBeGreaterThanOrEqual(6)
    const slugs = LANDING_PAGES.map(p => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/)
  })

  it('references only real category slugs and when presets', () => {
    for (const p of LANDING_PAGES) {
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
      for (const c of p.filters.categories ?? []) {
        expect(CATEGORY_SLUGS as readonly string[]).toContain(c)
      }
      if (p.filters.when) expect(WHEN_VALUES).toContain(p.filters.when)
    }
  })

  it('getLandingPage resolves a known slug and rejects an unknown one', () => {
    expect(getLandingPage(LANDING_PAGES[0].slug)?.slug).toBe(LANDING_PAGES[0].slug)
    expect(getLandingPage('not-a-real-page')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- lib/landingPages.test.ts`
Expected: FAIL — cannot find module `./landingPages`.

- [ ] **Step 3: Implement the config**

Create `lib/landingPages.ts`:

```ts
import type { WhenPreset } from './dateRanges'
import type { CategorySlug } from './categories'

// A programmatic SEO landing page: a canned filter combination over listEvents
// with its own copy. Adding coverage of a new organic-search query is one row
// here — no new route, no new component (PRODUCT-SPEC §4.2).
export type LandingFilters = {
  categories?: CategorySlug[]
  when?: WhenPreset
  isFree?: boolean
}

export type LandingPage = {
  slug: string        // URL + generateStaticParams key
  title: string       // <title>, <h1>
  description: string  // meta description + on-page intro
  filters: LandingFilters
}

export const LANDING_PAGES: LandingPage[] = [
  {
    slug: 'things-to-do-this-weekend',
    title: 'Things to Do in Austin This Weekend',
    description: 'The best events happening in Austin this weekend — concerts, markets, comedy, food, and more, updated daily.',
    filters: { when: 'weekend' },
  },
  {
    slug: 'free-things-to-do-this-weekend',
    title: 'Free Things to Do in Austin This Weekend',
    description: 'Every free event in Austin this weekend, in one place — live music, festivals, markets, and family fun that costs nothing.',
    filters: { when: 'weekend', isFree: true },
  },
  {
    slug: 'live-music-tonight',
    title: 'Live Music in Austin Tonight',
    description: 'Where to catch live music in Austin tonight — every show we can find, from dive bars to the big rooms.',
    filters: { categories: ['music'], when: 'today' },
  },
  {
    slug: 'live-music-this-weekend',
    title: 'Live Music in Austin This Weekend',
    description: 'Austin’s live music this weekend — gigs, concerts, and residencies across the city, updated daily.',
    filters: { categories: ['music'], when: 'weekend' },
  },
  {
    slug: 'family-friendly-events-this-weekend',
    title: 'Family-Friendly Things to Do in Austin This Weekend',
    description: 'Kid-friendly events in Austin this weekend — story times, markets, festivals, and outdoor fun for the whole family.',
    filters: { categories: ['family'], when: 'weekend' },
  },
  {
    slug: 'comedy-shows-this-week',
    title: 'Comedy Shows in Austin This Week',
    description: 'Stand-up, improv, and open mics in Austin this week — every comedy show we can find.',
    filters: { categories: ['comedy'], when: 'week' },
  },
  {
    slug: 'free-events-this-week',
    title: 'Free Events in Austin This Week',
    description: 'Everything free happening in Austin this week — no ticket required.',
    filters: { isFree: true, when: 'week' },
  },
  {
    slug: 'food-and-drink-events-this-weekend',
    title: 'Food & Drink Events in Austin This Weekend',
    description: 'Tastings, pop-ups, markets, and food festivals in Austin this weekend.',
    filters: { categories: ['food-drink'], when: 'weekend' },
  },
]

export function getLandingPage(slug: string): LandingPage | undefined {
  return LANDING_PAGES.find(p => p.slug === slug)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/landingPages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/landingPages.ts lib/landingPages.test.ts
git commit -m "feat(seo): landing-page config array (PRODUCT-SPEC §4.2)"
```

---

## Task 3: The landing route

**Files:**
- Create: `app/[slug]/page.tsx`

- [ ] **Step 1: Create the route**

Create `app/[slug]/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EventGrid } from '@/components/EventGrid'
import { listEvents } from '@/lib/db'
import { resolveDateRange } from '@/lib/dateRanges'
import { getBaseUrl } from '@/lib/site'
import { LANDING_PAGES, getLandingPage } from '@/lib/landingPages'
import type { EnrichedEvent } from '@/lib/types'

// Static generation: only the configured slugs exist; anything else 404s.
export const dynamicParams = false
// ISR: "tonight"/"this weekend" windows resolve at generation time; refresh every
// 15 minutes like the homepage so they stay current without per-request rendering.
export const revalidate = 900

export function generateStaticParams() {
  return LANDING_PAGES.map(p => ({ slug: p.slug }))
}

const MAX_EVENTS = 48

async function eventsFor(slug: string): Promise<EnrichedEvent[]> {
  const page = getLandingPage(slug)
  if (!page) return []
  const range = resolveDateRange({ when: page.filters.when ?? null })
  const events = await listEvents({
    categories: page.filters.categories as string[] | undefined,
    from: range.fromIso,
    to: range.toIso ?? undefined,
    isFree: page.filters.isFree,
    limit: MAX_EVENTS,
    offset: 0,
  })
  return events as unknown as EnrichedEvent[]
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const page = getLandingPage(slug)
  if (!page) return { title: 'Page not found' }
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/${page.slug}` },
    openGraph: { title: page.title, description: page.description, type: 'website' },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description },
  }
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = getLandingPage(slug)
  if (!page) notFound()

  const events = await eventsFor(slug)

  // Link to the filtered homepage for the full list beyond the capped grid.
  const qs = new URLSearchParams()
  ;(page.filters.categories ?? []).forEach(c => qs.append('category', c))
  if (page.filters.when) qs.set('when', page.filters.when)
  const moreHref = `/?${qs.toString()}`

  const base = getBaseUrl()
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: page.title,
    itemListElement: events.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${base}/events/${e.id}`,
      name: e.title as string,
    })),
  }

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="font-bold text-lg text-violet-600">🎉 What It Do ATX</Link>
          <Link href="/subscribe" className="text-sm text-violet-600 hover:underline">Get updates</Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2 text-slate-900">{page.title}</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-2xl">{page.description}</p>

        {events.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            Nothing on the calendar for this just yet — <Link href="/" className="text-violet-600 hover:underline">browse all Austin events</Link>.
          </div>
        ) : (
          <>
            <EventGrid events={events} />
            <div className="text-center mt-8">
              <Link href={moreHref} className="text-sm text-violet-600 hover:underline">
                See more Austin events →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build to verify the pages statically generate**

Run: `npm run build`
Expected: build succeeds and the route list shows the landing slugs as static (`○`), e.g. `/things-to-do-this-weekend`, `/live-music-tonight`, … (via `● /[slug]` with generated params, or listed individually). Confirm no collision warning with `/events`, `/submit`, `/subscribe`.

- [ ] **Step 3: Commit**

```bash
git add app/[slug]/page.tsx
git commit -m "feat(seo): static landing route with per-page metadata + ItemList JSON-LD"
```

---

## Task 4: Internal linking — footer + sitemap

**Files:**
- Create: `components/SiteFooter.tsx`
- Modify: `app/page.tsx`
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Create the footer**

Create `components/SiteFooter.tsx` (a server component; internal links help these pages get discovered and indexed):

```tsx
import Link from 'next/link'
import { LANDING_PAGES } from '@/lib/landingPages'

export function SiteFooter() {
  return (
    <footer className="border-t mt-12 bg-white/60">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-sm font-medium text-slate-700 mb-3">Popular in Austin</p>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
          {LANDING_PAGES.map(p => (
            <li key={p.slug}>
              <Link href={`/${p.slug}`} className="text-sm text-violet-600 hover:underline">
                {p.title.replace(' in Austin', '')}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-6">
          What It Do ATX — every Austin event, in one place.{' '}
          <Link href="/submit" className="text-violet-600 hover:underline">Submit an event</Link>.
        </p>
      </div>
    </footer>
  )
}
```

- [ ] **Step 2: Render the footer on the homepage**

In `app/page.tsx`, import it and render it just before the final closing `</div>` of the page root. Add the import:

```tsx
import { SiteFooter } from '@/components/SiteFooter'
```

and place `<SiteFooter />` after the main content container (immediately before the outermost `</div>` returned by `HomePage`).

- [ ] **Step 3: Add landing pages to the sitemap**

In `app/sitemap.ts`, import the config and add the URLs. Add the import:

```ts
import { LANDING_PAGES } from '@/lib/landingPages'
```

and build the entries + include them in the returned array:

```ts
  const landingUrls: MetadataRoute.Sitemap = LANDING_PAGES.map(p => ({
    url: `${base}/${p.slug}`,
    changeFrequency: 'daily',
    priority: 0.8,
  }))

  return [
    { url: base, changeFrequency: 'hourly', priority: 1 },
    ...landingUrls,
    { url: `${base}/subscribe`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/submit`, changeFrequency: 'monthly', priority: 0.3 },
    ...eventUrls,
  ]
```

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: build succeeds; homepage still static; footer links compile.

- [ ] **Step 5: Commit**

```bash
git add components/SiteFooter.tsx app/page.tsx app/sitemap.ts
git commit -m "feat(seo): footer links + sitemap entries for landing pages"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Expected: typecheck clean, lint clean, all Vitest suites green, Next build succeeds with the landing slugs present as static routes.

- [ ] **Step 2: Spot-check a page renders (optional, local)**

If a dev server is convenient: `npm run dev`, then load `/live-music-tonight` and `/free-things-to-do-this-weekend`; confirm the heading, intro, event grid, and (view source) the `ItemList` JSON-LD are present. Otherwise the build route list + tests are sufficient evidence.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore(seo): lint/verify fixes"   # only if Steps produced changes
```

---

## Self-Review

**Spec coverage (PRODUCT-SPEC §4.2; Phase 2A plan's 2D bullet):**

- Config array of `(slug, filters, copy)` over `listEvents`, statically generated → Tasks 2–3. ✅
- The canned queries organic traffic lands on (`free-things-to-do-this-weekend`, `live-music-tonight`, `this-weekend`, `family`) → all present in `LANDING_PAGES`. ✅
- Per-page metadata + JSON-LD for indexing → `generateMetadata` + `ItemList` JSON-LD (Task 3). ✅
- Internal linking + sitemap so the pages are discovered → Task 4. ✅
- `isFree` needed by the "free" pages → Task 1 (also seeds feature #6). ✅

**Type consistency:** `LandingFilters.categories` is `CategorySlug[]`, cast to `string[]` at the `listEvents` boundary; `listEvents`/`countEvents` both gain `isFree?: boolean`; `getLandingPage` returns `LandingPage | undefined`; `generateStaticParams` returns `{ slug }[]` matching the route param.

**Deferred (correctly):** full `[city]` routing (Phase 3) — the pages move under the city segment then; the price/free *filter chip* UI (feature #6) beyond the query support added here.

**Verification-before-completion:** Task 5 runs tsc + lint + test + build before any completion claim.

---

*Phase 2D done-state — and Phase 2 complete: the app has canonical dedup (2A), config-driven coverage (2B), a public contribution path (2C), and now programmatic SEO landing pages (2D) that turn the event corpus into organic-search entry points. Adding a new landing page is one row in `LANDING_PAGES`. Next: Phase 3 (multi-city) moves these + the homepage under an `[city]` segment.*
