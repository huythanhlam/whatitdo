import { EventCard } from './EventCard'
import { AdSlot } from './AdSlot'
import type { Event, Category } from '@/lib/supabase/types'

type EnrichedEvent = Event & { categories?: Category[]; is_featured?: boolean; featured_label?: string | null }

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

  const items: React.ReactNode[] = []

  events.forEach((event, i) => {
    items.push(
      <EventCard
        key={event.id}
        event={event}
        featured={event.is_featured}
        featuredLabel={event.featured_label ?? undefined}
      />
    )
    if ((i + 1) % 8 === 0 && i < events.length - 1) {
      items.push(<AdSlot key={`ad-${i}`} slot={`grid-${Math.floor(i / 8)}`} />)
    }
  })

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items}
    </div>
  )
}
