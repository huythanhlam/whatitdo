'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { RecEventCard } from './RecEventCard'
import { fetchRecommendations, type RecEvent } from '@/lib/recs/client'

// The full personalized feed behind /[city]/for-you. Same data as the rail, more
// of it, laid out as a grid. Client-fetched for the same reason the rail is.
export function ForYouFeed({ city, basePath }: { city: string; basePath: string }) {
  const [events, setEvents] = useState<RecEvent[] | null>(null)
  const [serveId, setServeId] = useState<string | null>(null)
  const [personalized, setPersonalized] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const recs = await fetchRecommendations(city, 'for_you', 30)
      if (!alive) return
      setEvents(recs.events)
      setServeId(recs.serveId)
      setPersonalized(!!recs.personalized)
    })()
    return () => {
      alive = false
    }
  }, [city])

  if (events === null) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-72 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-4xl mb-3">✨</p>
        <p className="font-medium text-foreground">Nothing to recommend yet</p>
        <p className="text-sm mt-1">
          Browse and mark a few events you’re interested in, then check back — the more you interact, the better this gets.
        </p>
        <Link href={basePath} className="inline-block mt-4 text-sm text-primary hover:underline">
          Browse all events →
        </Link>
      </div>
    )
  }

  function handleHide(id: string) {
    setEvents(prev => (prev ? prev.filter(e => e.id !== id) : prev))
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        {personalized
          ? 'Picked for you from your views and interests.'
          : `Popular upcoming events. Mark a few you’re interested in and this becomes personalized.`}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {events.map(event => (
          <RecEventCard
            key={event.id}
            event={event}
            basePath={basePath}
            city={city}
            serveId={serveId}
            onHide={handleHide}
          />
        ))}
      </div>
    </div>
  )
}
