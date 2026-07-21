import { Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { MapPin, ArrowRight } from 'lucide-react'
import { SearchBar } from '@/components/SearchBar'
import { SidebarFilters } from '@/components/SidebarFilters'
import { SourceFilter } from '@/components/SourceFilter'
import { EventList } from '@/components/EventList'
import { CalendarView } from '@/components/CalendarView'
import { MapView } from '@/components/MapView'
import { ViewToggle } from '@/components/ViewToggle'
import { HeroCarousel } from '@/components/HeroCarousel'
import { CategoryCarousel } from '@/components/CategoryCarousel'
import { RecRail } from '@/components/RecRail'
import { InteractionProvider } from '@/components/InteractionProvider'
import { RewardsProvider } from '@/components/RewardsProvider'
import { AuthNav } from '@/components/AuthNav'
import { getUser } from '@/lib/auth/server'
import { BackToTopButton } from '@/components/BackToTopButton'
import { HeaderHeightSync } from '@/components/HeaderHeightSync'
import { listEvents, countEvents, listEventsForMap, getDistinctSources, type City } from '@/lib/db'
import { requireCity } from '@/lib/cities'
import { resolveDateRange } from '@/lib/dateRanges'
import { gridRangeIso, currentCentralMonth } from '@/lib/calendar'
import { DateFilter } from '@/components/DateFilter'
import { SEO_PAGES } from '@/lib/seoPages'
import { isRecsCity } from '@/lib/recs/config'
import { eventListJsonLd, jsonLdHtml } from '@/lib/jsonLd'
import type { EnrichedEvent } from '@/lib/types'

// Rendered per request: the layout depends on whether the visitor is signed in
// (logged-out sees a landing with categories + trending; signed-in sees trending
// + suggested + the full list), which is read from the Supabase session server-
// side, so this page can't be statically cached.
export const dynamic = 'force-dynamic'

// The flagship page for "<city> events" search intent. The parent
// app/[city]/layout.tsx already sets a per-city title/description/OG; here we
// (a) pin the self-referencing canonical so query-param variants
// (?view=/?category=/?when=…) all consolidate to the clean /<city> URL instead
// of diluting ranking, and (b) tighten the home title/description with the
// primary keyword. openGraph/twitter are intentionally left to the layout so
// the city OG image (og-austin.png) is preserved.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)
  return {
    title: {
      absolute: `${city.name} Events — Concerts, Live Music & Things To Do | Whats Happenin`,
    },
    description: `Find things to do in ${city.name}, ${city.state}: browse concerts, live music, festivals, comedy, food & drink, and free events — aggregated daily and searchable by date and category.`,
    alternates: { canonical: `/${citySlug}` },
  }
}

function first(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined
}

function toCategories(cats: string | string[] | undefined): string[] {
  return cats ? (typeof cats === 'string' ? [cats] : cats) : []
}

function toSources(sources: string | string[] | undefined): string[] {
  return sources ? (typeof sources === 'string' ? [sources] : sources) : []
}

// The calendar's visible month is URL state (?cal=YYYY-MM, 1-indexed); default
// to the current Central-time month.
function parseCalMonth(cal: string | undefined): { year: number; month: number } {
  const m = cal ? /^(\d{4})-(\d{2})$/.exec(cal) : null
  if (m) {
    const year = +m[1]
    const month = +m[2] - 1
    if (month >= 0 && month <= 11) return { year, month }
  }
  return currentCentralMonth()
}

// Server-fetch the visible month window and hand it to the (now server-rendered)
// calendar — matching the app's RSC-with-direct-DB pattern instead of a client
// useEffect fetch of up to 1000 events.
async function CalendarLoader({ city, searchParams }: { city: City; searchParams: Record<string, string | string[]> }) {
  const q = first(searchParams.q) ?? ''
  const categories = toCategories(searchParams.category)
  const sources = toSources(searchParams.source)
  const { year, month } = parseCalMonth(first(searchParams.cal))
  const { fromIso, toIso } = gridRangeIso(year, month)

  const events = await listEvents({ cityId: city.id, q, categories, sources, from: fromIso, to: toIso, limit: 1000, offset: 0 })

  const qs = new URLSearchParams()
  if (q) qs.set('q', q)
  categories.forEach(c => qs.append('category', c))
  sources.forEach(s => qs.append('source', s))

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

// Unlike CalendarLoader, the map respects the same q/category/date-range
// filters as the grid (via listEventsForMap), so it needs the same
// resolveDateRange call as EventsLoader — just without pagination, since the
// map wants every matching pin, not one page of 24.
async function MapLoader({ city, searchParams }: { city: City; searchParams: Record<string, string | string[]> }) {
  const q = first(searchParams.q) ?? ''
  const categories = toCategories(searchParams.category)
  const sources = toSources(searchParams.source)
  const range = resolveDateRange({
    when: first(searchParams.when),
    from: first(searchParams.from),
    to: first(searchParams.to),
  })

  const events = await listEventsForMap({
    cityId: city.id, q, categories, sources, from: range.fromIso, to: range.toIso ?? undefined, limit: 1000,
  })

  const center = city.lat != null && city.lng != null
    ? { lat: Number(city.lat), lng: Number(city.lng) }
    : { lat: 30.2672, lng: -97.7431 } // Austin fallback, only hit if a city row has no lat/lng set

  return <MapView events={events as unknown as EnrichedEvent[]} center={center} basePath={`/${city.slug}`} />
}

// Pulls a small window of the soonest upcoming events for the hero showcase,
// preferring ones with an image (the carousel still renders a gradient card
// for the rest, but a batch of all-text slides looks broken). Falls back to
// the plain chronological batch if none of the nearest events have art.
async function HeroLoader({ city, basePath }: { city: City; basePath: string }) {
  const events = await listEvents({ cityId: city.id, limit: 12, offset: 0 })
  const withImages = events.filter(e => e.image_url)
  const slides = (withImages.length > 0 ? withImages : events).slice(0, 6) as unknown as EnrichedEvent[]
  return <HeroCarousel events={slides} basePath={basePath} />
}

async function EventsLoader({ city, searchParams }: { city: City; searchParams: Record<string, string | string[]> }) {
  const q = first(searchParams.q) ?? ''
  const categories = toCategories(searchParams.category)
  const sources = toSources(searchParams.source)

  const range = resolveDateRange({
    when: first(searchParams.when),
    from: first(searchParams.from),
    to: first(searchParams.to),
  })

  // A DB failure here propagates to the route error boundary (app/error.tsx)
  // rather than being masked as "no events" — an outage should look different
  // from an empty result.
  const filterArgs = { cityId: city.id, q, categories, sources, from: range.fromIso, to: range.toIso ?? undefined }
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

  // Build the filter query string (sans page) so Load More keeps the filters.
  const qs = new URLSearchParams()
  if (q) qs.set('q', q)
  categories.forEach(c => qs.append('category', c))
  sources.forEach(s => qs.append('source', s))
  const when = first(searchParams.when); if (when) qs.set('when', when)
  const fromP = first(searchParams.from); if (fromP) qs.set('from', fromP)
  const toP = first(searchParams.to); if (toP) qs.set('to', toP)

  return (
    <EventList
      // Remount when the filter query string changes so EventList's internal
      // events/page/done state (seeded once from initialEvents on mount) resets
      // to match the new server-filtered results, instead of a stale client-side
      // navigation leaving the previous filter's events on screen.
      key={qs.toString()}
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
  const rawView = first(sp.view)
  const view = rawView === 'calendar' ? 'calendar' : rawView === 'map' ? 'map' : 'grid'
  const base = `/${city.slug}`
  const sources = await getDistinctSources(city.id)

  // ItemList of the soonest upcoming events so Google reads the home page as a
  // collection of events (event carousel eligibility) — not just each detail
  // page. A small dedicated read; the grid below paginates its own results.
  const jsonLdEvents = await listEvents({ cityId: city.id, limit: 15, offset: 0 })
  const listJsonLd = jsonLdEvents.length
    ? jsonLdHtml(eventListJsonLd(jsonLdEvents as unknown as EnrichedEvent[], city.slug, city))
    : null

  // Signed-in visitors get the personalized layout; the catalog is Austin-only
  // for recs, so other cities keep the classic category + list experience.
  const { user } = await getUser()
  const authed = !!user
  const recs = isRecsCity(citySlug)

  // On a recs city, a logged-out visitor's landing CTAs route through the /join
  // registration gate (which motivates sign-up, then onboards, then lands them
  // on the promised view). Signed-in visitors — and non-recs cities, which have
  // no auth/onboarding surface — keep the direct deep links.
  const gated = recs && !authed
  const browseHref = gated ? `${base}/join?intent=browse` : `${base}#events`
  const weekendHref = gated ? `${base}/join?intent=weekend` : `${base}?when=weekend#events`

  return (
    <div className="min-h-screen bg-background">
      {listJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: listJsonLd }} />
      )}
      <HeaderHeightSync />
      {/* Neutral dark-gray in dark mode (not the teal-tinted card color). */}
      <header className="border-b border-border sticky top-0 z-40 bg-card/95 dark:bg-ink-800/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          {/* Logo — left. Wordmark set in the repo display font (Unbounded). */}
          <Link href={base} aria-label="Whats Happenin" className="flex items-center gap-2 shrink-0">
            <Image src="/logo-icon.svg" alt="" aria-hidden="true" width={36} height={36} className="h-9 w-9 rounded-xl" priority />
            <span className="font-display text-lg sm:text-xl font-semibold tracking-tight text-foreground whitespace-nowrap">
              Whats Happenin
            </span>
          </Link>
          {/* Search — reduced width; wraps to its own full-width row on mobile. */}
          <div className="order-3 w-full sm:order-none sm:w-56 md:w-72">
            <Suspense fallback={<div className="h-9 bg-muted rounded-md animate-pulse" />}>
              <SearchBar />
            </Suspense>
          </div>
          {/* Right cluster — pushed to the right edge, leaving empty space to its left. */}
          <div className="order-2 sm:order-none ml-auto flex items-center gap-3 sm:gap-4">
            <Link
              href={`${base}/submit`}
              className="hidden sm:inline shrink-0 text-sm text-muted-foreground hover:text-primary font-medium"
            >
              Submit an event
            </Link>
            <Link
              href={`${base}/subscribe`}
              className="shrink-0 text-sm bg-primary text-primary-foreground px-3.5 py-2 sm:px-4 rounded-full hover:bg-primary/90 transition-colors font-semibold"
            >
              Get Updates
            </Link>
            {/* Auth-aware, Austin-only at launch. Client island so the ISR-cached
                header HTML stays impersonal (see components/AuthNav.tsx). */}
            {isRecsCity(citySlug) && <AuthNav />}
          </div>
        </div>
      </header>

      {/* Hero — headline, search CTAs, and a rotating showcase of what's coming
          up, in the spirit of Meetup/Eventbrite's home hero. */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--color-coral-500), transparent 70%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-16 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--color-slate-500), transparent 70%)' }}
        />

        <div className="relative max-w-7xl mx-auto px-4 py-10 sm:py-16 grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div style={{ animation: 'fade-up 0.5s ease-out both' }}>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary mb-4">
              <MapPin className="w-3.5 h-3.5" /> {city.name}, {city.state}
            </p>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.4rem] font-semibold leading-[1.05] text-foreground text-balance">
              {city.name} events: find your next favorite thing to do
            </h1>
            <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-md text-balance">
              Concerts, festivals, comedy, food &amp; drink, arts, and more — aggregated daily across {city.name}.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href={browseHref}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Browse Events <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href={weekendHref}
                className="inline-flex items-center rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:border-primary hover:text-primary transition-colors"
              >
                This Weekend
              </Link>
              <Link
                href={`${base}/submit`}
                className="inline-flex items-center gap-1 px-2 py-3 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors"
              >
                Submit an event <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <Suspense fallback={<div className="aspect-[16/9] sm:aspect-[21/9] w-full rounded-2xl bg-muted animate-pulse" />}>
            <HeroLoader city={city} basePath={base} />
          </Suspense>
        </div>
      </section>

      {/* Two views. Logged-out (or non-recs cities): Browse by Category, then a
          Trending rail — a landing, no full list. Signed-in: Trending + Suggested
          rails, then the full events list; no category row. The provider gives
          every EventCard working save/interested/hide buttons for signed-in users. */}
      <InteractionProvider city={city.slug} authed={recs && authed}>
        <RewardsProvider>
        {/* Browse by category — a bold, single-click way into a filtered result
            set; SidebarFilters below still handles multi-select refinement. */}
        {(!recs || !authed) && (
          <section className="border-b border-border bg-card/50">
            <div className="max-w-7xl mx-auto px-4 py-6">
              <h2 className="font-display text-lg font-semibold text-foreground mb-3">Browse by category</h2>
              <CategoryCarousel basePath={base} gated={gated} />
            </div>
          </section>
        )}

        {recs && <RecRail city={city.slug} basePath={base} mode="trending" />}
        {recs && authed && <RecRail city={city.slug} basePath={base} mode="suggested" />}

        {(!recs || authed) && (
      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-8">
        <div
          className="hidden md:block w-52 shrink-0 self-start sticky max-h-[calc(100vh-6rem)] overflow-y-auto pt-1 space-y-6"
          style={{ top: 'var(--header-h, 5rem)' }}
        >
          <Suspense>
            <SidebarFilters />
          </Suspense>
          <Suspense>
            <SourceFilter sources={sources} />
          </Suspense>
        </div>

        <main id="events" className="flex-1 min-w-0 scroll-mt-20">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-foreground">{city.name} Events</h2>
            <Suspense fallback={<div className="h-9 w-32 bg-muted rounded-lg animate-pulse" />}>
              <ViewToggle />
            </Suspense>
          </div>

          <div className="flex flex-wrap gap-3 mb-4 text-xs">
            {SEO_PAGES.map(p => (
              <Link key={p.slug} href={`${base}/${p.slug}`} className="text-primary hover:underline">
                {p.title}
              </Link>
            ))}
          </div>

          {/* Category + source filters on mobile (sidebar is hidden < md).
              Sticky right below the header — offset via --header-h (set by
              HeaderHeightSync) rather than a hardcoded pixel value, since the
              header wraps to a taller layout on mobile and its exact height
              varies with content/font metrics. */}
          <div
            className="md:hidden sticky z-30 -mx-4 px-4 py-3 mb-5 space-y-2 bg-background/95 backdrop-blur-sm border-b border-border"
            style={{ top: 'var(--header-h, 10rem)' }}
          >
            <Suspense>
              <SidebarFilters compact />
            </Suspense>
            <Suspense>
              <SourceFilter sources={sources} compact />
            </Suspense>
          </div>

          {view === 'calendar' ? (
            <Suspense fallback={<div className="h-96 bg-muted rounded-lg animate-pulse" />}>
              <CalendarLoader city={city} searchParams={sp} />
            </Suspense>
          ) : view === 'map' ? (
            <>
              <Suspense fallback={<div className="h-9 bg-muted rounded-md animate-pulse mb-5" />}>
                <DateFilter />
              </Suspense>
              <Suspense fallback={<div className="h-[600px] bg-muted rounded-lg animate-pulse" />}>
                <MapLoader city={city} searchParams={sp} />
              </Suspense>
            </>
          ) : (
            <>
              <Suspense fallback={<div className="h-9 bg-muted rounded-md animate-pulse mb-5" />}>
                <DateFilter />
              </Suspense>
              <Suspense fallback={
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array(6).fill(0).map((_, i) => (
                    <div key={i} className="h-64 bg-muted rounded-xl animate-pulse" />
                  ))}
                </div>
              }>
                <EventsLoader city={city} searchParams={sp} />
              </Suspense>
            </>
          )}
        </main>
      </div>
        )}
        </RewardsProvider>
      </InteractionProvider>

      <BackToTopButton />
    </div>
  )
}
