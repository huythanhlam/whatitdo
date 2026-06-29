import { Suspense } from 'react'
import { SearchBar } from '@/components/SearchBar'
import { SidebarFilters } from '@/components/SidebarFilters'
import { EventGrid } from '@/components/EventGrid'
import { listEvents } from '@/lib/db'
import type { Event, Category } from '@/lib/supabase/types'

type EnrichedEvent = Event & { categories?: Category[]; is_featured?: boolean; featured_label?: string | null }

export const dynamic = 'force-dynamic'

async function EventsLoader({ searchParams }: { searchParams: Record<string, string | string[]> }) {
  const q = typeof searchParams.q === 'string' ? searchParams.q : Array.isArray(searchParams.q) ? searchParams.q[0] : ''
  const cats = searchParams.category
  const categories = cats ? (typeof cats === 'string' ? [cats] : cats) : []

  try {
    const events = await listEvents({ q, categories, limit: 24, offset: 0 })
    return <EventGrid events={events as unknown as EnrichedEvent[]} />
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
