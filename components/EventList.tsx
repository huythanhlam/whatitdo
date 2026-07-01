'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { EventGrid } from './EventGrid'
import type { Event, Category } from '@/lib/supabase/types'

type EnrichedEvent = Event & { categories?: Category[]; is_featured?: boolean; featured_label?: string | null }

const PAGE_SIZE = 24

// Renders the initial (server-fetched) page, then auto-appends further pages
// from /api/events via an IntersectionObserver as the user nears the bottom
// (infinite scroll), preserving the active filters via `query`. A manual button
// remains as a fallback for keyboard users and environments without the observer.
export function EventList({ initialEvents, query, total }: { initialEvents: EnrichedEvent[]; query: string; total: number }) {
  const [events, setEvents] = useState<EnrichedEvent[]>(initialEvents)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(initialEvents.length >= total || initialEvents.length < PAGE_SIZE)

  // Refs mirror state so the observer callback reads fresh values without being
  // torn down and re-created on every load. The parent keys this component off
  // the filter query, so a filter change remounts and re-initialises all state.
  const loadingRef = useRef(false)
  const doneRef = useRef(done)
  const pageRef = useRef(1)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const loadMore = useCallback(async () => {
    if (loadingRef.current || doneRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const next = pageRef.current + 1
      const sep = query ? '&' : ''
      const res = await fetch(`/api/events?${query}${sep}page=${next}`, { cache: 'no-store' })
      const data = await res.json()
      const more: EnrichedEvent[] = data.events ?? []
      setEvents(prev => [...prev, ...more])
      pageRef.current = next
      if (more.length < PAGE_SIZE) {
        doneRef.current = true
        setDone(true)
      }
    } catch {
      doneRef.current = true
      setDone(true)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [query])

  // Auto-load the next page when the sentinel scrolls into view. rootMargin
  // pre-fetches ~600px early so the grid fills before the user reaches the end.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Showing <span className="font-medium text-slate-700">{events.length}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span> {total === 1 ? 'event' : 'events'}
      </p>
      <EventGrid events={events} />

      {!done && (
        <>
          {/* Sentinel the observer watches to trigger the next page. */}
          <div ref={sentinelRef} aria-hidden className="h-px" />
          <div className="flex justify-center mt-8">
            {loading ? (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <span className="h-4 w-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" />
                Loading more events…
              </span>
            ) : (
              <button
                onClick={loadMore}
                className="px-6 py-2.5 rounded-full bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {`Load more events (${total - events.length} more)`}
              </button>
            )}
          </div>
        </>
      )}

      {done && total > PAGE_SIZE && (
        <p className="text-center text-sm text-muted-foreground mt-8">That&apos;s all {total} events.</p>
      )}
    </div>
  )
}
