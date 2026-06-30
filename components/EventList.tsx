'use client'
import { useState } from 'react'
import { EventGrid } from './EventGrid'
import type { Event, Category } from '@/lib/supabase/types'

type EnrichedEvent = Event & { categories?: Category[]; is_featured?: boolean; featured_label?: string | null }

const PAGE_SIZE = 24

// Renders the initial (server-fetched) page, then appends further pages from
// /api/events on demand, preserving the active filters via `query`.
export function EventList({ initialEvents, query }: { initialEvents: EnrichedEvent[]; query: string }) {
  const [events, setEvents] = useState<EnrichedEvent[]>(initialEvents)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(initialEvents.length < PAGE_SIZE)

  async function loadMore() {
    setLoading(true)
    try {
      const next = page + 1
      const sep = query ? '&' : ''
      const res = await fetch(`/api/events?${query}${sep}page=${next}`, { cache: 'no-store' })
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
      <EventGrid events={events} />
      {!done && events.length > 0 && (
        <div className="flex justify-center mt-8">
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-6 py-2.5 rounded-full bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading…' : 'Load more events'}
          </button>
        </div>
      )}
      {done && events.length >= PAGE_SIZE && (
        <p className="text-center text-sm text-muted-foreground mt-8">That&apos;s all {events.length} events.</p>
      )}
    </div>
  )
}
