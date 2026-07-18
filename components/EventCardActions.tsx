'use client'

import { useState } from 'react'
import { Star, X } from 'lucide-react'
import { sendAction } from '@/lib/recs/client'
import { useInteractions } from './InteractionProvider'

// The interested / not-interested overlay for an event card. Rendered by
// EventCard on every card, but only shows for signed-in users (via the shared
// InteractionProvider) — so we gather explicit signals across the whole catalog.
// Best-effort + optimistic, like the rec rails. `serveId` credits the impression
// when the card came from a recommendation; `onHide` lets a rail drop the card.
export function EventCardActions({
  eventId,
  serveId = null,
  onHide,
}: {
  eventId: string
  serveId?: string | null
  onHide?: (id: string) => void
}) {
  const ctx = useInteractions()
  const [interested, setInterested] = useState(false)
  if (!ctx || !ctx.authed) return null

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="absolute top-2 right-2 z-20 flex gap-1">
      <IconButton
        label={interested ? 'Not interested anymore' : 'Interested'}
        active={interested}
        activeClass="bg-amber-400 text-amber-950"
        onClick={e => {
          stop(e)
          const next = !interested
          setInterested(next)
          void sendAction(next ? 'interested' : 'uninterested', { eventId, city: ctx.city, serveId })
        }}
      >
        <Star className="w-4 h-4" fill={interested ? 'currentColor' : 'none'} />
      </IconButton>
      <IconButton
        label="Not interested"
        active={false}
        activeClass=""
        onClick={e => {
          stop(e)
          onHide?.(eventId)
          void sendAction('hide', { eventId, city: ctx.city, serveId })
        }}
      >
        <X className="w-4 h-4" />
      </IconButton>
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
  onClick: (e: React.MouseEvent) => void
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
