import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getEvent as fetchEvent } from '@/lib/db'
import { getTicketProvider } from '@/lib/tickets'
import { getBaseUrl } from '@/lib/site'
import type { EnrichedEvent } from '@/lib/types'

// Event content changes rarely once ingested; cache each detail page and
// revalidate every 15 minutes rather than re-querying every request.
export const revalidate = 900

// Per-event <title>/description/OG so each listing is its own indexable page in
// Google's event surfaces (the point of the SEO work).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const event = (await fetchEvent(id)) as unknown as EnrichedEvent | null
  if (!event) return { title: 'Event not found' }

  const date = new Date(event.start_time).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const where = event.venue_name ? ` at ${event.venue_name}` : ''
  const description = (event.description?.trim() || `${event.title}${where} in Austin on ${date}.`).slice(0, 200)
  const images = event.image_url ? [event.image_url] : undefined

  return {
    title: event.title,
    description,
    alternates: { canonical: `/events/${event.id}` },
    openGraph: { title: event.title, description, type: 'article', images },
    twitter: { card: 'summary_large_image', title: event.title, description, images },
  }
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // A missing event is a 404 (notFound → app/not-found.tsx); a DB failure throws
  // and surfaces via the error boundary (app/error.tsx) instead of masquerading
  // as "not found".
  const event = (await fetchEvent(id)) as unknown as EnrichedEvent | null

  if (!event) notFound()

  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const priceLabel = event.is_free ? 'Free' : event.price_min ? `From $${event.price_min}` : 'See tickets for pricing'
  const provider = getTicketProvider(event.ticket_url)
  const ticketCta = provider ? (event.is_free ? 'RSVP / Details' : provider.cta) : null
  const jsonLd = eventJsonLd(event)

  return (
    <div className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href="/" className="text-sm text-violet-600 hover:underline">← Back to events</Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {event.image_url && (
          <div className="relative w-full h-64 rounded-xl overflow-hidden mb-6 shadow-sm bg-slate-100">
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

        <h1 className="text-2xl font-bold mb-4 text-slate-900">{event.title}</h1>

        <div className="space-y-2 mb-6 text-sm text-slate-600">
          <p>📅 {dateStr} at {timeStr}</p>
          {event.venue_name && (
            <p>📍 {event.venue_name}{event.venue_address ? ` · ${event.venue_address}` : ''}</p>
          )}
          <p>{event.is_free ? '🆓 Free entry' : `💰 ${priceLabel}`}</p>
          <p className="text-xs text-slate-400">Source: {event.source}</p>
        </div>

        {event.description && (
          <p className="text-sm leading-relaxed mb-6 text-slate-700 whitespace-pre-line">
            {event.description}
          </p>
        )}

        <div className="flex gap-3 flex-wrap">
          {event.ticket_url && ticketCta && (
            <Button asChild className="bg-violet-600 hover:bg-violet-700">
              <a href={event.ticket_url} target="_blank" rel="noopener noreferrer">
                🎟 {ticketCta} →
              </a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href="/subscribe">🔔 Get event alerts</Link>
          </Button>
        </div>
        {event.ticket_url && provider && provider.name !== 'venue site' && (
          <p className="mt-2 text-xs text-slate-400">Tickets provided by {provider.name}</p>
        )}
      </div>
    </div>
  )
}

// schema.org Event JSON-LD so each listing is eligible for Google's event rich
// results. The app scrapes this markup from sources but emitted none of its own
// until now.
function eventJsonLd(event: EnrichedEvent): Record<string, unknown> {
  const iso = (v: string | null) => {
    if (!v) return undefined
    const t = new Date(v)
    return Number.isNaN(t.getTime()) ? undefined : t.toISOString()
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: iso(event.start_time),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: `${getBaseUrl()}/events/${event.id}`,
  }

  const endDate = iso(event.end_time)
  if (endDate) jsonLd.endDate = endDate
  if (event.description) jsonLd.description = event.description.slice(0, 500)
  if (event.image_url) jsonLd.image = [event.image_url]

  if (event.venue_name || event.venue_address) {
    jsonLd.location = {
      '@type': 'Place',
      name: event.venue_name ?? 'Austin, TX',
      address: event.venue_address ?? 'Austin, TX',
    }
  }

  if (event.ticket_url || event.is_free || event.price_min != null) {
    jsonLd.offers = {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      price: event.is_free ? 0 : event.price_min ?? undefined,
      priceCurrency: 'USD',
      url: event.ticket_url ?? undefined,
    }
  }

  return jsonLd
}
