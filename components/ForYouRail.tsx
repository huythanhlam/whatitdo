'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight } from 'lucide-react'
import { RecEventCard } from './RecEventCard'
import { fetchRecommendations, fetchFavoriteIds, type RecEvent } from '@/lib/recs/client'

// The personalized rail on the city home. It renders inside the ISR-cached page
// but fetches on the client, so the cached HTML stays impersonal and only this
// island is per-visitor. Degrades quietly: while loading it shows skeletons, and
// if there's nothing to show (or the fetch fails) it renders nothing rather than
// an empty box.
export function ForYouRail({ city, basePath }: { city: string; basePath: string }) {
  const [events, setEvents] = useState<RecEvent[] | null>(null)
  const [serveId, setServeId] = useState<string | null>(null)
  const [personalized, setPersonalized] = useState(false)
  const [favIds, setFavIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [recs, favs] = await Promise.all([
        fetchRecommendations(city, 'rail', 20),
        fetchFavoriteIds(city),
      ])
      if (!alive) return
      setEvents(recs.events)
      setServeId(recs.serveId)
      setPersonalized(!!recs.personalized)
      setFavIds(favs)
    })()
    return () => {
      alive = false
    }
  }, [city])

  // Loading: a skeleton rail so the section doesn't pop in.
  if (events === null) {
    return (
      <RailShell title="For You">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-w-[260px] max-w-[260px] h-72 rounded-xl bg-muted animate-pulse" />
        ))}
      </RailShell>
    )
  }

  if (events.length === 0) return null

  function handleHide(id: string) {
    setEvents(prev => (prev ? prev.filter(e => e.id !== id) : prev))
  }

  const title = personalized ? 'For You' : `Trending in ${cityLabel(city)}`

  return (
    <RailShell title={title} seeAllHref={`${basePath}/for-you`}>
      {events.map(event => (
        <div key={event.id} className="min-w-[260px] max-w-[260px]">
          <RecEventCard
            event={event}
            basePath={basePath}
            city={city}
            serveId={serveId}
            initialFavorited={favIds.has(event.id)}
            onHide={handleHide}
          />
        </div>
      ))}
    </RailShell>
  )
}

function RailShell({
  title,
  seeAllHref,
  children,
}: {
  title: string
  seeAllHref?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border bg-card/30">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> {title}
          </h2>
          {seeAllHref && (
            <Link href={seeAllHref} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              See all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {children}
        </div>
      </div>
    </section>
  )
}

function cityLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}
