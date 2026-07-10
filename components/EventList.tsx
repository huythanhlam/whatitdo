'use client'
import { useState } from 'react'
import { EventGrid } from './EventGrid'
import type { EnrichedEvent } from '@/lib/types'

const PAGE_SIZE = 24

// Renders the initial (server-fetched) page, then appends further pages from
// /api/events on demand, preserving the active filters via `query`.
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
        Showing <span className="font-medium text-foreground">{events.length}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span> {total === 1 ? 'event' : 'events'}
      </p>
      <EventGrid events={events} basePath={basePath} />
      {!done && events.length > 0 && (
        <div className="flex justify-center mt-8">
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-6 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
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
