'use client'

import { useState } from 'react'
import { Heart, Star, X } from 'lucide-react'
import { EventCard } from './EventCard'
import { sendAction, type RecEvent } from '@/lib/recs/client'
import type { EnrichedEvent } from '@/lib/types'

// A recommendation card: the standard EventCard plus an action overlay (save,
// interested, not-interested). Every action is optimistic — the UI updates
// immediately and the POST rides along in the background — because these are
// low-stakes toggles and the server treats them as best-effort signals anyway.
export function RecEventCard({
  event,
  basePath,
  city,
  serveId,
  initialFavorited = false,
  onHide,
}: {
  event: RecEvent
  basePath: string
  city: string
  serveId: string | null
  initialFavorited?: boolean
  onHide: (id: string) => void
}) {
  const [favorited, setFavorited] = useState(initialFavorited)
  const [interested, setInterested] = useState(false)

  function toggleFavorite() {
    const next = !favorited
    setFavorited(next)
    void sendAction(next ? 'favorite' : 'unfavorite', { eventId: event.id, city, serveId })
  }

  function toggleInterested() {
    const next = !interested
    setInterested(next)
    void sendAction(next ? 'interested' : 'uninterested', { eventId: event.id, city, serveId })
  }

  function hide() {
    onHide(event.id) // remove from the list immediately
    void sendAction('hide', { eventId: event.id, city, serveId })
  }

  return (
    <div className="relative h-full">
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <IconButton
          label={favorited ? 'Remove from saved' : 'Save'}
          active={favorited}
          activeClass="bg-primary text-primary-foreground"
          onClick={toggleFavorite}
        >
          <Heart className="w-4 h-4" fill={favorited ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton
          label={interested ? 'Not interested anymore' : 'Interested'}
          active={interested}
          activeClass="bg-amber-400 text-amber-950"
          onClick={toggleInterested}
        >
          <Star className="w-4 h-4" fill={interested ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton label="Not interested" active={false} activeClass="" onClick={hide}>
          <X className="w-4 h-4" />
        </IconButton>
      </div>

      <EventCard
        event={event as unknown as EnrichedEvent}
        basePath={basePath}
        featured={!!event.is_featured}
        featuredLabel={event.featured_label ?? undefined}
      />
    </div>
  )
}

function IconButton({
  children,
  label,
  active,
  activeClass,
  onClick,
}: {
  children: React.ReactNode
  label: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full shadow-sm backdrop-blur-sm transition-colors ${
        active ? activeClass : 'bg-card/90 text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
