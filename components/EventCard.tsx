import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FeaturedBadge } from './FeaturedBadge'
import type { Event, Category } from '@/lib/supabase/types'

type Props = {
  event: Event & { categories?: Category[] }
  featured?: boolean
  featuredLabel?: string
}

export function EventCard({ event, featured = false, featuredLabel }: Props) {
  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const priceLabel = event.is_free
    ? 'Free'
    : event.price_min
    ? `$${event.price_min}${event.price_max && event.price_max !== event.price_min ? `–$${event.price_max}` : ''}`
    : null

  return (
    <Link href={`/events/${event.id}`} className="block group h-full">
      <Card className={`relative overflow-hidden h-full transition-all hover:shadow-lg hover:-translate-y-0.5 ${featured ? 'ring-2 ring-violet-400 shadow-violet-100' : ''}`}>
        {featured && <FeaturedBadge label={featuredLabel} />}

        {event.image_url ? (
          <div className="h-44 overflow-hidden bg-slate-100">
            <img
              src={event.image_url}
              alt={event.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        ) : (
          <div className="h-44 bg-gradient-to-br from-violet-50 to-slate-100 flex items-center justify-center">
            <span className="text-5xl">🎉</span>
          </div>
        )}

        <CardContent className="p-4 space-y-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 group-hover:text-violet-700 transition-colors">
            {event.title}
          </h3>

          <p className="text-xs text-muted-foreground">
            📅 {dateStr} · {timeStr}
          </p>

          {event.venue_name && (
            <p className="text-xs text-muted-foreground truncate">
              📍 {event.venue_name}
            </p>
          )}

          {priceLabel && (
            <p className="text-xs font-medium text-emerald-600">
              {event.is_free ? '🆓' : '💰'} {priceLabel}
            </p>
          )}

          <div className="flex flex-wrap gap-1 pt-1">
            {(event.categories ?? []).slice(0, 3).map(cat => (
              <Badge
                key={cat.slug}
                variant="secondary"
                className="text-xs px-1.5 py-0 border"
                style={{ backgroundColor: cat.color + '18', color: cat.color, borderColor: cat.color + '44' }}
              >
                {cat.name}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
