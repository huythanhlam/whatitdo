import { EventCard } from './EventCard'
import type { EnrichedEvent } from '@/lib/types'

export function EventGrid({ events }: { events: EnrichedEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p className="text-4xl mb-4">🔍</p>
        <p className="font-medium">No events found</p>
        <p className="text-sm">Try a different search or remove some filters</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {events.map(event => (
        <EventCard
          key={event.id}
          event={event}
          featured={event.is_featured}
          featuredLabel={event.featured_label ?? undefined}
        />
      ))}
    </div>
  )
}
