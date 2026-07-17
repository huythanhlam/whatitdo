import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FeaturedBadge } from './FeaturedBadge'
import { EventCardActions } from './EventCardActions'
import { getTicketProvider } from '@/lib/tickets'
import type { EnrichedEvent } from '@/lib/types'

type Props = {
  event: EnrichedEvent
  basePath: string
  featured?: boolean
  featuredLabel?: string
  // Recommendation context (optional): serveId credits the impression, onHide
  // lets a rail drop the card. The action buttons themselves only render for
  // signed-in users (via InteractionProvider); everywhere else this is a no-op.
  serveId?: string | null
  onHide?: (id: string) => void
}

export function EventCard({ event, basePath, featured = false, featuredLabel, serveId = null, onHide }: Props) {
  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const priceLabel = event.is_free
    ? 'Free'
    : event.price_min
    ? `$${event.price_min}${event.price_max && event.price_max !== event.price_min ? `–$${event.price_max}` : ''}`
    : null

  const provider = getTicketProvider(event.ticket_url)
  // Paid events get a buy CTA; free events with a link get an RSVP/details CTA.
  const ticketCta = provider
    ? event.is_free
      ? 'RSVP / Details'
      : provider.cta
    : null

  return (
    <Card className={`relative overflow-hidden h-full flex flex-col transition-all hover:shadow-lg hover:-translate-y-0.5 ${featured ? 'ring-2 ring-primary shadow-primary/10' : ''}`}>
      {featured && <FeaturedBadge label={featuredLabel} />}
      <EventCardActions eventId={event.id} serveId={serveId} onHide={onHide} />

      <Link href={`${basePath}/events/${event.id}`} className="block group flex-1">
        {event.image_url ? (
          <div className="relative h-44 overflow-hidden bg-muted">
            <Image
              src={event.image_url}
              alt={event.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        ) : (
          <div className="h-44 bg-gradient-to-br from-primary/10 to-muted flex items-center justify-center">
            <span className="text-5xl">🎉</span>
          </div>
        )}

        <CardContent className="p-4 space-y-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 group-hover:text-primary transition-colors">
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
            <p className="text-xs font-medium text-success">
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
      </Link>

      {ticketCta && event.ticket_url && (
        <a
          href={event.ticket_url}
          target="_blank"
          rel="noopener noreferrer"
          title={provider && provider.name !== 'venue site' ? `Opens ${provider.name}` : 'Opens the ticket page'}
          className="mx-4 mb-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          🎟 {ticketCta} →
        </a>
      )}
    </Card>
  )
}
