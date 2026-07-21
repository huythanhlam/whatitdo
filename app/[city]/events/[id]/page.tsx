import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getEvent as fetchEvent, getCityBySlug } from '@/lib/db'
import { requireCity } from '@/lib/cities'
import { getTicketProvider } from '@/lib/tickets'
import { getBaseUrl } from '@/lib/site'
import { singleEventJsonLd, jsonLdHtml } from '@/lib/jsonLd'
import { cn } from '@/lib/utils'
import { isRecsCity } from '@/lib/recs/config'
import { TrackBeacon } from '@/components/TrackBeacon'
import { TicketLink } from '@/components/TicketLink'
import { ShareButton } from '@/components/ShareButton'
import type { EnrichedEvent } from '@/lib/types'

// Event content changes rarely once ingested; cache each detail page and
// revalidate every 15 minutes rather than re-querying every request.
export const revalidate = 900

// Per-event <title>/description/OG so each listing is its own indexable page in
// Google's event surfaces (the point of the SEO work).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; id: string }>
}): Promise<Metadata> {
  const { city: citySlug, id } = await params
  const [event, city] = await Promise.all([
    fetchEvent(id) as unknown as Promise<EnrichedEvent | null>,
    getCityBySlug(citySlug),
  ])
  if (!event || !city || event.city_id !== city.id) return { title: 'Event not found' }

  const date = new Date(event.start_time).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const where = event.venue_name ? ` at ${event.venue_name}` : ''
  const description = (event.description?.trim() || `${event.title}${where} on ${date}.`).slice(0, 200)
  const images = event.image_url ? [event.image_url] : undefined

  return {
    title: event.title,
    description,
    alternates: { canonical: `/${citySlug}/events/${event.id}` },
    openGraph: { title: event.title, description, type: 'article', images },
    twitter: { card: 'summary_large_image', title: event.title, description, images },
  }
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>
}) {
  const { city: citySlug, id } = await params
  const city = await requireCity(citySlug)
  const event = (await fetchEvent(id)) as unknown as EnrichedEvent | null

  if (!event || event.city_id !== city.id) notFound()

  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const priceLabel = event.is_free ? 'Free' : event.price_min ? `From $${event.price_min}` : 'See tickets for pricing'
  const provider = getTicketProvider(event.ticket_url)
  const ticketCta = provider ? (event.is_free ? 'RSVP / Details' : provider.cta) : null
  // schema.org Event JSON-LD (built + HTML-escaped in lib/jsonLd) so this
  // listing is eligible for Google's event rich results.
  const jsonLdMarkup = jsonLdHtml(singleEventJsonLd(event, citySlug, city))
  // Personalization is Austin-only at launch; only then do we log view/clickout.
  const recsOn = isRecsCity(citySlug)
  // Cross-source provenance: the distinct other sources that also listed this
  // canonical event (dedup merges them into one record). Empty for single-source events.
  const otherSources = Array.from(new Set((event.sources ?? []).map(s => s.source)))
    .filter(s => s !== event.source)

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdMarkup }} />
      {recsOn && <TrackBeacon eventId={event.id} city={citySlug} />}
      <header className="border-b bg-card/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href={`/${citySlug}`} className="text-sm text-primary hover:underline">← Back to events</Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {event.image_url && (
          <div className="relative w-full h-64 rounded-xl overflow-hidden mb-6 shadow-sm bg-muted">
            <Image
              src={event.image_url}
              alt={event.title}
              fill
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover"
              priority
            />
          </div>
        )}

        <div className="flex flex-wrap gap-1 mb-3">
          {event.categories?.map(cat => (
            <Badge
              key={cat.slug}
              style={{ backgroundColor: cat.color + '18', color: cat.color, borderColor: cat.color + '44' }}
              className="border text-xs"
            >
              {cat.name}
            </Badge>
          ))}
        </div>

        <h1 className="text-2xl font-bold mb-4 text-foreground">{event.title}</h1>

        <div className="space-y-2 mb-6 text-sm text-muted-foreground">
          <p>📅 {dateStr} at {timeStr}</p>
          {event.venue_name && (
            <p>📍 {event.venue_name}{event.venue_address ? ` · ${event.venue_address}` : ''}</p>
          )}
          <p>{event.is_free ? '🆓 Free entry' : `💰 ${priceLabel}`}</p>
          <p className="text-xs text-muted-foreground">Source: {event.source}</p>
          {otherSources.length > 0 && (
            <p className="text-xs text-muted-foreground">Also listed on {otherSources.join(', ')}</p>
          )}
        </div>

        {event.description && (
          <p className="text-sm leading-relaxed mb-6 text-foreground whitespace-pre-line">
            {event.description}
          </p>
        )}

        <div className="flex gap-3 flex-wrap">
          {event.ticket_url && ticketCta && (
            recsOn ? (
              <TicketLink
                href={event.ticket_url}
                eventId={event.id}
                city={citySlug}
                className={cn(buttonVariants(), 'bg-primary hover:bg-primary/90')}
              >
                🎟 {ticketCta} →
              </TicketLink>
            ) : (
              <Button asChild className="bg-primary hover:bg-primary/90">
                <a href={event.ticket_url} target="_blank" rel="noopener noreferrer">
                  🎟 {ticketCta} →
                </a>
              </Button>
            )
          )}
          <Button variant="outline" asChild>
            <Link href={`/${citySlug}/subscribe`}>🔔 Get event alerts</Link>
          </Button>
          <ShareButton
            url={`${getBaseUrl()}/${citySlug}/events/${event.id}`}
            title={event.title}
            city={citySlug}
            eventId={event.id}
          />
        </div>
        {event.ticket_url && provider && provider.name !== 'venue site' && (
          <p className="mt-2 text-xs text-muted-foreground">Tickets provided by {provider.name}</p>
        )}
      </div>
    </div>
  )
}
