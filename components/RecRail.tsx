'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, TrendingUp, ArrowRight } from 'lucide-react'
import { RecEventCard } from './RecEventCard'
import { fetchRecommendations, type RecEvent } from '@/lib/recs/client'

// A horizontal event carousel fed by /api/recommendations. Two modes:
//   trending  — engagement-ranked, same for everyone (mode=trending)
//   suggested — personalized to the signed-in user
// Client-fetched so it stays per-visitor; renders nothing if empty.
export function RecRail({
  city,
  basePath,
  mode,
}: {
  city: string
  basePath: string
  mode: 'trending' | 'suggested'
}) {
  const [events, setEvents] = useState<RecEvent[] | null>(null)
  const [serveId, setServeId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchRecommendations(city, mode === 'suggested' ? 'for_you' : 'rail', 20, mode).then(r => {
      if (!alive) return
      setEvents(r.events)
      setServeId(r.serveId)
    })
    return () => {
      alive = false
    }
  }, [city, mode])

  const title = mode === 'suggested' ? 'Suggested for you' : `Trending in ${cityLabel(city)}`
  const Icon = mode === 'suggested' ? Sparkles : TrendingUp

  if (events === null) {
    return (
      <RailShell title={title} icon={<Icon className="w-4 h-4 text-primary" />}>
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

  return (
    <RailShell
      title={title}
      icon={<Icon className="w-4 h-4 text-primary" />}
      seeAllHref={mode === 'suggested' ? `${basePath}/for-you` : undefined}
    >
      {events.map(event => (
        <div key={event.id} className="min-w-[260px] max-w-[260px]">
          <RecEventCard event={event} basePath={basePath} city={city} serveId={serveId} onHide={handleHide} />
        </div>
      ))}
    </RailShell>
  )
}

function RailShell({
  title,
  icon,
  seeAllHref,
  children,
}: {
  title: string
  icon: React.ReactNode
  seeAllHref?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border bg-card/30">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-foreground flex items-center gap-2">
            {icon} {title}
          </h2>
          {seeAllHref && (
            <Link href={seeAllHref} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              See all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">{children}</div>
      </div>
    </section>
  )
}

function cityLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}
