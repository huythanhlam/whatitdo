# Austin Events Aggregator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web and mobile–friendly Austin, TX events app that scrapes multiple sources daily, tags events by category with AI, and lets users search/filter/subscribe to email digests.

**Architecture:** Next.js 15 App Router frontend + API routes deployed on Vercel; Supabase for Postgres, Auth, and storage; Vercel Cron triggers daily scraping jobs that call internal API routes to ingest events; Claude Haiku tags events; Resend sends subscription digests.

**Tech Stack:** Next.js 15, Supabase (Postgres + Auth), Tailwind CSS, shadcn/ui, Cheerio (scraping), iCal parser, @google/genai (Gemini 2.5 Flash tagging), Resend (email), Vercel Cron, TypeScript

---

## File Structure

```
app/
  (public)/
    page.tsx                  # Main events listing page
    events/[id]/page.tsx      # Event detail page
  api/
    events/route.ts           # GET /api/events (list, search, filter)
    events/[id]/route.ts      # GET /api/events/:id
    ingest/route.ts           # POST /api/ingest (cron trigger)
    ingest/eventbrite/route.ts
    ingest/scrapers/route.ts
    ingest/ical/route.ts
    subscribe/route.ts        # POST /api/subscribe
    unsubscribe/route.ts      # GET /api/unsubscribe?token=
    email/digest/route.ts     # POST /api/email/digest (cron trigger)
    featured/route.ts         # POST /api/featured (admin: create featured listing)
  auth/
    callback/route.ts         # Supabase Auth callback
components/
  EventCard.tsx               # Single event card (standard + featured variant)
  EventGrid.tsx               # Responsive grid of EventCards
  SidebarFilters.tsx          # Category checkboxes + date range
  SearchBar.tsx               # Controlled search input
  SubscribeModal.tsx          # Email subscribe form
  AdSlot.tsx                  # Ad placeholder component
  FeaturedBadge.tsx           # "Featured" badge overlay
lib/
  supabase/
    client.ts                 # Browser Supabase client
    server.ts                 # Server Supabase client
    types.ts                  # Database types (generated + manual)
  scrapers/
    eventbrite.ts             # Eventbrite REST API client
    austin-chronicle.ts       # Cheerio scraper for austinchronicle.com
    do512.ts                  # Cheerio scraper for do512.com
    ical.ts                   # node-ical feed parser
  tagger.ts                   # Claude Haiku event category tagger
  email/
    templates.tsx             # React Email templates
    digest.ts                 # Build + send digest emails via Resend
  categories.ts               # Canonical category list + color map
supabase/
  migrations/
    001_initial_schema.sql
    002_subscriptions.sql
    003_featured_listings.sql
vercel.json                   # Cron job definitions
.env.local                    # All secrets (not committed)
```

---

## Phase 1: Foundation

### Task 1: Scaffold Next.js project with Supabase + Tailwind + shadcn

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`
- Create: `.env.local` (template only)

- [ ] **Step 1: Initialize Next.js project**

Run from inside the repo root (`/Users/huylam/Documents/Agentic Development/what-it-do`):

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --yes
```

Expected: Next.js project scaffolded in current directory.

- [ ] **Step 2: Install core dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk resend cheerio node-ical
npm install -D @types/node-ical
```

- [ ] **Step 3: Install shadcn/ui**

```bash
npx shadcn@latest init --yes --base-color slate
npx shadcn@latest add button input badge card dialog checkbox label separator
```

- [ ] **Step 4: Create browser Supabase client**

Create `lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 5: Create server Supabase client**

Create `lib/supabase/server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

- [ ] **Step 6: Create .env.local template**

Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ANTHROPIC_API_KEY=your_anthropic_api_key
RESEND_API_KEY=your_resend_api_key
EVENTBRITE_TOKEN=your_eventbrite_private_token
CRON_SECRET=a_random_secret_for_securing_cron_routes
```

- [ ] **Step 7: Verify dev server starts**

```bash
npm run dev
```

Expected: Server running at http://localhost:3000 with Next.js default page. No TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with Supabase, Tailwind, shadcn"
```

---

### Task 2: Database schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Create: `supabase/migrations/002_subscriptions.sql`
- Create: `supabase/migrations/003_featured_listings.sql`
- Create: `lib/supabase/types.ts`

- [ ] **Step 1: Create initial schema migration**

Create `supabase/migrations/001_initial_schema.sql`:

```sql
-- Categories lookup table
CREATE TABLE categories (
  id   SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,   -- e.g. "comedy", "food-drink"
  name TEXT NOT NULL,          -- e.g. "Comedy", "Food & Drink"
  color TEXT NOT NULL          -- hex for UI badges
);

INSERT INTO categories (slug, name, color) VALUES
  ('music',        'Music',          '#7c3aed'),
  ('comedy',       'Comedy',         '#ea580c'),
  ('food-drink',   'Food & Drink',   '#16a34a'),
  ('arts',         'Arts',           '#0284c7'),
  ('sports',       'Sports',         '#dc2626'),
  ('family',       'Family',         '#d97706'),
  ('festivals',    'Festivals',      '#db2777'),
  ('film',         'Film',           '#475569'),
  ('outdoors',     'Outdoors',       '#15803d'),
  ('networking',   'Networking',     '#6d28d9'),
  ('other',        'Other',          '#71717a');

-- Main events table
CREATE TABLE events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ,
  venue_name    TEXT,
  venue_address TEXT,
  image_url     TEXT,
  ticket_url    TEXT,
  source        TEXT NOT NULL,         -- 'eventbrite' | 'austin-chronicle' | 'do512' | 'ical'
  source_id     TEXT,                  -- external ID for dedup
  is_free       BOOLEAN DEFAULT false,
  price_min     NUMERIC(10,2),
  price_max     NUMERIC(10,2),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, source_id)
);

-- Many-to-many events <-> categories
CREATE TABLE event_categories (
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, category_id)
);

-- Full-text search index
CREATE INDEX events_fts ON events USING GIN (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(venue_name, ''))
);

-- Date index for range queries
CREATE INDEX events_start_time ON events(start_time);

-- Row Level Security
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read events" ON events FOR SELECT USING (true);
CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Public read event_categories" ON event_categories FOR SELECT USING (true);

-- Service role can write
CREATE POLICY "Service role write events" ON events FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role write event_categories" ON event_categories FOR ALL USING (auth.role() = 'service_role');
```

- [ ] **Step 2: Create subscriptions migration**

Create `supabase/migrations/002_subscriptions.sql`:

```sql
CREATE TABLE subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  frequency      TEXT NOT NULL DEFAULT 'daily',  -- 'daily' | 'weekly'
  category_slugs TEXT[] DEFAULT '{}',            -- empty = all categories
  token          TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  confirmed      BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages subscriptions" ON subscriptions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Users read own subscriptions" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
```

- [ ] **Step 3: Create featured listings migration**

Create `supabase/migrations/003_featured_listings.sql`:

```sql
CREATE TABLE featured_listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  ad_label    TEXT DEFAULT 'Featured',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE featured_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read featured" ON featured_listings FOR SELECT USING (true);
CREATE POLICY "Service role write featured" ON featured_listings FOR ALL USING (auth.role() = 'service_role');
```

- [ ] **Step 4: Apply migrations to Supabase**

In Supabase dashboard > SQL Editor, run each migration file in order (001, 002, 003).

Or with Supabase CLI if installed:
```bash
supabase db push
```

- [ ] **Step 5: Create TypeScript types**

Create `lib/supabase/types.ts`:

```typescript
export type Category = {
  id: number
  slug: string
  name: string
  color: string
}

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
  created_at: string
  updated_at: string
  categories?: Category[]
  is_featured?: boolean
}

export type Subscription = {
  id: string
  email: string
  user_id: string | null
  frequency: 'daily' | 'weekly'
  category_slugs: string[]
  token: string
  confirmed: boolean
  created_at: string
}

export type FeaturedListing = {
  id: string
  event_id: string
  starts_at: string
  ends_at: string
  ad_label: string
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add database schema and TypeScript types"
```

---

## Phase 2: Event Ingestion

### Task 3: Category definitions

**Files:**
- Create: `lib/categories.ts`

- [ ] **Step 1: Create categories module**

Create `lib/categories.ts`:

```typescript
export const CATEGORIES = [
  { slug: 'music',       name: 'Music',       color: '#7c3aed' },
  { slug: 'comedy',      name: 'Comedy',      color: '#ea580c' },
  { slug: 'food-drink',  name: 'Food & Drink',color: '#16a34a' },
  { slug: 'arts',        name: 'Arts',        color: '#0284c7' },
  { slug: 'sports',      name: 'Sports',      color: '#dc2626' },
  { slug: 'family',      name: 'Family',      color: '#d97706' },
  { slug: 'festivals',   name: 'Festivals',   color: '#db2777' },
  { slug: 'film',        name: 'Film',        color: '#475569' },
  { slug: 'outdoors',    name: 'Outdoors',    color: '#15803d' },
  { slug: 'networking',  name: 'Networking',  color: '#6d28d9' },
  { slug: 'other',       name: 'Other',       color: '#71717a' },
] as const

export type CategorySlug = typeof CATEGORIES[number]['slug']

export const CATEGORY_SLUGS = CATEGORIES.map(c => c.slug)

export function getCategoryBySlug(slug: string) {
  return CATEGORIES.find(c => c.slug === slug)
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/categories.ts
git commit -m "feat: add canonical category definitions"
```

---

### Task 4: AI event tagger

**Files:**
- Create: `lib/tagger.ts`

- [ ] **Step 1: Create tagger**

Create `lib/tagger.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { CATEGORY_SLUGS, CategorySlug } from './categories'

const client = new Anthropic()

export async function tagEvent(title: string, description: string | null): Promise<CategorySlug[]> {
  const prompt = `You are categorizing Austin, TX events. Given an event title and description, return a JSON array of category slugs that apply.

Available slugs: ${CATEGORY_SLUGS.join(', ')}

Rules:
- Return 1-3 slugs maximum
- Return only slugs from the list above
- Return ["other"] if nothing fits
- Return only the JSON array, no explanation

Event title: ${title}
Event description: ${description ?? 'No description provided'}

Response (JSON array only):`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '["other"]'

  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return ['other']
    return parsed.filter((s): s is CategorySlug => CATEGORY_SLUGS.includes(s as CategorySlug))
  } catch {
    return ['other']
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/tagger.ts
git commit -m "feat: add Claude Haiku event category tagger"
```

---

### Task 5: Eventbrite scraper

**Files:**
- Create: `lib/scrapers/eventbrite.ts`

- [ ] **Step 1: Create Eventbrite client**

Create `lib/scrapers/eventbrite.ts`:

```typescript
export type RawEvent = {
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  venue_name: string | null
  venue_address: string | null
  image_url: string | null
  ticket_url: string | null
  source: string
  source_id: string
  is_free: boolean
  price_min: number | null
  price_max: number | null
}

export async function fetchEventbriteEvents(): Promise<RawEvent[]> {
  const token = process.env.EVENTBRITE_TOKEN
  if (!token) throw new Error('EVENTBRITE_TOKEN not set')

  const results: RawEvent[] = []
  let pageNumber = 1
  let hasMore = true

  while (hasMore) {
    const url = new URL('https://www.eventbriteapi.com/v3/events/search/')
    url.searchParams.set('location.address', 'Austin, TX')
    url.searchParams.set('location.within', '25mi')
    url.searchParams.set('expand', 'venue,ticket_classes')
    url.searchParams.set('start_date.range_start', new Date().toISOString())
    url.searchParams.set('start_date.range_end', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())
    url.searchParams.set('page', String(pageNumber))

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) break

    const data = await res.json()

    for (const event of data.events ?? []) {
      const venue = event.venue
      results.push({
        title: event.name?.text ?? 'Untitled',
        description: event.description?.text ?? null,
        start_time: event.start?.utc ?? new Date().toISOString(),
        end_time: event.end?.utc ?? null,
        venue_name: venue?.name ?? null,
        venue_address: venue ? `${venue.address?.address_1 ?? ''}, ${venue.address?.city ?? 'Austin'}` : null,
        image_url: event.logo?.url ?? null,
        ticket_url: event.url ?? null,
        source: 'eventbrite',
        source_id: event.id,
        is_free: event.is_free ?? false,
        price_min: event.ticket_classes?.[0]?.cost?.major_value ? parseFloat(event.ticket_classes[0].cost.major_value) : null,
        price_max: event.ticket_classes?.at(-1)?.cost?.major_value ? parseFloat(event.ticket_classes.at(-1).cost.major_value) : null,
      })
    }

    hasMore = data.pagination?.has_more_items ?? false
    pageNumber++
  }

  return results
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/scrapers/eventbrite.ts
git commit -m "feat: add Eventbrite scraper"
```

---

### Task 6: Austin Chronicle scraper

**Files:**
- Create: `lib/scrapers/austin-chronicle.ts`

- [ ] **Step 1: Create scraper**

Create `lib/scrapers/austin-chronicle.ts`:

```typescript
import * as cheerio from 'cheerio'
import type { RawEvent } from './eventbrite'

export async function fetchAustinChronicleEvents(): Promise<RawEvent[]> {
  const results: RawEvent[] = []

  // Austin Chronicle events calendar
  const res = await fetch('https://www.austinchronicle.com/events/', {
    headers: { 'User-Agent': 'WhatItDo Events Bot/1.0 (contact: events@whatitdo.app)' },
  })

  if (!res.ok) return results

  const html = await res.text()
  const $ = cheerio.load(html)

  // Each event listing — selector based on Chronicle's event card structure
  $('article.event-listing, div.event-item, .calendar-event').each((_, el) => {
    const $el = $(el)

    const title = $el.find('h2, h3, .event-title, a.event-name').first().text().trim()
    if (!title) return

    const dateText = $el.find('.event-date, time, .date').first().text().trim()
    const venueText = $el.find('.venue, .location').first().text().trim()
    const description = $el.find('.event-description, p').first().text().trim() || null
    const link = $el.find('a').first().attr('href') ?? ''
    const imgSrc = $el.find('img').first().attr('src') ?? null

    // Parse date — fall back to tomorrow if unparseable
    const parsed = dateText ? new Date(dateText) : null
    const start_time = parsed && !isNaN(parsed.getTime())
      ? parsed.toISOString()
      : new Date(Date.now() + 86400000).toISOString()

    const ticket_url = link.startsWith('http') ? link : `https://www.austinchronicle.com${link}`
    const source_id = ticket_url

    results.push({
      title,
      description,
      start_time,
      end_time: null,
      venue_name: venueText || null,
      venue_address: null,
      image_url: imgSrc,
      ticket_url,
      source: 'austin-chronicle',
      source_id,
      is_free: description?.toLowerCase().includes('free') ?? false,
      price_min: null,
      price_max: null,
    })
  })

  return results
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/scrapers/austin-chronicle.ts
git commit -m "feat: add Austin Chronicle web scraper"
```

---

### Task 7: Do512 scraper

**Files:**
- Create: `lib/scrapers/do512.ts`

- [ ] **Step 1: Create scraper**

Create `lib/scrapers/do512.ts`:

```typescript
import * as cheerio from 'cheerio'
import type { RawEvent } from './eventbrite'

export async function fetchDo512Events(): Promise<RawEvent[]> {
  const results: RawEvent[] = []

  const res = await fetch('https://do512.com/events', {
    headers: { 'User-Agent': 'WhatItDo Events Bot/1.0 (contact: events@whatitdo.app)' },
  })

  if (!res.ok) return results

  const html = await res.text()
  const $ = cheerio.load(html)

  $('.ds-listing, .event-listing, article[class*="event"]').each((_, el) => {
    const $el = $(el)

    const title = $el.find('h2, h3, .ds-listing-event-title, a[class*="title"]').first().text().trim()
    if (!title) return

    const dateText = $el.find('time, .ds-date, [class*="date"]').first().attr('datetime')
      ?? $el.find('time, .ds-date, [class*="date"]').first().text().trim()
    const venueText = $el.find('[class*="venue"], [class*="location"]').first().text().trim()
    const description = $el.find('[class*="description"], p').first().text().trim() || null
    const link = $el.find('a').first().attr('href') ?? ''
    const imgSrc = $el.find('img').first().attr('src') ?? null

    const parsed = dateText ? new Date(dateText) : null
    const start_time = parsed && !isNaN(parsed.getTime())
      ? parsed.toISOString()
      : new Date(Date.now() + 86400000).toISOString()

    const ticket_url = link.startsWith('http') ? link : `https://do512.com${link}`

    results.push({
      title,
      description,
      start_time,
      end_time: null,
      venue_name: venueText || null,
      venue_address: null,
      image_url: imgSrc,
      ticket_url,
      source: 'do512',
      source_id: ticket_url,
      is_free: false,
      price_min: null,
      price_max: null,
    })
  })

  return results
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/scrapers/do512.ts
git commit -m "feat: add Do512 web scraper"
```

---

### Task 8: iCal feed scraper

**Files:**
- Create: `lib/scrapers/ical.ts`

- [ ] **Step 1: Create iCal parser**

Create `lib/scrapers/ical.ts`:

```typescript
import ical from 'node-ical'
import type { RawEvent } from './eventbrite'

// Austin venue/org iCal feeds to poll
const ICAL_FEEDS = [
  { url: 'https://www.austintexas.gov/calendar/ical', source_prefix: 'austin-gov' },
  // Add more as discovered: venue websites, Meetup group feeds, etc.
]

export async function fetchIcalEvents(): Promise<RawEvent[]> {
  const results: RawEvent[] = []

  for (const feed of ICAL_FEEDS) {
    try {
      const events = await ical.async.fromURL(feed.url)

      for (const [key, event] of Object.entries(events)) {
        if (event.type !== 'VEVENT') continue

        const start = event.start instanceof Date ? event.start : new Date(event.start as string)
        const end = event.end instanceof Date ? event.end : null

        // Skip past events
        if (start < new Date()) continue

        results.push({
          title: event.summary ?? 'Untitled',
          description: event.description ?? null,
          start_time: start.toISOString(),
          end_time: end ? end.toISOString() : null,
          venue_name: event.location ?? null,
          venue_address: event.location ?? null,
          image_url: null,
          ticket_url: event.url ?? null,
          source: feed.source_prefix,
          source_id: key,
          is_free: false,
          price_min: null,
          price_max: null,
        })
      }
    } catch {
      // Skip failed feeds — don't crash the whole ingestion run
      console.error(`Failed to fetch iCal feed: ${feed.url}`)
    }
  }

  return results
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/scrapers/ical.ts
git commit -m "feat: add iCal feed parser"
```

---

### Task 9: Ingestion API route (cron-triggered)

**Files:**
- Create: `app/api/ingest/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create ingest route**

Create `app/api/ingest/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchEventbriteEvents } from '@/lib/scrapers/eventbrite'
import { fetchAustinChronicleEvents } from '@/lib/scrapers/austin-chronicle'
import { fetchDo512Events } from '@/lib/scrapers/do512'
import { fetchIcalEvents } from '@/lib/scrapers/ical'
import { tagEvent } from '@/lib/tagger'
import { CATEGORY_SLUGS } from '@/lib/categories'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch category IDs for slug lookup
  const { data: categories } = await supabase.from('categories').select('id, slug')
  const categoryIdBySlug = Object.fromEntries((categories ?? []).map(c => [c.slug, c.id]))

  // Gather all sources
  const [eventbrite, chronicle, do512, ical] = await Promise.allSettled([
    fetchEventbriteEvents(),
    fetchAustinChronicleEvents(),
    fetchDo512Events(),
    fetchIcalEvents(),
  ])

  const allEvents = [
    ...(eventbrite.status === 'fulfilled' ? eventbrite.value : []),
    ...(chronicle.status === 'fulfilled' ? chronicle.value : []),
    ...(do512.status === 'fulfilled' ? do512.value : []),
    ...(ical.status === 'fulfilled' ? ical.value : []),
  ]

  let inserted = 0
  let skipped = 0

  for (const raw of allEvents) {
    // Upsert event (dedup by source + source_id)
    const { data: eventRow, error } = await supabase
      .from('events')
      .upsert({
        title: raw.title,
        description: raw.description,
        start_time: raw.start_time,
        end_time: raw.end_time,
        venue_name: raw.venue_name,
        venue_address: raw.venue_address,
        image_url: raw.image_url,
        ticket_url: raw.ticket_url,
        source: raw.source,
        source_id: raw.source_id,
        is_free: raw.is_free,
        price_min: raw.price_min,
        price_max: raw.price_max,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source,source_id' })
      .select('id')
      .single()

    if (error || !eventRow) { skipped++; continue }

    // Tag the event
    const slugs = await tagEvent(raw.title, raw.description)

    // Upsert category associations
    const categoryRows = slugs
      .map(slug => ({ event_id: eventRow.id, category_id: categoryIdBySlug[slug] }))
      .filter(r => r.category_id)

    if (categoryRows.length > 0) {
      await supabase.from('event_categories').upsert(categoryRows, { onConflict: 'event_id,category_id' })
    }

    inserted++
  }

  return NextResponse.json({ inserted, skipped, total: allEvents.length })
}
```

- [ ] **Step 2: Create vercel.json with cron**

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/ingest",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/email/digest",
      "schedule": "0 8 * * *"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/ingest/route.ts vercel.json
git commit -m "feat: add daily ingestion cron API route"
```

---

## Phase 3: Frontend

### Task 10: EventCard component

**Files:**
- Create: `components/EventCard.tsx`
- Create: `components/FeaturedBadge.tsx`

- [ ] **Step 1: Create FeaturedBadge**

Create `components/FeaturedBadge.tsx`:

```tsx
export function FeaturedBadge({ label = 'Featured' }: { label?: string }) {
  return (
    <span className="absolute top-2 left-2 z-10 bg-violet-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
      {label}
    </span>
  )
}
```

- [ ] **Step 2: Create EventCard**

Create `components/EventCard.tsx`:

```tsx
import Link from 'next/link'
import { Calendar, MapPin, DollarSign } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FeaturedBadge } from './FeaturedBadge'
import type { Event, Category } from '@/lib/supabase/types'

type Props = {
  event: Event & { categories?: Category[] }
  featured?: boolean
  featuredLabel?: string
}

export function EventCard({ event, featured = false, featuredLabel }: Props) {
  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const priceLabel = event.is_free
    ? 'Free'
    : event.price_min
    ? `$${event.price_min}${event.price_max && event.price_max !== event.price_min ? `–$${event.price_max}` : ''}`
    : null

  return (
    <Link href={`/events/${event.id}`} className="block group">
      <Card className={`relative overflow-hidden h-full transition-shadow hover:shadow-md ${featured ? 'ring-2 ring-violet-400' : ''}`}>
        {featured && <FeaturedBadge label={featuredLabel} />}

        {event.image_url ? (
          <div className="h-40 overflow-hidden bg-slate-100">
            <img
              src={event.image_url}
              alt={event.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        ) : (
          <div className="h-40 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <span className="text-4xl">🎉</span>
          </div>
        )}

        <CardContent className="p-4 space-y-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2">{event.title}</h3>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="w-3 h-3 shrink-0" />
            <span>{dateStr} · {timeStr}</span>
          </div>

          {event.venue_name && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{event.venue_name}</span>
            </div>
          )}

          {priceLabel && (
            <div className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <DollarSign className="w-3 h-3 shrink-0" />
              <span>{priceLabel}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1 pt-1">
            {event.categories?.slice(0, 3).map(cat => (
              <Badge
                key={cat.slug}
                variant="secondary"
                className="text-xs px-1.5 py-0"
                style={{ backgroundColor: cat.color + '22', color: cat.color, borderColor: cat.color + '44' }}
              >
                {cat.name}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
```

- [ ] **Step 3: Install lucide-react if not already present**

```bash
npm install lucide-react
```

- [ ] **Step 4: Commit**

```bash
git add components/EventCard.tsx components/FeaturedBadge.tsx
git commit -m "feat: add EventCard and FeaturedBadge components"
```

---

### Task 11: Events API route

**Files:**
- Create: `app/api/events/route.ts`

- [ ] **Step 1: Create events list API**

Create `app/api/events/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const categories = searchParams.getAll('category')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = 24
  const offset = (page - 1) * limit

  const supabase = await createClient()

  let query = supabase
    .from('events')
    .select(`
      *,
      categories:event_categories(
        category:categories(id, slug, name, color)
      ),
      featured:featured_listings(id, ad_label, starts_at, ends_at)
    `)
    .gte('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .range(offset, offset + limit - 1)

  if (q) {
    query = query.textSearch(
      'title',
      q,
      { type: 'websearch', config: 'english' }
    )
  }

  if (categories.length > 0) {
    // Filter events that have at least one matching category
    const { data: catData } = await supabase
      .from('categories')
      .select('id')
      .in('slug', categories)
    const catIds = (catData ?? []).map(c => c.id)

    if (catIds.length > 0) {
      const { data: eventIds } = await supabase
        .from('event_categories')
        .select('event_id')
        .in('category_id', catIds)
      const ids = [...new Set((eventIds ?? []).map(r => r.event_id))]
      query = query.in('id', ids)
    }
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Normalize nested joins
  const events = (data ?? []).map(event => {
    const now = new Date().toISOString()
    const activeFeatured = (event.featured ?? []).find(
      (f: { starts_at: string; ends_at: string }) => f.starts_at <= now && f.ends_at >= now
    )
    return {
      ...event,
      categories: (event.categories ?? []).map((ec: { category: unknown }) => ec.category),
      is_featured: !!activeFeatured,
      featured_label: activeFeatured?.ad_label ?? null,
      featured: undefined,
    }
  })

  return NextResponse.json({ events, page, limit })
}
```

- [ ] **Step 2: Create event detail API**

Create `app/api/events/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      categories:event_categories(
        category:categories(id, slug, name, color)
      )
    `)
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    ...data,
    categories: (data.categories ?? []).map((ec: { category: unknown }) => ec.category),
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/events/route.ts app/api/events/[id]/route.ts
git commit -m "feat: add events list and detail API routes"
```

---

### Task 12: SearchBar and SidebarFilters components

**Files:**
- Create: `components/SearchBar.tsx`
- Create: `components/SidebarFilters.tsx`

- [ ] **Step 1: Create SearchBar**

Create `components/SearchBar.tsx`:

```tsx
'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

export function SearchBar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const params = new URLSearchParams(searchParams.toString())
    if (e.target.value) {
      params.set('q', e.target.value)
    } else {
      params.delete('q')
    }
    params.delete('page')
    startTransition(() => router.push(`/?${params.toString()}`))
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        defaultValue={searchParams.get('q') ?? ''}
        onChange={handleChange}
        placeholder="Search events, venues…"
        className="pl-9"
      />
      {isPending && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create SidebarFilters**

Create `components/SidebarFilters.tsx`:

```tsx
'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { CATEGORIES } from '@/lib/categories'

export function SidebarFilters() {
  const router = useRouter()
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
    router.push(`/?${params.toString()}`)
  }

  return (
    <aside className="w-full space-y-3">
      <h2 className="font-semibold text-sm">Categories</h2>
      <Separator />
      <div className="space-y-2">
        {CATEGORIES.map(cat => (
          <div key={cat.slug} className="flex items-center gap-2">
            <Checkbox
              id={cat.slug}
              checked={selected.includes(cat.slug)}
              onCheckedChange={() => toggle(cat.slug)}
            />
            <Label htmlFor={cat.slug} className="flex items-center gap-1.5 cursor-pointer text-sm font-normal">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              {cat.name}
            </Label>
          </div>
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/SearchBar.tsx components/SidebarFilters.tsx
git commit -m "feat: add SearchBar and SidebarFilters components"
```

---

### Task 13: Main events page

**Files:**
- Create: `components/EventGrid.tsx`
- Create: `components/AdSlot.tsx`
- Modify: `app/(public)/page.tsx` (or `app/page.tsx`)

- [ ] **Step 1: Create AdSlot**

Create `components/AdSlot.tsx`:

```tsx
export function AdSlot({ slot }: { slot: string }) {
  return (
    <div
      className="border border-dashed border-slate-200 rounded-lg flex items-center justify-center bg-slate-50 h-40 text-slate-400 text-xs"
      data-ad-slot={slot}
    >
      Advertisement
    </div>
  )
}
```

- [ ] **Step 2: Create EventGrid**

Create `components/EventGrid.tsx`:

```tsx
import { EventCard } from './EventCard'
import { AdSlot } from './AdSlot'
import type { Event, Category } from '@/lib/supabase/types'

type EnrichedEvent = Event & { categories?: Category[]; is_featured?: boolean; featured_label?: string | null }

export function EventGrid({ events }: { events: EnrichedEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="col-span-full text-center py-16 text-muted-foreground">
        No events found. Try a different search or category.
      </div>
    )
  }

  const items: React.ReactNode[] = []

  events.forEach((event, i) => {
    items.push(
      <EventCard
        key={event.id}
        event={event}
        featured={event.is_featured}
        featuredLabel={event.featured_label ?? undefined}
      />
    )
    // Insert ad slot every 8 events
    if ((i + 1) % 8 === 0 && i < events.length - 1) {
      items.push(<AdSlot key={`ad-${i}`} slot={`grid-${i}`} />)
    }
  })

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items}
    </div>
  )
}
```

- [ ] **Step 3: Create main page**

Replace `app/page.tsx`:

```tsx
import { Suspense } from 'react'
import { SearchBar } from '@/components/SearchBar'
import { SidebarFilters } from '@/components/SidebarFilters'
import { EventGrid } from '@/components/EventGrid'

async function EventsLoader({ searchParams }: { searchParams: Record<string, string | string[]> }) {
  const url = new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL ? '' : 'http://localhost:3000'}/api/events`)

  const q = searchParams.q
  if (q) url.searchParams.set('q', typeof q === 'string' ? q : q[0])

  const cats = searchParams.category
  if (cats) {
    const arr = typeof cats === 'string' ? [cats] : cats
    arr.forEach(c => url.searchParams.append('category', c))
  }

  const res = await fetch(url.toString(), { cache: 'no-store' })
  const { events } = await res.json()

  return <EventGrid events={events ?? []} />
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>
}) {
  const params = await searchParams

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 z-40 bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <a href="/" className="font-bold text-lg text-violet-600 shrink-0">What It Do Austin</a>
          <div className="flex-1 max-w-xl">
            <Suspense>
              <SearchBar />
            </Suspense>
          </div>
          <a href="/subscribe" className="shrink-0 text-sm bg-violet-600 text-white px-3 py-1.5 rounded-md hover:bg-violet-700 transition-colors">
            Get Updates
          </a>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-8">
        {/* Sidebar */}
        <div className="hidden md:block w-48 shrink-0">
          <Suspense>
            <SidebarFilters />
          </Suspense>
        </div>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <Suspense fallback={<div className="text-muted-foreground text-sm">Loading events…</div>}>
            <EventsLoader searchParams={params} />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify the page loads**

```bash
npm run dev
```

Open http://localhost:3000 — you should see the header with search, sidebar with category filters, and an empty event grid (no events ingested yet). No console errors.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/EventGrid.tsx components/AdSlot.tsx
git commit -m "feat: add main events listing page with grid, search, and sidebar"
```

---

### Task 14: Event detail page

**Files:**
- Create: `app/events/[id]/page.tsx`

- [ ] **Step 1: Create detail page**

Create `app/events/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { Calendar, MapPin, ExternalLink, DollarSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Event, Category } from '@/lib/supabase/types'

async function getEvent(id: string): Promise<(Event & { categories?: Category[] }) | null> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const res = await fetch(`${baseUrl}/api/events/${id}`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await getEvent(id)

  if (!event) notFound()

  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const priceLabel = event.is_free ? 'Free' : event.price_min ? `$${event.price_min}` : 'See tickets'

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <a href="/" className="text-sm text-violet-600 hover:underline mb-4 inline-block">← Back to events</a>

      {event.image_url && (
        <img src={event.image_url} alt={event.title} className="w-full h-64 object-cover rounded-xl mb-6" />
      )}

      <div className="flex flex-wrap gap-1 mb-3">
        {event.categories?.map(cat => (
          <Badge key={cat.slug} style={{ backgroundColor: cat.color + '22', color: cat.color }}>
            {cat.name}
          </Badge>
        ))}
      </div>

      <h1 className="text-2xl font-bold mb-4">{event.title}</h1>

      <div className="space-y-2 mb-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-2"><Calendar className="w-4 h-4" />{dateStr} at {timeStr}</div>
        {event.venue_name && <div className="flex items-center gap-2"><MapPin className="w-4 h-4" />{event.venue_name}{event.venue_address ? ` · ${event.venue_address}` : ''}</div>}
        {<div className="flex items-center gap-2"><DollarSign className="w-4 h-4" />{priceLabel}</div>}
      </div>

      {event.description && <p className="text-sm leading-relaxed mb-6 whitespace-pre-line">{event.description}</p>}

      {event.ticket_url && (
        <Button asChild className="bg-violet-600 hover:bg-violet-700">
          <a href={event.ticket_url} target="_blank" rel="noopener noreferrer">
            Get Tickets <ExternalLink className="w-4 h-4 ml-1" />
          </a>
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/events/[id]/page.tsx
git commit -m "feat: add event detail page"
```

---

## Phase 4: Subscriptions & Email

### Task 15: Subscribe API route

**Files:**
- Create: `app/api/subscribe/route.ts`
- Create: `app/api/unsubscribe/route.ts`

- [ ] **Step 1: Create subscribe API**

Create `app/api/subscribe/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { CATEGORY_SLUGS } from '@/lib/categories'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { email, frequency = 'daily', category_slugs = [] } = body

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const validSlugs = category_slugs.filter((s: string) => CATEGORY_SLUGS.includes(s))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('subscriptions')
    .upsert({ email, frequency, category_slugs: validSlugs }, { onConflict: 'email' })
    .select('token')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
  }

  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${data.token}`

  await resend.emails.send({
    from: 'What It Do Austin <updates@whatitdo.app>',
    to: email,
    subject: 'Confirm your Austin events subscription',
    html: `
      <h2>You're almost in!</h2>
      <p>You signed up for ${frequency} Austin events updates${validSlugs.length ? ` for: ${validSlugs.join(', ')}` : ' (all categories)'}.</p>
      <p>Your first digest will arrive tomorrow morning.</p>
      <p style="margin-top:32px;font-size:12px;color:#888">
        <a href="${unsubscribeUrl}">Unsubscribe</a>
      </p>
    `,
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Create unsubscribe API**

Create `app/api/unsubscribe/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/', req.url))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  await supabase.from('subscriptions').delete().eq('token', token)

  return new NextResponse(
    `<html><body style="font-family:sans-serif;max-width:400px;margin:80px auto;text-align:center">
      <h2>Unsubscribed</h2>
      <p>You've been removed from the Austin events list.</p>
      <a href="/">Back to events</a>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/subscribe/route.ts app/api/unsubscribe/route.ts
git commit -m "feat: add subscribe and unsubscribe API routes"
```

---

### Task 16: Subscribe page UI

**Files:**
- Create: `app/subscribe/page.tsx`
- Create: `components/SubscribeForm.tsx`

- [ ] **Step 1: Create SubscribeForm**

Create `components/SubscribeForm.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { CATEGORIES } from '@/lib/categories'

export function SubscribeForm() {
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
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, frequency, category_slugs: selected }),
    })
    setStatus(res.ok ? 'success' : 'error')
  }

  if (status === 'success') {
    return (
      <div className="text-center py-8">
        <p className="text-2xl mb-2">🎉</p>
        <h2 className="text-lg font-semibold mb-1">You&apos;re subscribed!</h2>
        <p className="text-sm text-muted-foreground">Check your inbox — your first digest arrives tomorrow morning.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1"
        />
      </div>

      <div>
        <Label>Frequency</Label>
        <div className="flex gap-4 mt-2">
          {(['daily', 'weekly'] as const).map(f => (
            <label key={f} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={f} checked={frequency === f} onChange={() => setFrequency(f)} />
              <span className="text-sm capitalize">{f}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label>Categories <span className="text-muted-foreground font-normal">(leave all unchecked for everything)</span></Label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {CATEGORIES.map(cat => (
            <label key={cat.slug} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={selected.includes(cat.slug)}
                onCheckedChange={() => toggleCat(cat.slug)}
              />
              <span className="text-sm">{cat.name}</span>
            </label>
          ))}
        </div>
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-500">Something went wrong. Please try again.</p>
      )}

      <Button type="submit" disabled={status === 'loading'} className="w-full bg-violet-600 hover:bg-violet-700">
        {status === 'loading' ? 'Subscribing…' : 'Subscribe to updates'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Create subscribe page**

Create `app/subscribe/page.tsx`:

```tsx
import { SubscribeForm } from '@/components/SubscribeForm'

export default function SubscribePage() {
  return (
    <div className="min-h-screen bg-background flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-md">
        <a href="/" className="text-sm text-violet-600 hover:underline mb-6 inline-block">← Back to events</a>
        <h1 className="text-2xl font-bold mb-1">Get Austin events in your inbox</h1>
        <p className="text-sm text-muted-foreground mb-8">
          We scan the web daily for Austin events and send you a curated digest. No spam — ever.
        </p>
        <SubscribeForm />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/subscribe/page.tsx components/SubscribeForm.tsx
git commit -m "feat: add email subscription page and form"
```

---

### Task 17: Email digest cron

**Files:**
- Create: `lib/email/digest.ts`
- Create: `app/api/email/digest/route.ts`

- [ ] **Step 1: Create digest builder**

Create `lib/email/digest.ts`:

```typescript
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import type { Event, Category } from '@/lib/supabase/types'

const resend = new Resend(process.env.RESEND_API_KEY)

type EventWithCats = Event & { categories?: Category[] }

function buildDigestHtml(events: EventWithCats[], unsubscribeUrl: string): string {
  const eventHtml = events.slice(0, 15).map(e => {
    const date = new Date(e.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const cats = (e.categories ?? []).map(c => c.name).join(', ')
    return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:12px">
        ${e.image_url ? `<img src="${e.image_url}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:4px;margin-bottom:12px">` : ''}
        <p style="font-size:12px;color:#7c3aed;margin:0 0 4px">${cats}</p>
        <h3 style="margin:0 0 8px;font-size:16px">${e.title}</h3>
        <p style="margin:0 0 4px;font-size:13px;color:#666">${date}</p>
        ${e.venue_name ? `<p style="margin:0 0 12px;font-size:13px;color:#666">${e.venue_name}</p>` : ''}
        ${e.ticket_url ? `<a href="${e.ticket_url}" style="color:#7c3aed;font-size:13px">View event →</a>` : ''}
      </div>
    `
  }).join('')

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h1 style="color:#7c3aed;margin-bottom:4px">What It Do Austin</h1>
      <p style="color:#666;margin-bottom:24px">Your daily Austin events digest</p>
      ${eventHtml}
      <p style="margin-top:32px;font-size:12px;color:#999">
        <a href="${unsubscribeUrl}" style="color:#999">Unsubscribe</a>
      </p>
    </div>
  `
}

export async function sendDailyDigests() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

  // Fetch all daily subscribers
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('frequency', 'daily')

  if (!subs?.length) return { sent: 0 }

  // Fetch today's events
  const today = new Date()
  const tomorrow = new Date(today.getTime() + 86400000)
  const { data: allEvents } = await supabase
    .from('events')
    .select(`*, categories:event_categories(category:categories(id,slug,name,color))`)
    .gte('start_time', today.toISOString())
    .lte('start_time', tomorrow.toISOString())
    .order('start_time', { ascending: true })

  const events: EventWithCats[] = (allEvents ?? []).map(e => ({
    ...e,
    categories: (e.categories ?? []).map((ec: { category: Category }) => ec.category),
  }))

  let sent = 0

  for (const sub of subs) {
    // Filter by subscriber's category preferences
    const filtered = sub.category_slugs?.length
      ? events.filter(e => e.categories?.some(c => sub.category_slugs.includes(c.slug)))
      : events

    if (!filtered.length) continue

    const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${sub.token}`

    await resend.emails.send({
      from: 'What It Do Austin <updates@whatitdo.app>',
      to: sub.email,
      subject: `Austin events today — ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
      html: buildDigestHtml(filtered, unsubscribeUrl),
    })

    sent++
  }

  return { sent }
}
```

- [ ] **Step 2: Create digest cron route**

Create `app/api/email/digest/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { sendDailyDigests } from '@/lib/email/digest'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sendDailyDigests()
  return NextResponse.json(result)
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/email/digest.ts app/api/email/digest/route.ts
git commit -m "feat: add email digest builder and cron route"
```

---

## Phase 5: Monetization

### Task 18: Featured listings API

**Files:**
- Create: `app/api/featured/route.ts`

- [ ] **Step 1: Create featured listings API**

Create `app/api/featured/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// This route is admin-only — secured with CRON_SECRET for now
// Replace with proper admin auth before launch
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { event_id, starts_at, ends_at, ad_label = 'Featured' } = body

  if (!event_id || !starts_at || !ends_at) {
    return NextResponse.json({ error: 'event_id, starts_at, ends_at are required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('featured_listings')
    .insert({ event_id, starts_at, ends_at, ad_label })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/featured/route.ts
git commit -m "feat: add featured listings API route"
```

---

## Phase 6: Deployment

### Task 19: Deploy to Vercel

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Update next.config.ts for image domains**

Modify `next.config.ts`:

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.eventbrite.com' },
      { protocol: 'https', hostname: '**.eventbritecdn.com' },
      { protocol: 'https', hostname: '**.do512.com' },
      { protocol: 'https', hostname: '**.austinchronicle.com' },
    ],
  },
}

export default nextConfig
```

- [ ] **Step 2: Ensure TypeScript builds clean**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors. Note any warnings and fix type errors.

- [ ] **Step 3: Create Supabase project**

1. Go to https://supabase.com/dashboard
2. Create a new project named `whatitdo`
3. Copy the Project URL and anon key from Project Settings > API
4. Copy the service_role key (keep secret)
5. Run all three SQL migrations in the Supabase SQL editor

- [ ] **Step 4: Set up Resend**

1. Go to https://resend.com and create an account
2. Verify your sending domain (whatitdo.app or use their sandbox domain for testing)
3. Create an API key and copy it

- [ ] **Step 5: Get Eventbrite API token**

1. Go to https://www.eventbrite.com/platform/api and create an app
2. Copy the Private Token

- [ ] **Step 6: Deploy to Vercel**

```bash
npx vercel --yes
```

When prompted, link to a new project named `whatitdo`.

- [ ] **Step 7: Set environment variables on Vercel**

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add ANTHROPIC_API_KEY production
npx vercel env add RESEND_API_KEY production
npx vercel env add EVENTBRITE_TOKEN production
npx vercel env add CRON_SECRET production
```

- [ ] **Step 8: Trigger first ingest manually**

```bash
curl -X POST https://your-app.vercel.app/api/ingest \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected: JSON response `{"inserted": N, "skipped": M, "total": T}` — should show events inserted.

- [ ] **Step 9: Verify events appear**

Open https://your-app.vercel.app — the event grid should now show Austin events with category badges. Search and filters should work.

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "feat: production-ready Austin events aggregator"
git push origin main
```

---

## Verification Checklist

- [ ] `npm run build` passes with no errors
- [ ] Events page loads at localhost:3000 with search, filters, grid
- [ ] `/api/ingest` inserts events from at least one source
- [ ] Event cards show category badges with correct colors
- [ ] Clicking an event card opens the detail page
- [ ] `/subscribe` page submits and sends confirmation email
- [ ] `/api/unsubscribe?token=X` deletes the subscription
- [ ] Featured events show purple badge and ring
- [ ] Ad slots appear every 8 events in the grid
- [ ] Mobile layout is usable (sidebar hidden, search in header)

---

## Notes

- **Selector maintenance:** The Austin Chronicle and Do512 scrapers use CSS selectors that will drift as sites update. Expect to maintain these every few months.
- **Eventbrite API key:** Requires an Eventbrite developer account. The public search endpoint requires OAuth for production scale.
- **Rate limits:** Claude Haiku tagging costs ~$0.0003 per event. At 500 events/day that's $4.50/month.
- **Admin UI:** The featured listings API uses `CRON_SECRET` as a temporary auth mechanism. Build a proper admin dashboard before taking payments.
- **Email domain:** Resend requires a verified domain for production sends. Use their sandbox for testing.
