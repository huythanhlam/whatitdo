'use client'

import { EventCard } from './EventCard'
import { type RecEvent } from '@/lib/recs/client'
import type { EnrichedEvent } from '@/lib/types'

// Thin adapter: a recommendation result rendered as the standard EventCard. The
// save/interested/hide overlay now lives in EventCard (via InteractionProvider),
// so this just maps RecEvent → EventCard and forwards the rec context (serveId
// for impression crediting, onHide so a rail can drop the card).
export function RecEventCard({
  event,
  basePath,
  serveId,
  onHide,
}: {
  event: RecEvent
  basePath: string
  city?: string
  serveId: string | null
  initialFavorited?: boolean
  onHide: (id: string) => void
}) {
  return (
    <EventCard
      event={event as unknown as EnrichedEvent}
      basePath={basePath}
      featured={!!event.is_featured}
      featuredLabel={event.featured_label ?? undefined}
      serveId={serveId}
      onHide={onHide}
    />
  )
}
