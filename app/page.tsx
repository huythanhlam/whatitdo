import { Suspense } from 'react'
import { SearchBar } from '@/components/SearchBar'
import { SidebarFilters } from '@/components/SidebarFilters'
import { EventGrid } from '@/components/EventGrid'
import type { Event, Category } from '@/lib/supabase/types'

type EnrichedEvent = Event & { categories?: Category[]; is_featured?: boolean; featured_label?: string | null }

async function EventsLoader({ searchParams }: { searchParams: Record<string, string | string[]> }) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const url = new URL(`${baseUrl}/api/events`)
  const q = searchParams.q
  if (q) url.searchParams.set('q', typeof q === 'string' ? q : q[0])

  const cats = searchParams.category
  if (cats) {
    const arr = typeof cats === 'string' ? [cats] : cats
    arr.forEach(c => url.searchParams.append('category', c))
  }

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' })
    const { events } = await res.json() as { events: EnrichedEvent[] }
    return <EventGrid events={events ?? []} />
  } catch {
    return <EventGrid events={[]} />
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>
}) {
  const params = await searchParams

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 z-40 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <a href="/" className="font-bold text-lg text-violet-600 shrink-0 whitespace-nowrap">
            🎉 What It Do ATX
          </a>
          <div className="flex-1 max-w-xl">
            <Suspense fallback={<div className="h-9 bg-slate-100 rounded-md animate-pulse" />}>
              <SearchBar />
            </Suspense>
          </div>
          <a
            href="/subscribe"
            className="shrink-0 text-sm bg-violet-600 text-white px-3 py-1.5 rounded-md hover:bg-violet-700 transition-colors font-medium"
          >
            Get Updates
          </a>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-8">
        <div className="hidden md:block w-52 shrink-0 pt-1">
          <Suspense>
            <SidebarFilters />
          </Suspense>
        </div>

        <main className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-semibold text-slate-800">Austin Events</h1>
          </div>
          <Suspense fallback={
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-64 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          }>
            <EventsLoader searchParams={params} />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
