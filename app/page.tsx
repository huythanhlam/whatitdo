import { Suspense } from 'react'
import Link from 'next/link'
import { SearchBar } from '@/components/SearchBar'
import { SidebarFilters } from '@/components/SidebarFilters'
import { EventList } from '@/components/EventList'
import { CalendarView } from '@/components/CalendarView'
import { ViewToggle } from '@/components/ViewToggle'
import { listEvents, countEvents } from '@/lib/db'
import { resolveDateRange } from '@/lib/dateRanges'
import { gridRangeIso, currentCentralMonth } from '@/lib/calendar'
import { DateFilter } from '@/components/DateFilter'
import type { EnrichedEvent } from '@/lib/types'

export const dynamic = 'force-dynamic'

function first(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined
}

function toCategories(cats: string | string[] | undefined): string[] {
  return cats ? (typeof cats === 'string' ? [cats] : cats) : []
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
async function CalendarLoader({ searchParams }: { searchParams: Record<string, string | string[]> }) {
  const q = first(searchParams.q) ?? ''
  const categories = toCategories(searchParams.category)
  const { year, month } = parseCalMonth(first(searchParams.cal))
  const { fromIso, toIso } = gridRangeIso(year, month)

  const events = await listEvents({ q, categories, from: fromIso, to: toIso, limit: 1000, offset: 0 })

  const qs = new URLSearchParams()
  if (q) qs.set('q', q)
  categories.forEach(c => qs.append('category', c))

  return (
    <CalendarView
      events={events as unknown as EnrichedEvent[]}
      year={year}
      month={month}
      filterQs={qs.toString()}
    />
  )
}

async function EventsLoader({ searchParams }: { searchParams: Record<string, string | string[]> }) {
  const q = first(searchParams.q) ?? ''
  const categories = toCategories(searchParams.category)

  const range = resolveDateRange({
    when: first(searchParams.when),
    from: first(searchParams.from),
    to: first(searchParams.to),
  })

  // A DB failure here propagates to the route error boundary (app/error.tsx)
  // rather than being masked as "no events" — an outage should look different
  // from an empty result.
  const filterArgs = { q, categories, from: range.fromIso, to: range.toIso ?? undefined }
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
  const when = first(searchParams.when); if (when) qs.set('when', when)
  const fromP = first(searchParams.from); if (fromP) qs.set('from', fromP)
  const toP = first(searchParams.to); if (toP) qs.set('to', toP)

  return <EventList initialEvents={events as unknown as EnrichedEvent[]} query={qs.toString()} total={total} />
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>
}) {
  const params = await searchParams
  const view = first(params.view) === 'calendar' ? 'calendar' : 'grid'

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 z-40 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/" className="font-bold text-lg text-violet-600 shrink-0 whitespace-nowrap">
            🎉 What It Do ATX
          </Link>
          <div className="flex-1 max-w-xl">
            <Suspense fallback={<div className="h-9 bg-slate-100 rounded-md animate-pulse" />}>
              <SearchBar />
            </Suspense>
          </div>
          <Link
            href="/subscribe"
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
            <h1 className="text-lg font-semibold text-slate-800">Austin Events</h1>
            <Suspense fallback={<div className="h-9 w-32 bg-slate-100 rounded-lg animate-pulse" />}>
              <ViewToggle />
            </Suspense>
          </div>

          {/* Category filters on mobile (sidebar is hidden < md) */}
          <div className="md:hidden mb-5">
            <Suspense>
              <SidebarFilters compact />
            </Suspense>
          </div>

          {view === 'calendar' ? (
            <Suspense fallback={<div className="h-96 bg-slate-100 rounded-lg animate-pulse" />}>
              <CalendarLoader searchParams={params} />
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
                <EventsLoader searchParams={params} />
              </Suspense>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
